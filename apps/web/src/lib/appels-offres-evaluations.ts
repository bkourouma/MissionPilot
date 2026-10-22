import { CATEGORIES_EXIGENCE_AO, type CategorieExigenceAo } from "@missionpilot/shared";
import { ou } from "./appels-offres-saisie-base";
import { lireNombre, type Resultat } from "./saisie";

/**
 * Pourcentage saisi (« 15 », « 15,5 », « -2,25 ») → points de base entiers (1 % = 100), par
 * lecture du texte (aucun calcul flottant). `null` si vide, `NaN` si illisible ou plus de deux
 * décimales.
 */
export function pourCentVersPointsDeBase(v: string): number | null {
  const t = v.replace(/\s/g, "").replace(",", ".").replace("%", "");
  if (t === "") return null;
  const m = /^(-?)(\d{1,3})(?:\.(\d{1,2}))?$/.exec(t);
  if (!m) return Number.NaN;
  const entier = Number(m[2]);
  const decimales = Number((m[3] ?? "").padEnd(2, "0"));
  const bp = entier * 100 + decimales;
  return m[1] === "-" ? -bp : bp;
}

export interface SaisieEvaluation {
  adequation: string;
  references_pertinentes: string;
  references_exigees: string;
  jours_disponibles: string;
  jours_requis: string;
  marge: string;
  marge_cible: string;
  concurrents_connus: string;
  concurrents_forts: string;
}

export const SAISIE_EVALUATION_VIDE: SaisieEvaluation = {
  adequation: "",
  references_pertinentes: "",
  references_exigees: "0",
  jours_disponibles: "",
  jours_requis: "",
  marge: "",
  marge_cible: "20",
  concurrents_connus: "0",
  concurrents_forts: "0",
};

export interface ChargeEvaluation {
  adequation?: number;
  references_pertinentes?: number;
  references_exigees: number;
  jours_disponibles: number;
  jours_requis: number;
  marge_estimee_bp?: number;
  marge_cible_bp?: number;
  concurrents_connus: number;
  concurrents_forts: number;
}

function entier(v: string, max: number, obligatoire: boolean): number | null | "erreur" {
  const n = lireNombre(v);
  if (n === null) return obligatoire ? "erreur" : null;
  if (Number.isNaN(n) || !Number.isInteger(n) || n < 0 || n > max) return "erreur";
  return n;
}

/** Saisie de l'évaluation go/no-go → corps ; la marge n'est envoyée qu'avec `finance.lire`. */
export function validerEvaluation(
  s: SaisieEvaluation,
  voitFinance: boolean,
): Resultat<ChargeEvaluation, keyof SaisieEvaluation> {
  const erreurs: Partial<Record<keyof SaisieEvaluation, string>> = {};
  const lus: Partial<Record<keyof SaisieEvaluation, number | null>> = {};
  const regles: [keyof SaisieEvaluation, number, boolean, string][] = [
    ["adequation", 100, false, "Note entière de 0 à 100."],
    ["references_pertinentes", 1000, false, "Nombre entier."],
    ["references_exigees", 100, true, "Nombre entier de 0 à 100."],
    ["jours_disponibles", 100000, true, "Jours disponibles : nombre entier."],
    ["jours_requis", 100000, true, "Jours requis : nombre entier."],
    ["concurrents_connus", 100, true, "Nombre entier de 0 à 100."],
    ["concurrents_forts", 100, true, "Nombre entier de 0 à 100."],
  ];
  for (const [champ, max, obligatoire, message] of regles) {
    const n = entier(s[champ], max, obligatoire);
    if (n === "erreur") erreurs[champ] = message;
    else lus[champ] = n;
  }
  if ((lus.concurrents_forts ?? 0) > (lus.concurrents_connus ?? 0)) {
    erreurs.concurrents_forts = "Les concurrents forts font partie des concurrents connus.";
  }
  let marge: number | null = null;
  let cible: number | null = null;
  if (voitFinance) {
    marge = pourCentVersPointsDeBase(s.marge);
    if (marge !== null && (Number.isNaN(marge) || marge < -10000 || marge > 10000)) {
      erreurs.marge = "Pourcentage de −100 à 100, deux décimales au plus.";
    }
    cible = pourCentVersPointsDeBase(s.marge_cible);
    if (cible !== null && (Number.isNaN(cible) || cible < 1 || cible > 10000)) {
      erreurs.marge_cible = "Pourcentage de 0,01 à 100.";
    }
  }
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  const facultatif = (k: keyof SaisieEvaluation) =>
    lus[k] === null || lus[k] === undefined ? {} : { [k]: lus[k] as number };
  return {
    ok: true,
    charge: {
      ...facultatif("adequation"),
      ...facultatif("references_pertinentes"),
      references_exigees: lus.references_exigees as number,
      jours_disponibles: lus.jours_disponibles as number,
      jours_requis: lus.jours_requis as number,
      concurrents_connus: lus.concurrents_connus as number,
      concurrents_forts: lus.concurrents_forts as number,
      ...(marge !== null ? { marge_estimee_bp: marge } : {}),
      ...(marge !== null && cible !== null ? { marge_cible_bp: cible } : {}),
    },
  };
}

/** Points de base → « 15,5 % » (affichage d'une valeur reçue de l'API). */
export function formaterPointsDeBase(bp: number | null | undefined): string {
  if (bp === null || bp === undefined) return "—";
  const signe = bp < 0 ? "−" : "";
  const a = Math.abs(bp);
  const dec = String(a % 100)
    .padStart(2, "0")
    .replace(/0+$/, "");
  return `${signe}${Math.trunc(a / 100)}${dec ? `,${dec}` : ""} %`;
}

export function validerMotif(motif: string): Resultat<string, "motif"> {
  const m = motif.trim();
  if (m.length < 10) return { ok: false, erreurs: { motif: "Motivez en 10 caractères au moins." } };
  if (m.length > 2000) return { ok: false, erreurs: { motif: "2 000 caractères au plus." } };
  return { ok: true, charge: m };
}

export function validerTexteDossier(texte: string): Resultat<string, "texte"> {
  const t = texte.trim();
  if (t.length < 50) {
    return {
      ok: false,
      erreurs: { texte: "Collez le texte du dossier (50 caractères au moins)." },
    };
  }
  if (t.length > 200_000) return { ok: false, erreurs: { texte: "200 000 caractères au plus." } };
  return { ok: true, charge: t };
}

export interface SaisieExigence {
  libelle: string;
  categorie: string;
  obligatoire: boolean;
  reference: string;
}

export function validerExigence(s: SaisieExigence): Resultat<
  {
    libelle: string;
    categorie: CategorieExigenceAo;
    obligatoire: boolean;
    reference: string | null;
  },
  keyof SaisieExigence
> {
  const erreurs: Partial<Record<keyof SaisieExigence, string>> = {};
  const libelle = s.libelle.trim();
  if (libelle === "") erreurs.libelle = "Décrivez l'exigence.";
  else if (libelle.length > 1000) erreurs.libelle = "1 000 caractères au plus.";
  if (!(CATEGORIES_EXIGENCE_AO as readonly string[]).includes(s.categorie)) {
    erreurs.categorie = "Choisissez une catégorie.";
  }
  if (s.reference.trim().length > 60) erreurs.reference = "60 caractères au plus.";
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      libelle,
      categorie: s.categorie as CategorieExigenceAo,
      obligatoire: s.obligatoire,
      reference: ou(s.reference),
    },
  };
}
