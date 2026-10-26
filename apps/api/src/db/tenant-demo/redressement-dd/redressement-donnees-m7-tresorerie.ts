import { M } from "./redressement-outils.js";
import type { LigneFinancement } from "./redressement-conformite.js";
import type { PrevisionSpec, RealisesSpec, Series } from "./redressement-tresorerie.js";

/*
 * Trésorerie, covenants et plan de financement du dossier « Gabon Offshore Services » (en millions
 * de XOF). Deux versions de prévision : la première (juillet 2026) montre un solde qui s'érode,
 * la seconde (septembre 2026), calée sur l'accord conclu avec la banque, montre une vraie tension
 * de trésorerie confirmée par les réalisés des dernières semaines (jusqu'au 12 octobre).
 */

const SERIES_V1: Series = {
  clients: [200, 190, 185, 190, 180, 185, 195, 200, 190, 195, 200, 200, 205],
  fournisseurs: [110, 105, 110, 105, 105, 100, 105, 105, 100, 105, 105, 100, 100],
  salaires: [0, 0, 230, 0, 0, 0, 230, 0, 0, 0, 230, 0, 0],
  fiscal_social: [0, 0, 0, 70, 0, 0, 0, 70, 0, 0, 0, 70, 0],
  loyers_charges: [0, 30, 0, 0, 30, 0, 0, 30, 0, 0, 30, 0, 0],
  service_dette: [0, 0, 0, 0, 85, 0, 0, 0, 85, 0, 0, 0, 85],
};

const SERIES_V2: Series = {
  clients: [185, 180, 195, 185, 190, 195, 200, 205, 205, 210, 215, 215, 220],
  fournisseurs: [100, 100, 100, 95, 95, 95, 100, 100, 100, 100, 100, 100, 100],
  salaires: [0, 0, 235, 0, 0, 0, 235, 0, 0, 0, 235, 0, 0],
  fiscal_social: [0, 0, 0, 70, 0, 0, 0, 70, 0, 0, 0, 70, 0],
  loyers_charges: [30, 0, 0, 0, 30, 0, 0, 0, 30, 0, 0, 0, 30],
};

export const TRESORERIE_M7: readonly { spec: PrevisionSpec; realises: RealisesSpec }[] = [
  {
    spec: {
      debut: "2026-07-13",
      creee: "2026-07-13",
      soldeInitial: 380,
      seuilTension: 300,
      motif:
        "Prévision initiale construite avec la direction financière (aucun prévisionnel existant).",
      series: SERIES_V1,
    },
    realises: {
      semaines: 8,
      clients: [86, 97],
      fournisseurs: [98, 106],
      commentaires: {
        3: "Deux opérateurs ont décalé leurs règlements de trois semaines.",
        7: "Paiement partiel des salaires de juillet reporté sur août.",
      },
      saisieAuPlusTard: "2026-09-14",
    },
  },
  {
    spec: {
      debut: "2026-09-14",
      creee: "2026-09-21",
      soldeInitial: 130,
      seuilTension: 150,
      motif:
        "Révision après l'accord avec la banque : mensualités du crédit d'équipement intégrées.",
      series: SERIES_V2,
    },
    realises: {
      semaines: 5,
      clients: [82, 94],
      fournisseurs: [100, 107],
      commentaires: {
        2: "Encaissement d'un opérateur reporté à la semaine suivante.",
        5: "Première mensualité du crédit d'équipement réglée à la date convenue.",
      },
      saisieAuPlusTard: "2026-10-19",
    },
  },
];

const PRETEUR = "Banque Équatoriale d'Investissement (fictive)";

/** Covenants proposés par la banque avec l'accord de septembre 2026 (évalués sur l'exercice 2025). */
export const COVENANTS_M7 = [
  {
    ratio: "liquidite_generale",
    operateur: "min",
    seuil_pb: 10_000,
    frequence: "trimestrielle",
    preteur: PRETEUR,
  },
  {
    ratio: "endettement",
    operateur: "max",
    seuil_pb: 12_000,
    frequence: "semestrielle",
    preteur: PRETEUR,
  },
  {
    ratio: "autonomie_financiere",
    operateur: "min",
    seuil_pb: 2_000,
    frequence: "annuelle",
    preteur: PRETEUR,
  },
];

const ligne = (
  periode: number,
  sens: "emploi" | "ressource",
  nature: string,
  montant: number,
  libelle?: string,
): LigneFinancement => ({ periode, sens, nature, montant, ...(libelle ? { libelle } : {}) });

/** Plan de financement provisoire sur trois semestres (brouillon de travail, octobre 2026). */
export const FINANCEMENT_M7: readonly LigneFinancement[] = [
  ligne(
    1,
    "emploi",
    "remboursement_dettes_accords",
    1_450 * M,
    "Accord avec la banque (quatre premières mensualités)",
  ),
  ligne(1, "emploi", "besoin_fonds_roulement", 400 * M),
  ligne(1, "ressource", "autofinancement", 700 * M),
  ligne(1, "ressource", "report_echeances_obtenu", 600 * M),
  ligne(2, "emploi", "remboursement_dettes_accords", 1_450 * M),
  ligne(2, "emploi", "charges_restructuration", 150 * M),
  ligne(2, "ressource", "cessions_actifs", 520 * M, "Navire d'appui inutilisé"),
  ligne(2, "ressource", "apport_associes", 500 * M),
  ligne(2, "ressource", "autofinancement", 650 * M),
  ligne(3, "emploi", "investissements", 200 * M),
  ligne(3, "ressource", "autofinancement", 450 * M),
];

export const CADRE_FINANCEMENT_M7 = {
  date_debut: "2026-10-01",
  type_periode: "semestre",
  nombre_periodes: 3,
} as const;
