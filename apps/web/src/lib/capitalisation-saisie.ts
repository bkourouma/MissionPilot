import {
  creerTraduire,
  LONGUEUR_SECTION_RETOUR_MAX,
  SECTIONS_RETOUR,
  type Langue,
  type RetourVersion,
  type SectionRetour,
} from "@missionpilot/shared";
import { ErreurApi, messageErreur } from "./api";
import type { Resultat } from "./saisie";

/** Lecture et validation des saisies de la rubrique « Connaissances », messages d'erreur. */

/* ----- Lecture des saisies ----- */

export function lireVersionRetour(
  s: Record<SectionRetour, string>,
  langue: Langue = "fr",
): Resultat<RetourVersion, SectionRetour> {
  const t = creerTraduire(langue);
  const erreurs: Partial<Record<SectionRetour, string>> = {};
  const charge = {} as RetourVersion;
  for (const k of SECTIONS_RETOUR) {
    const v = s[k].trim();
    if (v === "") erreurs[k] = t("Cette section est obligatoire.", "This section is required.");
    else if (v.length > LONGUEUR_SECTION_RETOUR_MAX)
      erreurs[k] = t(
        `${LONGUEUR_SECTION_RETOUR_MAX} caractères au plus.`,
        `${LONGUEUR_SECTION_RETOUR_MAX} characters maximum.`,
      );
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

export function lireEstimation(
  s: {
    briques: string;
    effectif: string;
  },
  langue: Langue = "fr",
): Resultat<{ briques: string[]; effectif_minimum?: number }, "briques" | "effectif"> {
  const t = creerTraduire(langue);
  const { codes, invalides } = lireCodes(s.briques);
  if (invalides.length > 0) {
    return {
      ok: false,
      erreurs: {
        briques: t(
          `Codes invalides : ${invalides.join(", ")}.`,
          `Invalid codes: ${invalides.join(", ")}.`,
        ),
      },
    };
  }
  if (codes.length === 0)
    return {
      ok: false,
      erreurs: {
        briques: t("Indiquez au moins une brique.", "Enter at least one building block."),
      },
    };
  if (codes.length > 100) {
    return {
      ok: false,
      erreurs: { briques: t("100 briques au plus.", "100 building blocks maximum.") },
    };
  }
  if (s.effectif.trim() === "") return { ok: true, charge: { briques: codes } };
  const n = Number(s.effectif.trim());
  if (!Number.isInteger(n) || n < 3 || n > 20) {
    return {
      ok: false,
      erreurs: { effectif: t("Un entier de 3 à 20.", "A whole number from 3 to 20.") },
    };
  }
  return { ok: true, charge: { briques: codes, effectif_minimum: n } };
}

export function lireCompetence(
  s: {
    code: string;
    libelle: string;
    briques: string;
  },
  langue: Langue = "fr",
): Resultat<{ code: string; libelle: string; briques: string[] }, "code" | "libelle" | "briques"> {
  const t = creerTraduire(langue);
  const erreurs: Partial<Record<"code" | "libelle" | "briques", string>> = {};
  const code = s.code.trim();
  const libelle = s.libelle.trim();
  if (!CODE.test(code)) {
    erreurs.code = t(
      "Minuscules, chiffres, point, tiret ou tiret bas.",
      "Lowercase letters, digits, dot, hyphen or underscore.",
    );
  }
  if (libelle === "" || libelle.length > 200) {
    erreurs.libelle = t("Libellé de 1 à 200 caractères.", "Label of 1 to 200 characters.");
  }
  const { codes, invalides } = lireCodes(s.briques);
  if (invalides.length > 0) {
    erreurs.briques = t(
      `Codes invalides : ${invalides.join(", ")}.`,
      `Invalid codes: ${invalides.join(", ")}.`,
    );
  }
  if (codes.length > 50) erreurs.briques = t("50 briques au plus.", "50 building blocks maximum.");
  return Object.keys(erreurs).length > 0
    ? { ok: false, erreurs }
    : { ok: true, charge: { code, libelle, briques: codes } };
}

export function lireNiveau(
  v: string,
  langue: Langue = "fr",
): Resultat<{ niveau: number }, "niveau"> {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 4
    ? { ok: true, charge: { niveau: n } }
    : {
        ok: false,
        erreurs: {
          niveau: creerTraduire(langue)(
            "Choisissez un niveau de 1 à 4.",
            "Choose a level from 1 to 4.",
          ),
        },
      };
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

const MESSAGES_EN: Record<string, string> = {
  MISSION_NON_CLOTUREE: "The lessons-learned review opens when the engagement is closed.",
  RETOUR_VALIDE: "This lessons-learned review is approved: it can no longer change.",
  CHIFFRES_A_ACQUITTER:
    "Some numbers in this version do not come from the engines: review them, then tick the acknowledgement.",
  SEPARATION_DES_TACHES:
    "A level cannot be approved by the person assessed, nor by the person who declared it (except a partner).",
  PROPOSITION_EXISTANTE:
    "A proposal has already been submitted to the method committee for this group.",
  SEUIL_NON_ATTEINT: "This group does not reach the frequency threshold.",
  COLLABORATEUR_NON_RATTACHE: "Your account is not linked to any staff record.",
  COMPETENCE_EXISTANTE: "A skill already uses this code.",
  DECLARATION_DECIDEE: "This declaration has already been decided.",
  DECLARATION_EN_ATTENTE: "A declaration is already awaiting a decision for this skill.",
  PLAFOND_DECLARATIONS: "At most 50 declarations per skill and per staff member.",
  VALIDATION_RESERVEE:
    "The lessons-learned review is approved by a partner, or by the engagement manager or director.",
  TROP_DE_RECHERCHES: "Too many searches in a row: try again in a moment.",
};

export function messageCapitalisation(e: unknown, langue: Langue = "fr"): string {
  const messages = langue === "en" ? MESSAGES_EN : MESSAGES;
  if (e instanceof ErreurApi && messages[e.code]) return messages[e.code] as string;
  return messageErreur(e);
}
