/**
 * Contrôles de saisie du pilotage augmenté des KPI (arbres, nœuds, actions, revues, décisions,
 * ordre du jour). Voir `kpi-pilotage.ts`, point d'entrée du module.
 */
import {
  creerTraduire,
  DELAI_DATE_EFFET_SANS_MOTIF_JOURS,
  type Langue,
} from "@missionpilot/shared";
import { ajouterJoursIso } from "./kpi";
import type { RelationArbre } from "./kpi-pilotage-types";
import { dateValide } from "./periode";
import { lireNombre } from "./saisie";
import type { Resultat } from "./saisie";

// --- Saisies --------------------------------------------------------------------------------

const unNonVide = (v: string) => v.trim() !== "";

export interface SaisieArbre {
  kpi_racine_id: string;
  libelle: string;
}
export type ChampArbre = keyof SaisieArbre;

export function validerArbre(
  s: SaisieArbre,
  langue: Langue = "fr",
): Resultat<SaisieArbre, ChampArbre> {
  const t = creerTraduire(langue);
  const erreurs: Partial<Record<ChampArbre, string>> = {};
  if (!unNonVide(s.kpi_racine_id)) {
    erreurs.kpi_racine_id = t("Choisissez le KPI à décomposer.", "Choose the KPI to break down.");
  }
  if (!unNonVide(s.libelle)) {
    erreurs.libelle = t("Le libellé de l'arbre est obligatoire.", "The tree label is required.");
  } else if (s.libelle.trim().length > 200) {
    erreurs.libelle = t("200 caractères au plus.", "200 characters at most.");
  }
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return { ok: true, charge: { kpi_racine_id: s.kpi_racine_id, libelle: s.libelle.trim() } };
}

export interface SaisieNoeud {
  parent_id: string;
  kpi_id: string;
  libelle: string;
  relation: RelationArbre;
  coefficient: string;
  rang: string;
}
export type ChampNoeud = keyof SaisieNoeud;
export interface ChargeNoeud {
  parent_id: string;
  kpi_id: string | null;
  libelle: string;
  relation: RelationArbre;
  coefficient: number;
  rang: number;
}

export function validerNoeud(
  s: SaisieNoeud,
  langue: Langue = "fr",
): Resultat<ChargeNoeud, ChampNoeud> {
  const t = creerTraduire(langue);
  const erreurs: Partial<Record<ChampNoeud, string>> = {};
  if (!unNonVide(s.parent_id)) {
    erreurs.parent_id = t("Choisissez le nœud parent.", "Choose the parent node.");
  }
  if (!unNonVide(s.libelle)) {
    erreurs.libelle = t("Le libellé du levier est obligatoire.", "The driver label is required.");
  } else if (s.libelle.trim().length > 200) {
    erreurs.libelle = t("200 caractères au plus.", "200 characters at most.");
  }
  const coefficient = s.coefficient.trim() === "" ? 1 : lireNombre(s.coefficient);
  if (coefficient === null || Number.isNaN(coefficient)) {
    erreurs.coefficient = t("Nombre attendu (ex. 1 ou -1).", "Number expected (e.g. 1 or -1).");
  } else if (Math.abs(coefficient) > 1000 || !/^-?\d{1,4}(\.\d{1,4})?$/.test(String(coefficient))) {
    erreurs.coefficient = t(
      "Entre -1000 et 1000, 4 décimales au plus.",
      "Between -1000 and 1000, 4 decimals at most.",
    );
  }
  const rang = s.rang.trim() === "" ? 0 : Number(s.rang);
  if (!Number.isInteger(rang) || rang < 0 || rang > 999) {
    erreurs.rang = t("Entier de 0 à 999.", "Integer from 0 to 999.");
  }
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      parent_id: s.parent_id,
      kpi_id: unNonVide(s.kpi_id) ? s.kpi_id : null,
      libelle: s.libelle.trim(),
      relation: s.relation,
      coefficient: coefficient as number,
      rang,
    },
  };
}

export interface SaisieAction {
  kpi_id: string;
  alerte_id: string;
  decision_id: string;
  titre: string;
  description: string;
  responsable_id: string;
  echeance: string;
}
export type ChampAction = keyof SaisieAction;
export interface ChargeAction {
  kpi_id: string;
  alerte_id?: string;
  decision_id?: string;
  titre: string;
  description?: string;
  responsable_id: string;
  echeance: string;
}

export function validerAction(
  s: SaisieAction,
  langue: Langue = "fr",
): Resultat<ChargeAction, ChampAction> {
  const t = creerTraduire(langue);
  const erreurs: Partial<Record<ChampAction, string>> = {};
  if (!unNonVide(s.kpi_id))
    erreurs.kpi_id = t("Choisissez le KPI concerné.", "Choose the KPI concerned.");
  if (!unNonVide(s.titre)) {
    erreurs.titre = t("Le titre de l'action est obligatoire.", "The action title is required.");
  } else if (s.titre.trim().length > 200) {
    erreurs.titre = t("200 caractères au plus.", "200 characters at most.");
  }
  if (s.description.trim().length > 2000) {
    erreurs.description = t("2 000 caractères au plus.", "2,000 characters at most.");
  }
  if (!unNonVide(s.responsable_id)) {
    erreurs.responsable_id = t("Choisissez le responsable.", "Choose the owner.");
  }
  if (!unNonVide(s.echeance)) {
    erreurs.echeance = t("L'échéance est obligatoire.", "The due date is required.");
  } else if (!dateValide(s.echeance)) erreurs.echeance = t("Date invalide.", "Invalid date.");
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      kpi_id: s.kpi_id,
      ...(unNonVide(s.alerte_id) ? { alerte_id: s.alerte_id } : {}),
      ...(unNonVide(s.decision_id) ? { decision_id: s.decision_id } : {}),
      titre: s.titre.trim(),
      ...(unNonVide(s.description) ? { description: s.description.trim() } : {}),
      responsable_id: s.responsable_id,
      echeance: s.echeance,
    },
  };
}

export interface SaisieStatutAction {
  statut: "en_cours" | "terminee" | "abandonnee";
  date_effet: string;
  motif: string;
  /** Justification d'une date d'effet très antérieure (obligatoire au-delà de 31 jours). */
  commentaire: string;
}
export type ChampStatutAction = keyof SaisieStatutAction;
export interface ChargeStatutAction {
  statut: "en_cours" | "terminee" | "abandonnee";
  date_effet?: string;
  motif?: string;
  commentaire?: string;
}

export { DELAI_DATE_EFFET_SANS_MOTIF_JOURS };

/** Vrai si la date d'effet recule de plus de 31 jours : un commentaire doit la justifier. */
export function dateEffetExigeCommentaire(dateEffet: string, jour: string): boolean {
  return (
    dateValide(dateEffet) !== null &&
    dateEffet < ajouterJoursIso(jour, -DELAI_DATE_EFFET_SANS_MOTIF_JOURS)
  );
}

export function validerStatutAction(
  s: SaisieStatutAction,
  jour: string,
  langue: Langue = "fr",
): Resultat<ChargeStatutAction, ChampStatutAction> {
  const t = creerTraduire(langue);
  const erreurs: Partial<Record<ChampStatutAction, string>> = {};
  if (s.statut === "abandonnee") {
    if (!unNonVide(s.motif)) {
      erreurs.motif = t(
        "Un motif est obligatoire pour abandonner une action.",
        "A reason is required to abandon an action.",
      );
    } else if (s.motif.trim().length > 500) {
      erreurs.motif = t("500 caractères au plus.", "500 characters at most.");
    }
  }
  if (s.statut === "terminee" && unNonVide(s.date_effet)) {
    if (!dateValide(s.date_effet)) erreurs.date_effet = t("Date invalide.", "Invalid date.");
    else if (s.date_effet > jour) {
      erreurs.date_effet = t(
        "La date d'effet ne peut pas être future.",
        "The effective date cannot be in the future.",
      );
    } else if (dateEffetExigeCommentaire(s.date_effet, jour) && !unNonVide(s.commentaire)) {
      erreurs.commentaire = t(
        `Une date d'effet antérieure de plus de ${DELAI_DATE_EFFET_SANS_MOTIF_JOURS} jours exige une justification.`,
        `An effective date more than ${DELAI_DATE_EFFET_SANS_MOTIF_JOURS} days in the past requires a justification.`,
      );
    }
  }
  if (s.commentaire.trim().length > 1000) {
    erreurs.commentaire = t("1 000 caractères au plus.", "1,000 characters at most.");
  }
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      statut: s.statut,
      ...(s.statut === "terminee" && unNonVide(s.date_effet) ? { date_effet: s.date_effet } : {}),
      ...(s.statut === "terminee" && unNonVide(s.commentaire)
        ? { commentaire: s.commentaire.trim() }
        : {}),
      ...(s.statut === "abandonnee" ? { motif: s.motif.trim() } : {}),
    },
  };
}

export interface SaisieRevue {
  titre: string;
  date_prevue: string;
  date_reference: string;
  animateur_id: string;
}
export type ChampRevue = keyof SaisieRevue;
export interface ChargeRevue {
  titre: string;
  date_prevue: string;
  date_reference?: string;
  animateur_id?: string;
}

export function validerRevue(
  s: SaisieRevue,
  langue: Langue = "fr",
): Resultat<ChargeRevue, ChampRevue> {
  const t = creerTraduire(langue);
  const erreurs: Partial<Record<ChampRevue, string>> = {};
  if (!unNonVide(s.titre)) {
    erreurs.titre = t("Le titre de la revue est obligatoire.", "The review title is required.");
  } else if (s.titre.trim().length > 200) {
    erreurs.titre = t("200 caractères au plus.", "200 characters at most.");
  }
  if (!unNonVide(s.date_prevue)) {
    erreurs.date_prevue = t("La date de la revue est obligatoire.", "The review date is required.");
  } else if (!dateValide(s.date_prevue)) erreurs.date_prevue = t("Date invalide.", "Invalid date.");
  if (unNonVide(s.date_reference) && !dateValide(s.date_reference)) {
    erreurs.date_reference = t("Date invalide.", "Invalid date.");
  }
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      titre: s.titre.trim(),
      date_prevue: s.date_prevue,
      ...(unNonVide(s.date_reference) ? { date_reference: s.date_reference } : {}),
      ...(unNonVide(s.animateur_id) ? { animateur_id: s.animateur_id } : {}),
    },
  };
}

export interface SaisieDecision {
  libelle: string;
  kpi_id: string;
  responsable_id: string;
  echeance: string;
}
export type ChampDecision = keyof SaisieDecision;
export interface ChargeDecision {
  libelle: string;
  kpi_id?: string;
  responsable_id?: string;
  echeance?: string;
}

export function validerDecision(
  s: SaisieDecision,
  langue: Langue = "fr",
): Resultat<ChargeDecision, ChampDecision> {
  const t = creerTraduire(langue);
  const erreurs: Partial<Record<ChampDecision, string>> = {};
  if (!unNonVide(s.libelle)) {
    erreurs.libelle = t(
      "Le libellé de la décision est obligatoire.",
      "The decision label is required.",
    );
  } else if (s.libelle.trim().length > 500) {
    erreurs.libelle = t("500 caractères au plus.", "500 characters at most.");
  }
  if (unNonVide(s.echeance) && !dateValide(s.echeance)) {
    erreurs.echeance = t("Date invalide.", "Invalid date.");
  }
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      libelle: s.libelle.trim(),
      ...(unNonVide(s.kpi_id) ? { kpi_id: s.kpi_id } : {}),
      ...(unNonVide(s.responsable_id) ? { responsable_id: s.responsable_id } : {}),
      ...(unNonVide(s.echeance) ? { echeance: s.echeance } : {}),
    },
  };
}

/**
 * Motif obligatoire pour abandonner une décision, commentaire (ce qui a été fait) obligatoire pour
 * la déclarer exécutée : un état terminal se justifie. `texte` est le motif ou le commentaire.
 */
export function validerStatutDecision(
  statut: "en_cours" | "executee" | "abandonnee",
  texte: string,
  langue: Langue = "fr",
): Resultat<{ statut: typeof statut; motif?: string; commentaire?: string }, "motif"> {
  const t = creerTraduire(langue);
  if (statut === "abandonnee") {
    if (!unNonVide(texte)) {
      return {
        ok: false,
        erreurs: { motif: t("Un motif est obligatoire.", "A reason is required.") },
      };
    }
    if (texte.trim().length > 500) {
      return {
        ok: false,
        erreurs: { motif: t("500 caractères au plus.", "500 characters at most.") },
      };
    }
    return { ok: true, charge: { statut, motif: texte.trim() } };
  }
  if (statut === "executee") {
    if (!unNonVide(texte)) {
      return {
        ok: false,
        erreurs: {
          motif: t(
            "Dites ce qui a été fait pour exécuter la décision.",
            "Say what was done to execute the decision.",
          ),
        },
      };
    }
    if (texte.trim().length > 1000) {
      return {
        ok: false,
        erreurs: { motif: t("1 000 caractères au plus.", "1,000 characters at most.") },
      };
    }
    return { ok: true, charge: { statut, commentaire: texte.trim() } };
  }
  return { ok: true, charge: { statut } };
}

/** Compte rendu d'une revue : 8 000 caractères au plus ; saisi avant ou à la tenue, puis figé. */
export const COMPTE_RENDU_MAX = 8000;
export function validerCompteRendu(
  texte: string,
  langue: Langue = "fr",
): Resultat<{ compte_rendu?: string }, "compte_rendu"> {
  if (texte.trim().length > COMPTE_RENDU_MAX) {
    return {
      ok: false,
      erreurs: {
        compte_rendu: creerTraduire(langue)(
          "8 000 caractères au plus.",
          "8,000 characters at most.",
        ),
      },
    };
  }
  return { ok: true, charge: unNonVide(texte) ? { compte_rendu: texte.trim() } : {} };
}

export interface PointSaisi {
  libelle: string;
  duree_minutes: number;
}

/** Points d'un ordre du jour saisi à la main (l'API en admet 40 au plus, 1 à 240 minutes chacun). */
export const POINTS_ORDRE_DU_JOUR_MAX = 40;
export const DUREE_POINT_DEFAUT_MINUTES = 10;

/**
 * Ordre du jour saisi : une ligne par point, « Libellé » ou « Libellé | durée en minutes »
 * (10 minutes par défaut). Les lignes vides sont ignorées. Remplace l'ordre du jour actuel.
 */
export function validerOrdreDuJour(
  texte: string,
  langue: Langue = "fr",
): Resultat<{ points: PointSaisi[] }, "points"> {
  const t = creerTraduire(langue);
  const lignes = texte
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");
  if (lignes.length === 0) {
    return {
      ok: false,
      erreurs: {
        points: t(
          "Saisissez au moins un point, un par ligne.",
          "Enter at least one item, one per line.",
        ),
      },
    };
  }
  if (lignes.length > POINTS_ORDRE_DU_JOUR_MAX) {
    return {
      ok: false,
      erreurs: {
        points: t(
          `${POINTS_ORDRE_DU_JOUR_MAX} points au plus.`,
          `${POINTS_ORDRE_DU_JOUR_MAX} items at most.`,
        ),
      },
    };
  }
  const points: PointSaisi[] = [];
  for (const [i, ligne] of lignes.entries()) {
    const coupe = ligne.lastIndexOf("|");
    const libelle = (coupe === -1 ? ligne : ligne.slice(0, coupe)).trim();
    const brut = coupe === -1 ? "" : ligne.slice(coupe + 1).trim();
    const duree = brut === "" ? DUREE_POINT_DEFAUT_MINUTES : Number(brut);
    if (libelle === "" || libelle.length > 300) {
      return {
        ok: false,
        erreurs: {
          points: t(
            `Ligne ${i + 1} : un libellé de 1 à 300 caractères est attendu.`,
            `Line ${i + 1}: a label of 1 to 300 characters is expected.`,
          ),
        },
      };
    }
    if (!Number.isInteger(duree) || duree < 1 || duree > 240) {
      return {
        ok: false,
        erreurs: {
          points: t(
            `Ligne ${i + 1} : une durée entière de 1 à 240 minutes est attendue.`,
            `Line ${i + 1}: a whole duration of 1 to 240 minutes is expected.`,
          ),
        },
      };
    }
    points.push({ libelle, duree_minutes: duree });
  }
  return { ok: true, charge: { points } };
}
