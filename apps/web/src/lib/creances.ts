/**
 * Créances : balance âgée et relances (FIN-09). Logique pure, testée dans `creances.test.ts`.
 * Tranches, soldes et délais viennent de l'API (moteur) ; rien n'est recalculé ici.
 */
import { DELAIS_RELANCE_DEPART } from "@missionpilot/shared";
import { ErreurApi } from "./api";
import type { Devise } from "./format";
import { dateValide } from "./periode";
import { decouperListe, type Resultat } from "./saisie";

export type CleTranche = "non_echu" | "j0_30" | "j31_60" | "j61_90" | "plus_90";

/** Tranches de la balance âgée, dans l'ordre d'affichage. */
export const TRANCHES: readonly { cle: CleTranche; libelle: string }[] = [
  { cle: "non_echu", libelle: "Non échu" },
  { cle: "j0_30", libelle: "0 à 30 jours" },
  { cle: "j31_60", libelle: "31 à 60 jours" },
  { cle: "j61_90", libelle: "61 à 90 jours" },
  { cle: "plus_90", libelle: "Plus de 90 jours" },
];

export type ValeursBalance = Record<CleTranche | "total", number>;

export interface LigneBalanceClient extends ValeursBalance {
  client_id: string;
  raison_sociale: string | null;
}

export interface BalanceDevise {
  devise: Devise;
  total: ValeursBalance;
  clients: LigneBalanceClient[];
}

export interface BalanceAgee {
  date: string;
  base: "echeance" | "emission";
  devises: BalanceDevise[];
}

export const BASE_LIBELLES: Record<BalanceAgee["base"], string> = {
  echeance: "date d'échéance",
  emission: "date d'émission",
};

export interface FiltresBalance {
  date: string;
  base: BalanceAgee["base"];
}

const un = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export function lireFiltresBalance(
  p: Record<string, string | string[] | undefined>,
): FiltresBalance {
  return {
    date: dateValide(un(p.date)) ?? "",
    base: un(p.base) === "emission" ? "emission" : "echeance",
  };
}

export function requeteBalance(f: FiltresBalance): string {
  const r = new URLSearchParams({ base: f.base });
  if (f.date) r.set("date", f.date);
  return r.toString();
}

// --- Relances ------------------------------------------------------------------------------

export interface ParametresRelances {
  delais_relance: number[];
  relances_actives: boolean;
  /** Envoi automatique de l'e-mail au contact du client : DÉSACTIVÉ par défaut. */
  envoi_email_client: boolean;
  valeurs_validees: boolean;
}

export const NIVEAU_RELANCE_LIBELLES: Record<number, string> = {
  1: "Rappel amiable",
  2: "Deuxième relance",
  3: "Dernière relance avant mise en demeure",
};

export const libelleNiveau = (n: number) => NIVEAU_RELANCE_LIBELLES[n] ?? `Relance de niveau ${n}`;

/** « J+7, J+15, J+30 ». */
export function libelleDelais(delais: readonly number[]): string {
  return delais.map((d) => `J+${d}`).join(", ");
}

export const DELAIS_DEPART_TEXTE = DELAIS_RELANCE_DEPART.join(", ");

/** « 7, 15, 30 » → [7, 15, 30] : 1 à 3 délais entiers de 1 à 365, strictement croissants. */
export function lireDelais(texte: string): number[] | string {
  const morceaux = decouperListe(texte.replace(/j\s*\+?/gi, ""));
  if (morceaux.length === 0) return "Saisissez au moins un délai (ex. 7, 15, 30).";
  if (morceaux.length > 3) return "Trois délais au plus (un par niveau de relance).";
  const delais: number[] = [];
  for (const m of morceaux) {
    if (!/^\d+$/.test(m)) return "Délais en jours entiers, séparés par des virgules.";
    const n = Number(m);
    if (n < 1 || n > 365) return "Chaque délai va de 1 à 365 jours après l'échéance.";
    if (delais.length > 0 && n <= (delais[delais.length - 1] as number))
      return "Délais strictement croissants (ex. 7, 15, 30).";
    delais.push(n);
  }
  return delais;
}

export interface SaisieRelances {
  delais: string;
  relances_actives: boolean;
  valeurs_validees: boolean;
}

/**
 * Paramètres modifiables dans le formulaire principal. L'envoi automatique d'e-mail n'y figure
 * pas : il s'active par un bouton séparé, avec confirmation explicite.
 */
export function validerParametresRelances(
  s: SaisieRelances,
): Resultat<Omit<ParametresRelances, "envoi_email_client">, "delais"> {
  const delais = lireDelais(s.delais);
  if (typeof delais === "string") return { ok: false, erreurs: { delais } };
  return {
    ok: true,
    charge: {
      delais_relance: delais,
      relances_actives: s.relances_actives,
      valeurs_validees: s.valeurs_validees,
    },
  };
}

export interface SaisieRelanceManuelle {
  envoyer_email: boolean;
  message: string;
}

export function validerRelanceManuelle(
  s: SaisieRelanceManuelle,
): Resultat<{ envoyer_email: boolean; message: string | null }, "message"> {
  const message = s.message.trim();
  if (message.length > 1000)
    return { ok: false, erreurs: { message: "1 000 caractères au plus." } };
  return { ok: true, charge: { envoyer_email: s.envoyer_email, message: message || null } };
}

/** Message d'un refus de relance (facture soldée, contact sans e-mail…). */
export function messageRelance(e: unknown): string | null {
  if (!(e instanceof ErreurApi)) return null;
  if (e.code === "CONFLIT") return e.message;
  if (e.code === "RELANCE_DEJA_ENVOYEE")
    return "Un e-mail de relance est déjà parti chez le client aujourd'hui pour cette facture. Décochez l'envoi de l'e-mail pour enregistrer la relance seule, ou réessayez demain.";
  if (e.code === "REQUETE_INVALIDE" && e.message !== "Données invalides.") return e.message;
  return null;
}
