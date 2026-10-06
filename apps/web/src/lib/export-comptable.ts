/**
 * Export comptable (FIN-13) et plan comptable du cabinet : contrats, validations et
 * paramètres d'export, testés dans `export-comptable.test.ts`. Les écritures, leur équilibre
 * et le fichier CSV sont produits par l'API ; rien n'est calculé ici.
 */
import {
  FORMATS_DATE_EXPORT,
  SEPARATEURS_CSV,
  type CleCompte,
  type CleJournal,
} from "@missionpilot/shared";
import { ErreurApi, erreurDepuisReponse, MESSAGE_RESEAU } from "./api";
import { erreurPeriode } from "./periode";
import type { Resultat } from "./saisie";

export interface CompteCabinet {
  cle: CleCompte;
  compte: string;
  libelle: string;
  valeur_de_depart: string;
}

export interface JournalCabinet {
  cle: CleJournal;
  code: string;
  valeur_de_depart: string;
}

export interface PlanComptable {
  comptes: CompteCabinet[];
  journaux: JournalCabinet[];
  valeurs_validees: boolean;
  referentiel: string;
}

export const JOURNAL_LIBELLES: Record<CleJournal, string> = {
  ventes: "Ventes (factures et avoirs)",
  banque: "Banque (virements et chèques)",
  caisse: "Caisse (espèces)",
  mobile_money: "Mobile Money",
  operations_diverses: "Opérations diverses (imputation d'avances)",
};

const COMPTE = /^[0-9A-Z]{2,12}$/;
const JOURNAL = /^[0-9A-Z]{1,6}$/;

export interface SaisiePlan {
  comptes: Record<string, string>;
  journaux: Record<string, string>;
  valeurs_validees: boolean;
}

export interface ChargePlan {
  comptes?: Partial<Record<CleCompte, string>>;
  journaux?: Partial<Record<CleJournal, string>>;
  valeurs_validees?: boolean;
}

/**
 * Plan saisi → modifications à envoyer (seulement ce qui change). Numéros de compte : 2 à 12
 * chiffres ou majuscules ; codes journaux : 1 à 6.
 */
export function validerPlan(
  s: SaisiePlan,
  actuel: PlanComptable,
): Resultat<ChargePlan, string> & { inchange?: boolean } {
  const erreurs: Record<string, string> = {};
  const comptes: Partial<Record<CleCompte, string>> = {};
  const journaux: Partial<Record<CleJournal, string>> = {};
  for (const c of actuel.comptes) {
    const v = (s.comptes[c.cle] ?? c.compte).trim().toUpperCase();
    if (!COMPTE.test(v)) erreurs[`compte_${c.cle}`] = "2 à 12 chiffres ou majuscules.";
    else if (v !== c.compte) comptes[c.cle] = v;
  }
  for (const j of actuel.journaux) {
    const v = (s.journaux[j.cle] ?? j.code).trim().toUpperCase();
    if (!JOURNAL.test(v)) erreurs[`journal_${j.cle}`] = "1 à 6 chiffres ou majuscules.";
    else if (v !== j.code) journaux[j.cle] = v;
  }
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  const charge: ChargePlan = {};
  if (Object.keys(comptes).length > 0) charge.comptes = comptes;
  if (Object.keys(journaux).length > 0) charge.journaux = journaux;
  if (s.valeurs_validees !== actuel.valeurs_validees) charge.valeurs_validees = s.valeurs_validees;
  if (Object.keys(charge).length === 0) return { ok: true, charge, inchange: true };
  return { ok: true, charge };
}

// --- Paramètres d'export -------------------------------------------------------------------

export type Separateur = (typeof SEPARATEURS_CSV)[number];
export type FormatDate = (typeof FORMATS_DATE_EXPORT)[number];

export const SEPARATEUR_LIBELLES: Record<Separateur, string> = {
  point_virgule: "Point-virgule ( ; )",
  virgule: "Virgule ( , )",
  tabulation: "Tabulation",
};
export const FORMAT_DATE_LIBELLES: Record<FormatDate, string> = {
  "jj/mm/aaaa": "jj/mm/aaaa (31/01/2027)",
  "aaaa-mm-jj": "aaaa-mm-jj (2027-01-31)",
  jjmmaaaa: "jjmmaaaa (31012027)",
};

export const OPTIONS_SEPARATEURS = SEPARATEURS_CSV.map((s) => ({
  valeur: s,
  libelle: SEPARATEUR_LIBELLES[s],
}));
export const OPTIONS_FORMATS_DATE = FORMATS_DATE_EXPORT.map((f) => ({
  valeur: f,
  libelle: FORMAT_DATE_LIBELLES[f],
}));

export interface SaisieExport {
  du: string;
  au: string;
  separateur: Separateur;
  decimale: "virgule" | "point";
  bom: boolean;
  format_date: FormatDate;
}

export type ChampExport = "periode" | "decimale";

/**
 * Paramètres de l'export → requête. Seuls la période et des options de format partent dans
 * l'URL : aucune donnée comptable.
 */
export function validerExport(s: SaisieExport): Resultat<string, ChampExport> {
  const erreurs: Partial<Record<ChampExport, string>> = {};
  const periode = erreurPeriode(s.du, s.au);
  if (periode) erreurs.periode = periode;
  if (s.separateur === "virgule" && s.decimale === "virgule")
    erreurs.decimale = "Avec le séparateur virgule, la décimale doit être le point.";
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  const r = new URLSearchParams({
    du: s.du,
    au: s.au,
    format: "csv",
    separateur: s.separateur,
    decimale: s.decimale,
    bom: s.bom ? "oui" : "non",
    format_date: s.format_date,
  });
  return { ok: true, charge: r.toString() };
}

export const nomFichierExport = (du: string, au: string) => `ecritures-${du}-${au}.csv`;

/**
 * Télécharge l'export par un appel authentifié (cookie httpOnly) : le fichier n'est jamais
 * placé dans une URL partageable. Une erreur de l'API (période trop longue, pièce
 * déséquilibrée…) devient une `ErreurApi`.
 */
export async function telechargerExport(requete: string): Promise<Blob> {
  let reponse: Response;
  try {
    reponse = await fetch(`/api/finance/export-comptable?${requete}`, {
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "text/csv, application/json" },
    });
  } catch {
    throw new ErreurApi("RESEAU_INDISPONIBLE", MESSAGE_RESEAU, 0);
  }
  if (!reponse.ok) {
    let corps: unknown;
    try {
      corps = await reponse.json();
    } catch {
      corps = undefined;
    }
    throw erreurDepuisReponse(reponse.status, corps);
  }
  return reponse.blob();
}

/** Message affiché après un refus de l'export (équilibre des pièces contrôlé par l'API). */
export function messageExport(e: unknown): string | null {
  if (!(e instanceof ErreurApi)) return null;
  if (e.code === "ECRITURES_DESEQUILIBREES")
    return `${e.message} Aucune écriture n'a été exportée : signalez la pièce à l'administrateur.`;
  if (e.code === "REQUETE_INVALIDE") {
    // Règles de période des schémas partagés (messages français) : « Période de 731 jours au plus. »
    const formes = (e.details as { formErrors?: unknown } | undefined)?.formErrors;
    if (Array.isArray(formes) && formes.length > 0 && formes.every((f) => typeof f === "string"))
      return formes.join(" ");
    if (e.message !== "Données invalides.") return e.message;
  }
  return null;
}
