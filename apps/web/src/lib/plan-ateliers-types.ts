/** Ateliers stratégiques (PLA-15) : contrats de l'API (cabinet et portail). */
import type { MethodeAtelier, StatutAtelier } from "@missionpilot/shared";

/* ----- Contrats de l'API (cabinet) ----- */

export interface OptionAtelierApi {
  id: string;
  rang: number;
  libelle: string;
  description: string | null;
}

export interface AtelierResume {
  id: string;
  titre: string;
  statut: StatutAtelier;
  methodes: MethodeAtelier[];
  nombre_options: number;
  nombre_participants: number;
  cree_le: string;
  ouvert_le: string | null;
  clos_le: string | null;
}

export interface PageAteliers {
  elements: AtelierResume[];
  curseur_suivant: string | null;
}

export interface ParticipantAtelier {
  id: string;
  utilisateur_id: string;
  partie: "cabinet" | "client";
  nom: string;
  invite_le: string;
}

export interface ParticipationAtelier {
  invites: number;
  ayant_contribue: number | null;
  /** Centièmes de pourcent (6667 = 66,67 %), calculé par le moteur. */
  taux_centiemes_pourcent: number | null;
}

interface ParticipationMoteur {
  participants: number;
  invites: number;
  tauxCentiemesPourcent: number | null;
}

export interface LigneVoteResultat {
  optionId: string;
  points: number;
  votants: number;
  partCentiemesPourcent: number;
  rang: number;
}
export interface LignePriorisationResultat {
  optionId: string;
  pointsBorda: number;
  rangMoyenCentiemes: number | null;
  nombreClassements: number;
  foisPremiere: number;
  rang: number;
}
export interface LigneMatriceResultat {
  optionId: string;
  moyenneXCentiemes: number | null;
  moyenneYCentiemes: number | null;
  dispersionX: number;
  dispersionY: number;
  contributeurs: number;
  quadrant: string | null;
  consensus: boolean;
  rang: number;
}

/** Méthode dont l’agrégat est masqué par l’API (moins de participants que le seuil) : aucun chiffre. */
export interface MethodeMasquee {
  resultat: null;
  masque_seuil: true;
  seuil_participants: number;
}

/** Message affiché pour une méthode (ou l’atelier) dont les agrégats sont masqués. */
export const phraseMasque = (seuil: number | undefined): string =>
  `Agrégats masqués : au moins ${seuil ?? 3} participants requis.`;

/** Agrégats figés à la clôture (sortie du moteur `synthetiserAtelier`). */
export interface ResultatsAtelier {
  moteur: string;
  invites: number;
  vote?:
    | MethodeMasquee
    | {
        resultat: {
          budgetPoints: number;
          totalPoints: number;
          options: LigneVoteResultat[];
          participation: ParticipationMoteur;
        };
      };
  priorisation?:
    | MethodeMasquee
    | {
        resultat: { options: LignePriorisationResultat[]; participation: ParticipationMoteur };
      };
  matrice?:
    | MethodeMasquee
    | {
        resultat: {
          axes: {
            x: { libelle: string; inverse?: boolean };
            y: { libelle: string; inverse?: boolean };
          };
          options: LigneMatriceResultat[];
          participation: ParticipationMoteur;
        };
      };
}

export interface AtelierDetail {
  id: string;
  plan_id: string;
  titre: string;
  consigne: string;
  statut: StatutAtelier;
  methodes: MethodeAtelier[];
  budget_points: number;
  plafond_par_option: number | null;
  axes: {
    x: { libelle: string; inverse: boolean };
    y: { libelle: string; inverse: boolean };
  };
  cree_le: string;
  ouvert_le: string | null;
  clos_le: string | null;
  options: OptionAtelierApi[];
  participants: ParticipantAtelier[];
  participation: ParticipationAtelier;
  resultats: ResultatsAtelier | null;
  /** Atelier clos sous le seuil de participants : agrégats masqués par l'API (anonymat). */
  masque_seuil?: boolean;
  /** Méthodes dont l'agrégat est masqué (seuil par méthode). */
  methodes_masquees?: MethodeAtelier[];
  seuil_participants?: number;
}

export interface Candidats {
  cabinet: { id: string; nom: string }[];
  dirigeants: { id: string; nom: string }[];
  /** Plafond de l'API atteint : la liste est incomplète. */
  tronque?: boolean;
}

/** SA contribution courante (cabinet ou portail) : jamais celle d'un autre. */
export interface MaContribution {
  version: number;
  depose_le: string;
  points?: { option_id: string; points: number }[];
  classement?: string[];
  positions?: { option_id: string; x: number; y: number }[];
}
export type MesContributions = Partial<Record<MethodeAtelier, MaContribution>>;

/* ----- Contrats de l'API (portail) ----- */

export interface AtelierPortailResume {
  id: string;
  titre: string;
  methodes: MethodeAtelier[];
  ouvert_le: string;
  a_contribue: boolean;
}

export interface AtelierPortail {
  id: string;
  titre: string;
  consigne: string;
  methodes: MethodeAtelier[];
  points_a_repartir: number;
  plafond_points_par_option: number | null;
  axes: AtelierDetail["axes"];
  ouvert_le: string;
  options: { id: string; libelle: string; description: string | null }[];
  ma_contribution: MesContributions;
}
