import {
  cleCase,
  cleTache,
  trierRangees,
  valeurVersTexte,
  type Rangee,
  type UniteSaisie,
} from "./temps";

/*
 * Pré-remplissage des temps (AUT-09) : types de la réponse de `GET /api/temps/preremplissage`
 * et application d'une sélection à la grille. Rien n'est enregistré ici : la grille change
 * seulement dans l'écran, le consultant relit puis enregistre ou soumet comme d'habitude.
 */

export type SourceProposition = "affectation" | "activite" | "affectation_et_activite";
export type ConfianceProposition = "haute" | "moyenne" | "faible";

export interface PropositionTemps {
  date: string;
  mission_id: string;
  tache_id: string;
  mission_intitule: string | null;
  tache_libelle: string | null;
  jours: number;
  heures: number;
  source: SourceProposition;
  confiance: ConfianceProposition;
  raisons: string[];
}

export interface ReponsePreRemplissage {
  feuille_modifiable: boolean;
  propositions: PropositionTemps[];
  ecartees: { date: string; motif: string; jours: number }[];
  total_jours: number;
  activite_ignoree?: number;
  sources: { affectations: boolean; activite_plateforme: boolean; agenda: boolean };
}

export const LIBELLE_SOURCE: Record<SourceProposition, string> = {
  affectation: "Affectation",
  activite: "Activité sur la plateforme",
  affectation_et_activite: "Affectation et activité",
};

export const LIBELLE_CONFIANCE: Record<ConfianceProposition, string> = {
  haute: "Confiance haute",
  moyenne: "Confiance moyenne",
  faible: "Confiance faible",
};

export const LIBELLE_MOTIF_ECARTE: Record<string, string> = {
  jour_verrouille: "période clôturée",
  jour_non_travaille: "jour non travaillé",
  deja_saisi: "déjà saisi",
  capacite_atteinte: "capacité du jour atteinte",
};

/** Clé stable d'une proposition (une par jour et par tâche). */
export const clePropositionTemps = (p: Pick<PropositionTemps, "date" | "tache_id">) =>
  `${p.date}|${p.tache_id}`;

/** Les propositions cochées par défaut : tout, sauf celles de confiance faible. */
export function selectionParDefaut(propositions: readonly PropositionTemps[]): Set<string> {
  return new Set(propositions.filter((p) => p.confiance !== "faible").map(clePropositionTemps));
}

export interface EtatGrille {
  rangees: Rangee[];
  valeurs: Record<string, string>;
}

export interface ResultatApplication extends EtatGrille {
  appliquees: number;
  /** Cases déjà renseignées par le consultant : jamais écrasées. */
  conservees: number;
}

/**
 * Applique les propositions retenues à la grille : une rangée est ajoutée pour une tâche
 * absente, une case VIDE reçoit la valeur proposée ; une case déjà remplie n'est jamais
 * modifiée.
 */
export function appliquerPropositions(
  etat: EtatGrille,
  propositions: readonly PropositionTemps[],
  unite: UniteSaisie,
): ResultatApplication {
  const valeurs = { ...etat.valeurs };
  const rangees = [...etat.rangees];
  let appliquees = 0;
  let conservees = 0;
  for (const p of propositions) {
    const cle = cleTache(p.tache_id);
    if (!rangees.some((r) => r.cle === cle)) {
      rangees.push({
        cle,
        type: "tache",
        id: p.tache_id,
        libelle: p.tache_libelle ?? "Tâche",
        groupe: p.mission_intitule ?? "Mission",
        mission_id: p.mission_id,
      });
    }
    const caseCle = cleCase(cle, p.date);
    if ((valeurs[caseCle] ?? "").trim() !== "") {
      conservees += 1;
      continue;
    }
    valeurs[caseCle] = valeurVersTexte(unite === "heure" ? p.heures : p.jours);
    appliquees += 1;
  }
  return { rangees: trierRangees(rangees), valeurs, appliquees, conservees };
}
