import {
  CATEGORIES_EXIGENCE_AO,
  creerTraduire,
  type CategorieExigenceAo,
  type Langue,
} from "@missionpilot/shared";
import { ou } from "./appels-offres-saisie-base";
import { lireNombre, normaliserNombreSaisi, type Resultat } from "./saisie";

/**
 * Pourcentage saisi (« 15 », « 15,5 », « -2,25 ») → points de base entiers (1 % = 100), par
 * lecture du texte (aucun calcul flottant). `null` si vide, `NaN` si illisible ou plus de deux
 * décimales.
 */
export function pourCentVersPointsDeBase(v: string): number | null {
  const t = normaliserNombreSaisi(v).replace("%", "");
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
  langue: Langue = "fr",
): Resultat<ChargeEvaluation, keyof SaisieEvaluation> {
  const t = creerTraduire(langue);
  const erreurs: Partial<Record<keyof SaisieEvaluation, string>> = {};
  const lus: Partial<Record<keyof SaisieEvaluation, number | null>> = {};
  const regles: [keyof SaisieEvaluation, number, boolean, string][] = [
    ["adequation", 100, false, t("Note entière de 0 à 100.", "Whole score from 0 to 100.")],
    ["references_pertinentes", 1000, false, t("Nombre entier.", "Whole number.")],
    [
      "references_exigees",
      100,
      true,
      t("Nombre entier de 0 à 100.", "Whole number from 0 to 100."),
    ],
    [
      "jours_disponibles",
      100000,
      true,
      t("Jours disponibles : nombre entier.", "Days available: whole number."),
    ],
    [
      "jours_requis",
      100000,
      true,
      t("Jours requis : nombre entier.", "Days required: whole number."),
    ],
    [
      "concurrents_connus",
      100,
      true,
      t("Nombre entier de 0 à 100.", "Whole number from 0 to 100."),
    ],
    ["concurrents_forts", 100, true, t("Nombre entier de 0 à 100.", "Whole number from 0 to 100.")],
  ];
  for (const [champ, max, obligatoire, message] of regles) {
    const n = entier(s[champ], max, obligatoire);
    if (n === "erreur") erreurs[champ] = message;
    else lus[champ] = n;
  }
  if ((lus.concurrents_forts ?? 0) > (lus.concurrents_connus ?? 0)) {
    erreurs.concurrents_forts = t(
      "Les concurrents forts font partie des concurrents connus.",
      "Strong competitors are part of the known competitors.",
    );
  }
  let marge: number | null = null;
  let cible: number | null = null;
  if (voitFinance) {
    marge = pourCentVersPointsDeBase(s.marge);
    if (marge !== null && (Number.isNaN(marge) || marge < -10000 || marge > 10000)) {
      erreurs.marge = t(
        "Pourcentage de −100 à 100, deux décimales au plus.",
        "Percentage from −100 to 100, at most two decimals.",
      );
    }
    cible = pourCentVersPointsDeBase(s.marge_cible);
    if (cible !== null && (Number.isNaN(cible) || cible < 1 || cible > 10000)) {
      erreurs.marge_cible = t("Pourcentage de 0,01 à 100.", "Percentage from 0.01 to 100.");
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
export const formaterPointsDeBase = (bp: number | null | undefined): string =>
  formaterPointsDeBaseLangue(bp, "fr");

/** Même texte dans la langue demandée (fonction à part : `formaterPointsDeBase` est passée à `.map`). */
export function formaterPointsDeBaseLangue(bp: number | null | undefined, langue: Langue): string {
  if (bp === null || bp === undefined) return "—";
  const signe = bp < 0 ? "−" : "";
  const a = Math.abs(bp);
  const dec = String(a % 100)
    .padStart(2, "0")
    .replace(/0+$/, "");
  const corps = `${Math.trunc(a / 100)}${dec ? `${langue === "en" ? "." : ","}${dec}` : ""}`;
  return langue === "en" ? `${signe}${corps}%` : `${signe}${corps} %`;
}

export function validerMotif(motif: string, langue: Langue = "fr"): Resultat<string, "motif"> {
  const t = creerTraduire(langue);
  const m = motif.trim();
  if (m.length < 10) {
    return {
      ok: false,
      erreurs: {
        motif: t("Motivez en 10 caractères au moins.", "Give a reason of at least 10 characters."),
      },
    };
  }
  if (m.length > 2000) {
    return {
      ok: false,
      erreurs: { motif: t("2 000 caractères au plus.", "2,000 characters at most.") },
    };
  }
  return { ok: true, charge: m };
}

export function validerTexteDossier(
  texte: string,
  langue: Langue = "fr",
): Resultat<string, "texte"> {
  const t = creerTraduire(langue);
  const brut = texte.trim();
  if (brut.length < 50) {
    return {
      ok: false,
      erreurs: {
        texte: t(
          "Collez le texte du dossier (50 caractères au moins).",
          "Paste the tender document text (at least 50 characters).",
        ),
      },
    };
  }
  if (brut.length > 200_000) {
    return {
      ok: false,
      erreurs: { texte: t("200 000 caractères au plus.", "200,000 characters at most.") },
    };
  }
  return { ok: true, charge: brut };
}

export interface SaisieExigence {
  libelle: string;
  categorie: string;
  obligatoire: boolean;
  reference: string;
}

export function validerExigence(
  s: SaisieExigence,
  langue: Langue = "fr",
): Resultat<
  {
    libelle: string;
    categorie: CategorieExigenceAo;
    obligatoire: boolean;
    reference: string | null;
  },
  keyof SaisieExigence
> {
  const t = creerTraduire(langue);
  const erreurs: Partial<Record<keyof SaisieExigence, string>> = {};
  const libelle = s.libelle.trim();
  if (libelle === "") erreurs.libelle = t("Décrivez l'exigence.", "Describe the requirement.");
  else if (libelle.length > 1000) {
    erreurs.libelle = t("1 000 caractères au plus.", "1,000 characters at most.");
  }
  if (!(CATEGORIES_EXIGENCE_AO as readonly string[]).includes(s.categorie)) {
    erreurs.categorie = t("Choisissez une catégorie.", "Choose a category.");
  }
  if (s.reference.trim().length > 60)
    erreurs.reference = t("60 caractères au plus.", "60 characters at most.");
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
