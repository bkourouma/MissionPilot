/** IA : paramètres du cabinet (contrat de l'API, source de clé, mode effectif). */
import type { CritereRoutageIa, TacheIa } from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";

export type SourceCleIa = "cabinet" | "plateforme";
export type ModeIa = "ia" | "gabarit";

export interface ModeleTacheIa {
  tache: TacheIa;
  modele: string;
  recommande: string;
  personnalise: boolean;
}

/** Ligne du routage exposée par GET /api/ia/parametres (apps/api/src/ia/parametres.ts, `vueRoutage`). */
export interface RouteTacheIa {
  tache: TacheIa;
  modele_recommande: string;
  modele_applique: string;
  personnalise: boolean;
  critere: CritereRoutageIa;
  motif: string;
  plafond_jetons_sortie: number | null;
}

/**
 * GET/PUT /api/ia/parametres. L'IA est désactivée (`ia_activee` faux, `mode` « gabarit ») tant
 * que le cabinet ne l'a pas activée explicitement. Plafonds, modèles autorisés et dates :
 * présents avec « ia.configurer » seulement. La réponse ne dit pas si la clé du cabinet est
 * lisible : seul le test de connexion (409 CLE_IA_ILLISIBLE) et l'alerte aux associés le
 * signalent.
 */
export interface ParametresIa {
  fournisseur: string;
  ia_activee: boolean;
  cle_configuree: boolean;
  cle_plateforme_disponible: boolean;
  source_cle: SourceCleIa | null;
  mode: ModeIa;
  modeles: ModeleTacheIa[];
  /** Routage documentaire des modèles par tâche (AGT-06), lisible avec « ia.utiliser ». */
  routage: RouteTacheIa[];
  /** Cache des réponses (AGT-06) : désactivé par défaut. */
  cache_actif: boolean;
  /** Durée de vie d'une entrée du cache, en heures (24 au plus). */
  cache_duree_heures: number;
  plafond_mensuel_micro_usd?: number;
  /** Plafond fixé par l'opérateur pour les appels faits avec la clé de la plateforme. */
  plafond_plateforme_micro_usd?: number;
  /**
   * Plafond réellement appliqué ce mois : celui du cabinet, borné par celui de l'opérateur quand
   * la clé de la plateforme est utilisée.
   */
  plafond_effectif_micro_usd?: number;
  /** Liste FERMÉE des modèles qu'un cabinet peut choisir (tarif connu de l'API). */
  modeles_autorises?: string[];
  cle_modifiee_le?: string | null;
  modifie_par?: string | null;
  modifie_le?: string | null;
}

/** POST /api/ia/parametres/tester. */
export interface ResultatTestIa {
  ok: boolean;
  tache: TacheIa;
  modele?: string;
  modele_servi?: string | null;
  source_cle?: SourceCleIa;
  duree_ms?: number;
  tokens_entree?: number;
  tokens_sortie?: number;
}

export const SOURCE_CLE_LIBELLES: Record<SourceCleIa, string> = {
  cabinet: "Clé du cabinet",
  plateforme: "Clé de la plateforme MissionPilot",
};

export const libelleSourceCle = (s: SourceCleIa | null) =>
  s ? SOURCE_CLE_LIBELLES[s] : "Aucune clé disponible";

/** « … a répondu avec la clé du cabinet ». */
export const SOURCE_CLE_PHRASES: Record<SourceCleIa, string> = {
  cabinet: "la clé du cabinet",
  plateforme: "la clé de la plateforme MissionPilot",
};

/** Mode effectif : texte, tonalité et explication (la couleur ne porte jamais seule le sens). */
export function presentationMode(p: Pick<ParametresIa, "mode" | "ia_activee" | "source_cle">): {
  libelle: string;
  tonalite: TonaliteStatut;
  explication: string;
} {
  if (p.mode === "ia") {
    return {
      libelle: "IA active",
      tonalite: "succes",
      explication:
        "Les contenus sont rédigés par le modèle choisi pour chaque tâche, puis relus et validés par un consultant.",
    };
  }
  const raison = !p.ia_activee
    ? "L'IA est désactivée tant que le cabinet ne l'a pas activée (bouton « Activer l'IA »)."
    : "Aucune clé API n'est disponible.";
  return {
    libelle: "Mode gabarit",
    tonalite: "neutre",
    explication: `${raison} Les contenus sont produits par des gabarits déterministes, sans appel à un modèle, et suivent la même validation humaine.`,
  };
}

/** Message après activation ou désactivation : sans clé disponible, l'IA activée reste en gabarit. */
export function messageActivation(activer: boolean, source: SourceCleIa | null): string {
  if (!activer) return "IA désactivée : les contenus seront produits par les gabarits.";
  return source
    ? "IA activée pour le cabinet."
    : "IA activée, mais aucune clé API n'est disponible : les contenus restent produits par les gabarits jusqu'à l'enregistrement d'une clé.";
}
