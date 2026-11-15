/**
 * Redressement, onglet « Suivi » : de la saisie d'un formulaire au corps d'API (création du suivi,
 * relevé, événement d'un jalon). Contrôles de forme avec messages en français ; l'API revalide
 * tout. Les ratios saisis sont convertis en points de base par lecture du texte, sans nombre
 * flottant. Aucun calcul métier. Logique pure, testée dans `redressement-suivi.test.ts`.
 */
import {
  creerTraduire,
  type Langue,
  RED_SUIVI_COMMENTAIRE_MAX,
  RED_SUIVI_JALONS_MAX,
  RED_SUIVI_LIBELLE_MAX,
  RED_SUIVI_MOIS_MAX,
  RED_SUIVI_MOIS_PAR_DEFAUT,
  RED_SUIVI_MOTIF_MAX,
  RED_SUIVI_RATIO_PB_MAX,
  RED_SUIVI_RATIOS,
  type RedSuiviRatio,
  type RedSuiviSourceReleve,
  type RedSuiviTypeEvenement,
} from "@missionpilot/shared";
import { FORME_RATIO } from "./redressement";
import { texteOuNull, type Resultat } from "./saisie";

const DATE_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Date « AAAA-MM-JJ » réelle et comprise entre 2000 et 2100 (bornes de la base). */
export function dateSuiviValide(v: string): boolean {
  const m = DATE_ISO.exec(v);
  if (!m) return false;
  const [a, mo, j] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (a < 2000 || a > 2100) return false;
  const d = new Date(Date.UTC(a, mo - 1, j));
  return d.getUTCFullYear() === a && d.getUTCMonth() === mo - 1 && d.getUTCDate() === j;
}

// --- Création du suivi ------------------------------------------------------------------------------

export interface SaisieJalon {
  /** Clé de rendu stable (jamais envoyée). */
  cle: string;
  mois: string;
  libelle: string;
}

let compteur = 0;
export const nouvelleCleJalon = () => `jalon-${++compteur}`;

export const jalonVide = (mois = ""): SaisieJalon => ({
  cle: nouvelleCleJalon(),
  mois,
  libelle: "",
});

/** Jalons proposés par défaut : +6 et +12 mois. */
export const jalonsParDefaut = (): SaisieJalon[] =>
  RED_SUIVI_MOIS_PAR_DEFAUT.map((m) => jalonVide(String(m)));

/** Mois suggéré pour un jalon ajouté : le dernier mois saisi + 6, borné à 60. */
export function moisSuivant(jalons: readonly SaisieJalon[]): string {
  const dernier = Number(jalons[jalons.length - 1]?.mois ?? "0");
  const base = Number.isInteger(dernier) && dernier > 0 ? dernier : 0;
  return String(Math.min(RED_SUIVI_MOIS_MAX, base + 6));
}

export type ChampCreationSuivi = "jalons" | `mois.${string}` | `libelle.${string}`;

export function corpsCreationSuivi(
  jalons: readonly SaisieJalon[],
  langue: Langue = "fr",
): Resultat<{ jalons: { mois: number; libelle?: string }[] }, ChampCreationSuivi> {
  const t = creerTraduire(langue);
  const erreurs: Partial<Record<ChampCreationSuivi, string>> = {};
  if (jalons.length === 0)
    erreurs.jalons = t("Au moins un jalon est attendu.", "At least one milestone is expected.");
  if (jalons.length > RED_SUIVI_JALONS_MAX) {
    erreurs.jalons = t(
      `${RED_SUIVI_JALONS_MAX} jalons au plus.`,
      `${RED_SUIVI_JALONS_MAX} milestones at most.`,
    );
  }
  const charge: { mois: number; libelle?: string }[] = [];
  let precedent = 0;
  for (const j of jalons) {
    const brut = j.mois.trim();
    const mois = /^\d{1,3}$/.test(brut) ? Number(brut) : Number.NaN;
    if (Number.isNaN(mois) || mois < 1 || mois > RED_SUIVI_MOIS_MAX) {
      erreurs[`mois.${j.cle}`] = t(
        `Indiquez un nombre entier de mois entre 1 et ${RED_SUIVI_MOIS_MAX}.`,
        `Enter a whole number of months between 1 and ${RED_SUIVI_MOIS_MAX}.`,
      );
      continue;
    }
    if (mois <= precedent) {
      erreurs[`mois.${j.cle}`] = t(
        "Les échéances sont strictement croissantes.",
        "Due dates must be strictly increasing.",
      );
      continue;
    }
    precedent = mois;
    const libelle = texteOuNull(j.libelle);
    if (libelle !== null && libelle.length > RED_SUIVI_LIBELLE_MAX) {
      erreurs[`libelle.${j.cle}`] = t(
        `Libellé trop long (${RED_SUIVI_LIBELLE_MAX} caractères au plus).`,
        `Label too long (${RED_SUIVI_LIBELLE_MAX} characters at most).`,
      );
      continue;
    }
    charge.push(libelle === null ? { mois } : { mois, libelle });
  }
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return { ok: true, charge: { jalons: charge } };
}

// --- Relevé -----------------------------------------------------------------------------------------

/**
 * Ratio saisi → points de base entiers. Rapport (1,36) : jusqu'à 4 décimales ; part (18,75 ou
 * « 18,75 % ») : jusqu'à 2 décimales. `null` si vide, `NaN` si illisible, trop précis ou hors
 * plafond. La conversion lit le texte (partie entière, partie décimale) : aucun flottant.
 */
export function lireRatioPb(v: string, ratio: RedSuiviRatio): number | null {
  const t = v.replace(/[\s%]/g, "");
  if (t === "") return null;
  const pourcentage = FORME_RATIO[ratio] === "pourcentage";
  const decimales = pourcentage ? 2 : 4;
  const m = /^([-−]?)(\d{1,9})(?:[.,](\d+))?$/.exec(t);
  if (!m) return Number.NaN;
  const fraction = m[3] ?? "";
  if (fraction.length > decimales) return Number.NaN;
  const facteur = pourcentage ? 100 : 10_000;
  const absolu = Number(m[2]) * facteur + Number(fraction.padEnd(decimales, "0"));
  const valeur = m[1] === "" ? absolu : -absolu;
  if (Math.abs(valeur) > RED_SUIVI_RATIO_PB_MAX) return Number.NaN;
  return valeur === 0 ? 0 : valeur;
}

export interface SaisieReleve {
  jalon_id: string;
  date_releve: string;
  source: RedSuiviSourceReleve;
  ratios: Partial<Record<RedSuiviRatio, string>>;
  commentaire: string;
}

export const releveVide = (aujourdhui: string, jalonId = ""): SaisieReleve => ({
  jalon_id: jalonId,
  date_releve: aujourdhui,
  source: "saisie",
  ratios: {},
  commentaire: "",
});

export type ChampReleve = "jalon_id" | "date_releve" | "ratios" | "commentaire" | `ratio.${string}`;

export interface CorpsReleve {
  jalon_id: string;
  date_releve: string;
  source: RedSuiviSourceReleve;
  ratios?: Partial<Record<RedSuiviRatio, number>>;
  commentaire?: string;
}

export function corpsReleve(
  s: SaisieReleve,
  langue: Langue = "fr",
): Resultat<CorpsReleve, ChampReleve> {
  const t = creerTraduire(langue);
  const erreurs: Partial<Record<ChampReleve, string>> = {};
  if (s.jalon_id === "")
    erreurs.jalon_id = t("Choisissez le jalon concerné.", "Choose the relevant milestone.");
  if (!dateSuiviValide(s.date_releve)) {
    erreurs.date_releve = t(
      "Indiquez une date valide, entre 2000 et 2100.",
      "Enter a valid date between 2000 and 2100.",
    );
  }
  const commentaire = texteOuNull(s.commentaire);
  if (commentaire !== null && commentaire.length > RED_SUIVI_COMMENTAIRE_MAX) {
    erreurs.commentaire = t(
      `Commentaire trop long (${RED_SUIVI_COMMENTAIRE_MAX} caractères au plus).`,
      `Comment too long (${RED_SUIVI_COMMENTAIRE_MAX} characters at most).`,
    );
  }
  const ratios: Partial<Record<RedSuiviRatio, number>> = {};
  if (s.source === "saisie") {
    for (const r of RED_SUIVI_RATIOS) {
      const pb = lireRatioPb(s.ratios[r] ?? "", r);
      if (pb === null) continue;
      if (Number.isNaN(pb)) {
        erreurs[`ratio.${r}`] = t(
          "Valeur illisible, trop précise ou hors limites.",
          "Unreadable value, too precise or out of range.",
        );
      } else {
        ratios[r] = pb;
      }
    }
    if (Object.keys(ratios).length === 0 && Object.keys(erreurs).length === 0) {
      erreurs.ratios = t("Saisissez au moins un ratio.", "Enter at least one ratio.");
    }
  }
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      jalon_id: s.jalon_id,
      date_releve: s.date_releve,
      source: s.source,
      ...(s.source === "saisie" ? { ratios } : {}),
      ...(commentaire !== null ? { commentaire } : {}),
    },
  };
}

// --- Événement d'un jalon ---------------------------------------------------------------------------

export interface SaisieEvenement {
  type: RedSuiviTypeEvenement;
  date_effet: string;
  motif: string;
}

export type ChampEvenement = "date_effet" | "motif";

/** Réalisé : date de réalisation ; reporté : nouvelle date prévue et motif obligatoire. */
export function corpsEvenement(
  s: SaisieEvenement,
  langue: Langue = "fr",
): Resultat<{ type: RedSuiviTypeEvenement; date_effet: string; motif?: string }, ChampEvenement> {
  const t = creerTraduire(langue);
  const erreurs: Partial<Record<ChampEvenement, string>> = {};
  if (!dateSuiviValide(s.date_effet)) {
    erreurs.date_effet = t(
      "Indiquez une date valide, entre 2000 et 2100.",
      "Enter a valid date between 2000 and 2100.",
    );
  }
  const motif = texteOuNull(s.motif);
  if (s.type === "reporte" && motif === null)
    erreurs.motif = t("Un report s'accompagne d'un motif.", "A postponement requires a reason.");
  if (motif !== null && motif.length > RED_SUIVI_MOTIF_MAX) {
    erreurs.motif = t(
      `Motif trop long (${RED_SUIVI_MOTIF_MAX} caractères au plus).`,
      `Reason too long (${RED_SUIVI_MOTIF_MAX} characters at most).`,
    );
  }
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: { type: s.type, date_effet: s.date_effet, ...(motif !== null ? { motif } : {}) },
  };
}
