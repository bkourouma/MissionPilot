import { M } from "./redressement-outils.js";
import type { LigneFinancement } from "./redressement-conformite.js";

/*
 * Covenants bancaires et plan de financement de la mission « Brasseries du Wouri ». Les ratios
 * des covenants sont évalués par le moteur sur le dernier état financier accepté du client ; les
 * totaux et l'équilibre du plan de financement aussi. Seuils en points de base (10 000 = 1).
 */

const PRETEUR = "Banque Atlantique du Littoral (fictive)";

const covenant = (
  ratio: string,
  operateur: "min" | "max",
  seuil_pb: number,
  frequence: "trimestrielle" | "semestrielle" | "annuelle",
  avecPreteur = true,
) => ({ ratio, operateur, seuil_pb, frequence, ...(avecPreteur ? { preteur: PRETEUR } : {}) });

/** Version 1 (juin 2025) : seuils proposés par la banque, l'endettement est légèrement dépassé. */
export const COVENANTS_M3_V1 = [
  covenant("liquidite_generale", "min", 15_000, "trimestrielle"),
  covenant("endettement", "max", 4_000, "semestrielle"),
  covenant("autonomie_financiere", "min", 5_000, "annuelle"),
  covenant("liquidite_immediate", "min", 4_000, "trimestrielle"),
];

/** Version 2 (septembre 2025) : seuil d'endettement relevé après négociation. */
export const COVENANTS_M3_V2 = [
  covenant("liquidite_generale", "min", 15_000, "trimestrielle"),
  covenant("endettement", "max", 4_500, "semestrielle"),
  covenant("autonomie_financiere", "min", 5_000, "annuelle"),
  covenant("liquidite_immediate", "min", 4_000, "trimestrielle"),
  covenant("solvabilite_generale", "min", 12_000, "annuelle", false),
];

const ligne = (
  periode: number,
  sens: "emploi" | "ressource",
  nature: string,
  montant: number,
  libelle?: string,
): LigneFinancement => ({ periode, sens, nature, montant, ...(libelle ? { libelle } : {}) });

/** Plan sur trois années (2025 à 2027), version 1 de juillet 2025. */
export const FINANCEMENT_M3_V1: readonly LigneFinancement[] = [
  ligne(1, "emploi", "remboursement_dettes_accords", 8_400 * M, "Accords d'étalement signés"),
  ligne(1, "emploi", "besoin_fonds_roulement", 900 * M, "Reconstitution du fonds de roulement"),
  ligne(1, "emploi", "charges_restructuration", 350 * M),
  ligne(1, "ressource", "autofinancement", 4_200 * M),
  ligne(1, "ressource", "cessions_actifs", 2_400 * M, "Entrepôts de Bonabéri"),
  ligne(1, "ressource", "nouveaux_concours_bancaires", 1_000 * M),
  ligne(1, "ressource", "report_echeances_obtenu", 1_500 * M),
  ligne(2, "emploi", "investissements", 1_800 * M, "Modernisation de la ligne de conditionnement"),
  ligne(2, "ressource", "autofinancement", 2_600 * M),
  ligne(3, "emploi", "investissements", 1_200 * M),
  ligne(3, "ressource", "autofinancement", 1_900 * M),
];

/** Version 2 (octobre 2025) : cession encaissée, accords soldés, investissement avancé. */
export const FINANCEMENT_M3_V2: readonly LigneFinancement[] = [
  ligne(1, "emploi", "remboursement_dettes_accords", 8_400 * M, "Accords d'étalement soldés"),
  ligne(1, "emploi", "besoin_fonds_roulement", 700 * M),
  ligne(1, "emploi", "charges_restructuration", 320 * M),
  ligne(1, "ressource", "autofinancement", 5_100 * M),
  ligne(1, "ressource", "cessions_actifs", 2_400 * M, "Entrepôts de Bonabéri"),
  ligne(1, "ressource", "nouveaux_concours_bancaires", 1_000 * M),
  ligne(1, "ressource", "report_echeances_obtenu", 1_500 * M),
  ligne(2, "emploi", "investissements", 2_200 * M, "Modernisation de la ligne de conditionnement"),
  ligne(2, "ressource", "autofinancement", 3_100 * M),
  ligne(3, "emploi", "investissements", 1_200 * M),
  ligne(3, "ressource", "autofinancement", 2_000 * M),
];

export const CADRE_FINANCEMENT_M3 = {
  date_debut: "2025-01-01",
  type_periode: "annee",
  nombre_periodes: 3,
} as const;

/** Précisions ajoutées par les consultants aux causes proposées par le gabarit. */
export const PRECISION_CAUSES_M3_V1 =
  "Constat du consultant : les délais de paiement des distributeurs ont dérivé depuis 2024 et la direction ne suit pas les encours par client.";
export const PRECISION_CAUSES_M3_V2 =
  "Point de septembre : la dérive des délais de paiement est contenue ; les investissements de capacité restent à phaser.";
