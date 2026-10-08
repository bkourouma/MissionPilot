/**
 * Agrégation d'une arborescence mission > phase > lot > tâche (PLN-01,
 * PLN-02, TPS-06). Les budgets, réalisés et restes à faire des feuilles
 * remontent par somme ; un nœud qui a des enfants ignore ses propres valeurs.
 */
import {
  type AlerteSuivi,
  type LigneSuivi,
  type SeuilsSuivi,
  type StatutCouleur,
  type SuiviCalcule,
  SEUILS_SUIVI_DEFAUT,
  calculerSuivi,
  detecterAlertes,
  sommerLignes,
  statutCouleur,
} from "./suivi-budget";

/** Niveau du découpage ; le lot est facultatif entre phase et tâche. */
export type NiveauPlanning = "mission" | "phase" | "lot" | "tache";

const RANG: Readonly<Record<NiveauPlanning, number>> = { mission: 0, phase: 1, lot: 2, tache: 3 };

/** Nœud saisi. Les valeurs ne sont lues que sur les feuilles (défaut 0). */
export interface NoeudPlanning {
  readonly id: string;
  readonly niveau: NiveauPlanning;
  readonly libelle?: string;
  readonly budget?: number;
  readonly realise?: number;
  readonly resteAFaire?: number;
  readonly enfants?: readonly NoeudPlanning[];
}

/** Nœud agrégé, avec suivi calculé et couleur. */
export interface NoeudAgrege {
  readonly id: string;
  readonly niveau: NiveauPlanning;
  readonly libelle?: string;
  readonly suivi: SuiviCalcule;
  readonly couleur: StatutCouleur;
  readonly enfants: readonly NoeudAgrege[];
}

function valeursFeuille(n: NoeudPlanning): LigneSuivi {
  return { budget: n.budget ?? 0, realise: n.realise ?? 0, resteAFaire: n.resteAFaire ?? 0 };
}

function verifierEnfant(parent: NoeudPlanning, enfant: NoeudPlanning): void {
  if (RANG[enfant.niveau] <= RANG[parent.niveau]) {
    throw new RangeError(
      `Niveau incohérent : « ${enfant.id} » (${enfant.niveau}) sous « ${parent.id} » (${parent.niveau})`,
    );
  }
}

/** Agrège récursivement l'arborescence et colore chaque nœud. */
export function agregerArborescence(
  noeud: NoeudPlanning,
  seuils: SeuilsSuivi = SEUILS_SUIVI_DEFAUT,
): NoeudAgrege {
  const sources = noeud.enfants ?? [];
  for (const e of sources) verifierEnfant(noeud, e);
  const enfants = sources.map((e) => agregerArborescence(e, seuils));
  const ligne =
    enfants.length === 0 ? valeursFeuille(noeud) : sommerLignes(enfants.map((e) => e.suivi));
  return {
    id: noeud.id,
    niveau: noeud.niveau,
    ...(noeud.libelle === undefined ? {} : { libelle: noeud.libelle }),
    suivi: calculerSuivi(ligne),
    couleur: statutCouleur(ligne, seuils),
    enfants,
  };
}

/** Alerte rattachée au nœud qui la porte. */
export interface AlerteNoeud extends AlerteSuivi {
  readonly noeudId: string;
  readonly niveau: NiveauPlanning;
}

/** Parcourt l'arborescence agrégée et collecte les alertes (TPS-07), en préordre. */
export function alertesArborescence(
  noeud: NoeudAgrege,
  seuilConsommationPct = SEUILS_SUIVI_DEFAUT.consommationOrangePct,
): AlerteNoeud[] {
  const propres = detecterAlertes(noeud.suivi, seuilConsommationPct).map((a) => ({
    ...a,
    noeudId: noeud.id,
    niveau: noeud.niveau,
  }));
  return [
    ...propres,
    ...noeud.enfants.flatMap((e) => alertesArborescence(e, seuilConsommationPct)),
  ];
}
