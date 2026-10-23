import { z } from "zod";
import type { Devise } from "./commun";
import type { RedClotureDossierResume } from "./redressement-cloture";
import type { RedCovenantStatut, RedFinancementTypePeriode } from "./redressement-financement";
import {
  RED_SECTEURS,
  RED_STATUTS_DOSSIER,
  type RedNiveauAlerte,
  type RedSecteur,
  type RedStatutDossier,
  type RedStatutAction,
  type RedVoyant,
} from "./redressement";

/*
 * Service #5 « Redressement », lot 2 (RED-15, version INTERNE) : tableau de bord de pilotage d'un
 * dossier et du portefeuille des dossiers visibles. Contrat des routes
 * GET /api/redressement/dossiers/:id/tableau-de-bord et GET /api/redressement/tableau-de-bord.
 *
 * - Aucune saisie : ces routes ne font que lire. Aucun chiffre n'est calculé par l'API : le
 *   voyant et ses motifs sortent de `calculerEtatVoyant` (packages/engines), les autres chiffres
 *   des services existants (trésorerie, covenants, plan de financement, plan d'actions, suivi).
 * - Le voyant est INDICATIF : une aide de pilotage, jamais une qualification juridique.
 * - Les listes d'énumérations sont DUPLIQUÉES (`packages/shared` n'importe pas les moteurs) ;
 *   un test d'API en vérifie la parité avec le moteur.
 * - Version interne seulement : aucun partage au portail ni à un tiers (décision du lot 2).
 */

/* ----- Constantes et libellés ----- */

export const RED_VOYANTS_PILOTAGE = ["rouge", "orange", "vert", "inconnu"] as const;
export type RedVoyantPilotage = (typeof RED_VOYANTS_PILOTAGE)[number];
export const RED_VOYANT_PILOTAGE_LIBELLES: Record<RedVoyantPilotage, string> = {
  rouge: "Priorité haute",
  orange: "Vigilance",
  vert: "Sous contrôle",
  inconnu: "Non déterminé",
};

export const RED_GRAVITES_MOTIF = ["critique", "vigilance", "information"] as const;
export type RedGraviteMotif = (typeof RED_GRAVITES_MOTIF)[number];
export const RED_GRAVITE_MOTIF_LIBELLES: Record<RedGraviteMotif, string> = {
  critique: "Point critique",
  vigilance: "Point de vigilance",
  information: "Information",
};

export const RED_CODES_MOTIF_VOYANT = [
  "URGENCE_ROUGE",
  "URGENCE_ORANGE",
  "ALERTE_CRITIQUE",
  "ALERTE_ELEVEE",
  "ALERTE_MODEREE",
  "TRESORERIE_TENSION_PROLONGEE",
  "TRESORERIE_TENSION",
  "COVENANTS_DEFAUT_MULTIPLES",
  "COVENANT_DEFAUT",
  "ACTIONS_RETARD_NOMBREUSES",
  "ACTIONS_RETARD",
  "SUIVI_ATTENTION",
  "SUIVI_INFORMATION",
  "CLOTURE_ABSENTE",
  "CLOTURE_BROUILLON",
] as const;
export type RedCodeMotifVoyant = (typeof RED_CODES_MOTIF_VOYANT)[number];
/** Intitulés courts des motifs (le libellé détaillé, avec les nombres, vient du moteur). */
export const RED_MOTIF_VOYANT_LIBELLES: Record<RedCodeMotifVoyant, string> = {
  URGENCE_ROUGE: "Diagnostic d'urgence au rouge",
  URGENCE_ORANGE: "Diagnostic d'urgence à l'orange",
  ALERTE_CRITIQUE: "Alerte précoce au niveau critique",
  ALERTE_ELEVEE: "Alerte précoce au niveau élevé",
  ALERTE_MODEREE: "Alerte précoce au niveau modéré",
  TRESORERIE_TENSION_PROLONGEE: "Tension de trésorerie prolongée",
  TRESORERIE_TENSION: "Tension de trésorerie",
  COVENANTS_DEFAUT_MULTIPLES: "Plusieurs covenants non respectés",
  COVENANT_DEFAUT: "Covenant non respecté",
  ACTIONS_RETARD_NOMBREUSES: "Nombreuses actions en retard",
  ACTIONS_RETARD: "Action en retard",
  SUIVI_ATTENTION: "Point d'attention du suivi après mission",
  SUIVI_INFORMATION: "Information du suivi après mission",
  CLOTURE_ABSENTE: "Bilan de clôture à établir",
  CLOTURE_BROUILLON: "Bilan de clôture en brouillon",
};

export const RED_TABLEAU_MENTION =
  "Le voyant de pilotage est un indicateur interne, calculé à partir des données saisies dans le dossier : il aide à ordonner les priorités et ne qualifie pas la situation juridique du client.";

/** Un calcul par dossier est coûteux : la page du portefeuille est volontairement courte. */
export const RED_TABLEAU_LIMITE_MAX = 25;
export const RED_TABLEAU_LIMITE_DEFAUT = 10;

/* ----- Requête du portefeuille ----- */

export const redTableauPortefeuilleQuerySchema = z
  .object({
    limite: z.coerce
      .number()
      .int()
      .min(1)
      .max(RED_TABLEAU_LIMITE_MAX)
      .default(RED_TABLEAU_LIMITE_DEFAUT),
    curseur: z.string().max(500).optional(),
    statut: z.enum(RED_STATUTS_DOSSIER).optional(),
    secteur: z.enum(RED_SECTEURS).optional(),
  })
  .strict();
export type RedTableauPortefeuilleQuery = z.infer<typeof redTableauPortefeuilleQuerySchema>;

/* ----- Vues ----- */

export interface RedMotifVoyantVue {
  code: RedCodeMotifVoyant;
  gravite: RedGraviteMotif;
  libelle: string;
}

export interface RedVoyantPilotageVue {
  voyant: RedVoyantPilotage;
  /** Du plus grave au moins grave. */
  motifs: RedMotifVoyantVue[];
  /** Toujours vrai : le voyant est indicatif. */
  indicatif: true;
}

/** Un indicateur clé avec sa source et sa date (aucune valeur sans source). */
export interface RedIndicateurTableauVue {
  cle:
    | "voyant_urgence"
    | "niveau_alerte"
    | "score_alerte"
    | "semaines_tension"
    | "covenants_en_defaut"
    | "actions_en_retard"
    | "alertes_suivi";
  libelle: string;
  /** Nombre, ou code (voyant, niveau) à libeller côté affichage ; null si non disponible. */
  valeur: number | string | null;
  /** Origine de la valeur (module du dossier). */
  source: string;
  /** Date de la donnée source (AAAA-MM-JJ ou horodatage ISO) ; null si la source n'est pas datée. */
  date: string | null;
}

export interface RedTableauDossierIdentiteVue {
  id: string;
  mission: { id: string; intitule: string };
  client: { id: string; raison_sociale: string };
  intitule: string;
  secteur: RedSecteur;
  devise: Devise;
  statut: RedStatutDossier;
  ouvert_le: string;
  clos_le: string | null;
}

export interface RedTableauTresorerieMensuelleVue {
  mois_tension: string[];
  premier_mois_tension: string | null;
  solde_minimum: { mois: string; semaine: number; montant: number };
  totaux: { encaissements: number; decaissements: number; flux_net: number };
}

export interface RedTableauTresorerieVue {
  version: number;
  date_debut: string;
  semaines_tension: number[];
  premiere_semaine_tension: number | null;
  solde_minimum: { semaine: number; montant: number };
  besoin_financement: number;
  derniere_semaine_realisee: number | null;
  /** Synthèse mensuelle (moteur d'agrégation) ; null si indisponible. */
  mensuel: RedTableauTresorerieMensuelleVue | null;
}

export interface RedTableauCovenantsVue {
  version: number;
  exercice: number | null;
  nombre: number;
  respectes: number;
  en_defaut: number;
  non_calculables: number;
  covenants: { ratio: string; preteur: string | null; statut: RedCovenantStatut }[];
}

export interface RedTableauFinancementVue {
  version: number;
  date_debut: string;
  type_periode: RedFinancementTypePeriode;
  nombre_periodes: number;
  equilibre: boolean;
  totaux: { emplois: number; ressources: number; solde: number };
  couverture_totale_pb: number | null;
  premiere_periode_insuffisance: number | null;
  insuffisance_maximale_cumulee: number;
}

export interface RedTableauPlanVue {
  actions_par_statut: Record<RedStatutAction, number>;
  en_retard: number;
  version_courante: number | null;
  modifie_depuis_validation: boolean;
}

/**
 * Cartographie des causes. `statut = "validee"` : dernière version validée par un expert
 * (`nombre_causes` renseigné). `statut = "non_validee"` : il n'existe que des propositions non
 * validées, jamais présentées comme acquises (`nombre_causes` est null).
 */
export interface RedTableauCausesVue {
  statut: "validee" | "non_validee";
  version: number;
  valide_le: string | null;
  nombre_causes: number | null;
  /** Une version plus récente existe mais n'est pas validée. */
  version_plus_recente_non_validee: boolean;
}

export interface RedTableauCreanciersVue {
  nombre: number;
  encours_total: number;
  echu_total: number;
}

export interface RedTableauSuiviVue {
  nombre: number;
  attention: number;
}

/** GET /api/redressement/dossiers/:id/tableau-de-bord : chaque bloc absent vaut null. */
export interface RedTableauDossierVue {
  dossier: RedTableauDossierIdentiteVue;
  date_calcul: string;
  voyant: RedVoyantPilotageVue;
  indicateurs: RedIndicateurTableauVue[];
  tresorerie: RedTableauTresorerieVue | null;
  covenants: RedTableauCovenantsVue | null;
  financement: RedTableauFinancementVue | null;
  plan: RedTableauPlanVue | null;
  creanciers: RedTableauCreanciersVue | null;
  causes: RedTableauCausesVue | null;
  /** Bilan de clôture : null tant que le dossier n'est pas clos. */
  cloture: RedClotureDossierResume | null;
  /** Suivi après mission : null tant que le dossier n'est pas clos ou sans plan de suivi. */
  suivi: RedTableauSuiviVue | null;
  mention: string;
}

export interface RedTableauPortefeuilleElementVue {
  dossier: RedTableauDossierIdentiteVue;
  voyant: RedVoyantPilotage;
  /** Les plus graves (3 au plus). */
  motifs: RedMotifVoyantVue[];
  indicateurs: {
    dernier_voyant_urgence: RedVoyant | null;
    dernier_niveau_alerte: RedNiveauAlerte | null;
    dernier_score: number | null;
    semaines_tension: number | null;
    covenants_en_defaut: number | null;
    actions_en_retard: number;
  };
}

/** GET /api/redressement/tableau-de-bord : une page de dossiers de missions visibles. */
export interface RedTableauPortefeuilleVue {
  date_calcul: string;
  elements: RedTableauPortefeuilleElementVue[];
  suivant: string | null;
  /** Nombre de dossiers de CETTE page par voyant. */
  synthese_page: Record<RedVoyantPilotage, number>;
  mention: string;
}
