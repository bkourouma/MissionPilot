import {
  LONGUEUR_SECTION_RETOUR_MAX,
  SECTIONS_RETOUR,
  type RetourVersion,
  type SectionRetour,
} from "@missionpilot/shared";
import { ErreurApi, messageErreur } from "./api";
import type { Resultat } from "./saisie";

/** Lecture et validation des saisies de la rubrique « Connaissances », messages d'erreur. */

/* ----- Lecture des saisies ----- */

export function lireVersionRetour(
  s: Record<SectionRetour, string>,
): Resultat<RetourVersion, SectionRetour> {
  const erreurs: Partial<Record<SectionRetour, string>> = {};
  const charge = {} as RetourVersion;
  for (const k of SECTIONS_RETOUR) {
    const v = s[k].trim();
    if (v === "") erreurs[k] = "Cette section est obligatoire.";
    else if (v.length > LONGUEUR_SECTION_RETOUR_MAX)
      erreurs[k] = `${LONGUEUR_SECTION_RETOUR_MAX} caractères au plus.`;
    charge[k] = v;
  }
  return Object.keys(erreurs).length > 0 ? { ok: false, erreurs } : { ok: true, charge };
}

const CODE = /^[a-z0-9_.-]{1,120}$/;

/** « a, b ; c » → codes de brique valides, sans doublon. */
export function lireCodes(v: string): { codes: string[]; invalides: string[] } {
  const elements = [
    ...new Set(
      v
        .split(/[,;\s]+/)
        .map((x) => x.trim())
        .filter((x) => x !== ""),
    ),
  ];
  return {
    codes: elements.filter((x) => CODE.test(x)),
    invalides: elements.filter((x) => !CODE.test(x)),
  };
}

export function lireEstimation(s: {
  briques: string;
  effectif: string;
}): Resultat<{ briques: string[]; effectif_minimum?: number }, "briques" | "effectif"> {
  const { codes, invalides } = lireCodes(s.briques);
  if (invalides.length > 0) {
    return { ok: false, erreurs: { briques: `Codes invalides : ${invalides.join(", ")}.` } };
  }
  if (codes.length === 0)
    return { ok: false, erreurs: { briques: "Indiquez au moins une brique." } };
  if (codes.length > 100) return { ok: false, erreurs: { briques: "100 briques au plus." } };
  if (s.effectif.trim() === "") return { ok: true, charge: { briques: codes } };
  const n = Number(s.effectif.trim());
  if (!Number.isInteger(n) || n < 3 || n > 20) {
    return { ok: false, erreurs: { effectif: "Un entier de 3 à 20." } };
  }
  return { ok: true, charge: { briques: codes, effectif_minimum: n } };
}

export function lireCompetence(s: {
  code: string;
  libelle: string;
  briques: string;
}): Resultat<{ code: string; libelle: string; briques: string[] }, "code" | "libelle" | "briques"> {
  const erreurs: Partial<Record<"code" | "libelle" | "briques", string>> = {};
  const code = s.code.trim();
  const libelle = s.libelle.trim();
  if (!CODE.test(code)) erreurs.code = "Minuscules, chiffres, point, tiret ou tiret bas.";
  if (libelle === "" || libelle.length > 200) erreurs.libelle = "Libellé de 1 à 200 caractères.";
  const { codes, invalides } = lireCodes(s.briques);
  if (invalides.length > 0) erreurs.briques = `Codes invalides : ${invalides.join(", ")}.`;
  if (codes.length > 50) erreurs.briques = "50 briques au plus.";
  return Object.keys(erreurs).length > 0
    ? { ok: false, erreurs }
    : { ok: true, charge: { code, libelle, briques: codes } };
}

export function lireNiveau(v: string): Resultat<{ niveau: number }, "niveau"> {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 4
    ? { ok: true, charge: { niveau: n } }
    : { ok: false, erreurs: { niveau: "Choisissez un niveau de 1 à 4." } };
}

const MESSAGES: Record<string, string> = {
  MISSION_NON_CLOTUREE: "Le retour d'expérience s'ouvre à la clôture de la mission.",
  RETOUR_VALIDE: "Ce retour d'expérience est validé : il ne change plus.",
  CHIFFRES_A_ACQUITTER:
    "Des nombres de cette version ne viennent pas des moteurs : relisez-les, puis cochez l'acquittement.",
  SEPARATION_DES_TACHES:
    "Un niveau ne se valide ni par la personne évaluée, ni par son déclarant (sauf associé).",
  PROPOSITION_EXISTANTE: "Une proposition est déjà soumise au comité méthode pour ce groupe.",
  SEUIL_NON_ATTEINT: "Ce groupe n'atteint pas le seuil de fréquence.",
  COLLABORATEUR_NON_RATTACHE: "Votre compte n'est rattaché à aucune fiche collaborateur.",
  COMPETENCE_EXISTANTE: "Une compétence porte déjà ce code.",
  DECLARATION_DECIDEE: "Cette déclaration a déjà été décidée.",
  DECLARATION_EN_ATTENTE: "Une déclaration est déjà en attente de décision pour cette compétence.",
  PLAFOND_DECLARATIONS: "Au plus 50 déclarations par compétence et par collaborateur.",
  VALIDATION_RESERVEE:
    "Le retour d'expérience se valide par un associé, le chef ou le directeur de la mission.",
  TROP_DE_RECHERCHES: "Trop de recherches à la suite : réessayez dans un instant.",
};

export function messageCapitalisation(e: unknown): string {
  if (e instanceof ErreurApi && MESSAGES[e.code]) return MESSAGES[e.code] as string;
  return messageErreur(e);
}
