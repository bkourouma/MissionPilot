/**
 * Contrôles de saisie du pilotage augmenté des KPI (arbres, nœuds, actions, revues, décisions,
 * ordre du jour). Voir `kpi-pilotage.ts`, point d'entrée du module.
 */
import { DELAI_DATE_EFFET_SANS_MOTIF_JOURS } from "@missionpilot/shared";
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

export function validerArbre(s: SaisieArbre): Resultat<SaisieArbre, ChampArbre> {
  const erreurs: Partial<Record<ChampArbre, string>> = {};
  if (!unNonVide(s.kpi_racine_id)) erreurs.kpi_racine_id = "Choisissez le KPI à décomposer.";
  if (!unNonVide(s.libelle)) erreurs.libelle = "Le libellé de l'arbre est obligatoire.";
  else if (s.libelle.trim().length > 200) erreurs.libelle = "200 caractères au plus.";
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

export function validerNoeud(s: SaisieNoeud): Resultat<ChargeNoeud, ChampNoeud> {
  const erreurs: Partial<Record<ChampNoeud, string>> = {};
  if (!unNonVide(s.parent_id)) erreurs.parent_id = "Choisissez le nœud parent.";
  if (!unNonVide(s.libelle)) erreurs.libelle = "Le libellé du levier est obligatoire.";
  else if (s.libelle.trim().length > 200) erreurs.libelle = "200 caractères au plus.";
  const coefficient = s.coefficient.trim() === "" ? 1 : lireNombre(s.coefficient);
  if (coefficient === null || Number.isNaN(coefficient)) {
    erreurs.coefficient = "Nombre attendu (ex. 1 ou -1).";
  } else if (Math.abs(coefficient) > 1000 || !/^-?\d{1,4}(\.\d{1,4})?$/.test(String(coefficient))) {
    erreurs.coefficient = "Entre -1000 et 1000, 4 décimales au plus.";
  }
  const rang = s.rang.trim() === "" ? 0 : Number(s.rang);
  if (!Number.isInteger(rang) || rang < 0 || rang > 999) erreurs.rang = "Entier de 0 à 999.";
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

export function validerAction(s: SaisieAction): Resultat<ChargeAction, ChampAction> {
  const erreurs: Partial<Record<ChampAction, string>> = {};
  if (!unNonVide(s.kpi_id)) erreurs.kpi_id = "Choisissez le KPI concerné.";
  if (!unNonVide(s.titre)) erreurs.titre = "Le titre de l'action est obligatoire.";
  else if (s.titre.trim().length > 200) erreurs.titre = "200 caractères au plus.";
  if (s.description.trim().length > 2000) erreurs.description = "2 000 caractères au plus.";
  if (!unNonVide(s.responsable_id)) erreurs.responsable_id = "Choisissez le responsable.";
  if (!unNonVide(s.echeance)) erreurs.echeance = "L'échéance est obligatoire.";
  else if (!dateValide(s.echeance)) erreurs.echeance = "Date invalide.";
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
): Resultat<ChargeStatutAction, ChampStatutAction> {
  const erreurs: Partial<Record<ChampStatutAction, string>> = {};
  if (s.statut === "abandonnee") {
    if (!unNonVide(s.motif)) erreurs.motif = "Un motif est obligatoire pour abandonner une action.";
    else if (s.motif.trim().length > 500) erreurs.motif = "500 caractères au plus.";
  }
  if (s.statut === "terminee" && unNonVide(s.date_effet)) {
    if (!dateValide(s.date_effet)) erreurs.date_effet = "Date invalide.";
    else if (s.date_effet > jour) erreurs.date_effet = "La date d'effet ne peut pas être future.";
    else if (dateEffetExigeCommentaire(s.date_effet, jour) && !unNonVide(s.commentaire)) {
      erreurs.commentaire = `Une date d'effet antérieure de plus de ${DELAI_DATE_EFFET_SANS_MOTIF_JOURS} jours exige une justification.`;
    }
  }
  if (s.commentaire.trim().length > 1000) erreurs.commentaire = "1 000 caractères au plus.";
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

export function validerRevue(s: SaisieRevue): Resultat<ChargeRevue, ChampRevue> {
  const erreurs: Partial<Record<ChampRevue, string>> = {};
  if (!unNonVide(s.titre)) erreurs.titre = "Le titre de la revue est obligatoire.";
  else if (s.titre.trim().length > 200) erreurs.titre = "200 caractères au plus.";
  if (!unNonVide(s.date_prevue)) erreurs.date_prevue = "La date de la revue est obligatoire.";
  else if (!dateValide(s.date_prevue)) erreurs.date_prevue = "Date invalide.";
  if (unNonVide(s.date_reference) && !dateValide(s.date_reference)) {
    erreurs.date_reference = "Date invalide.";
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

export function validerDecision(s: SaisieDecision): Resultat<ChargeDecision, ChampDecision> {
  const erreurs: Partial<Record<ChampDecision, string>> = {};
  if (!unNonVide(s.libelle)) erreurs.libelle = "Le libellé de la décision est obligatoire.";
  else if (s.libelle.trim().length > 500) erreurs.libelle = "500 caractères au plus.";
  if (unNonVide(s.echeance) && !dateValide(s.echeance)) erreurs.echeance = "Date invalide.";
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
): Resultat<{ statut: typeof statut; motif?: string; commentaire?: string }, "motif"> {
  if (statut === "abandonnee") {
    if (!unNonVide(texte)) return { ok: false, erreurs: { motif: "Un motif est obligatoire." } };
    if (texte.trim().length > 500)
      return { ok: false, erreurs: { motif: "500 caractères au plus." } };
    return { ok: true, charge: { statut, motif: texte.trim() } };
  }
  if (statut === "executee") {
    if (!unNonVide(texte)) {
      return {
        ok: false,
        erreurs: { motif: "Dites ce qui a été fait pour exécuter la décision." },
      };
    }
    if (texte.trim().length > 1000)
      return { ok: false, erreurs: { motif: "1 000 caractères au plus." } };
    return { ok: true, charge: { statut, commentaire: texte.trim() } };
  }
  return { ok: true, charge: { statut } };
}

/** Compte rendu d'une revue : 8 000 caractères au plus ; saisi avant ou à la tenue, puis figé. */
export const COMPTE_RENDU_MAX = 8000;
export function validerCompteRendu(
  texte: string,
): Resultat<{ compte_rendu?: string }, "compte_rendu"> {
  if (texte.trim().length > COMPTE_RENDU_MAX) {
    return { ok: false, erreurs: { compte_rendu: "8 000 caractères au plus." } };
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
export function validerOrdreDuJour(texte: string): Resultat<{ points: PointSaisi[] }, "points"> {
  const lignes = texte
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");
  if (lignes.length === 0) {
    return { ok: false, erreurs: { points: "Saisissez au moins un point, un par ligne." } };
  }
  if (lignes.length > POINTS_ORDRE_DU_JOUR_MAX) {
    return { ok: false, erreurs: { points: `${POINTS_ORDRE_DU_JOUR_MAX} points au plus.` } };
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
        erreurs: { points: `Ligne ${i + 1} : un libellé de 1 à 300 caractères est attendu.` },
      };
    }
    if (!Number.isInteger(duree) || duree < 1 || duree > 240) {
      return {
        ok: false,
        erreurs: { points: `Ligne ${i + 1} : une durée entière de 1 à 240 minutes est attendue.` },
      };
    }
    points.push({ libelle, duree_minutes: duree });
  }
  return { ok: true, charge: { points } };
}
