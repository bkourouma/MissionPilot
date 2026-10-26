import type { PrevisionSpec, RealisesSpec, Series } from "./redressement-tresorerie.js";

/*
 * Trésorerie à 13 semaines de la mission « Brasseries du Wouri » : quatre versions successives
 * (fenêtre glissante), en millions de XOF par semaine. L'histoire : une tension marquée au
 * lancement (v1), atténuée par les accords avec les créanciers (v2, v3), puis un solde confortable
 * avant la clôture (v4). Les échéances des accords sont ajoutées aux séries par le semis (lignes
 * rattachées à leur créancier) : les séries ne portent que l'exploitation courante.
 */

const salairesMensuels = (m: number): number[] => [0, m, 0, 0, 0, m, 0, 0, 0, m, 0, 0, 0];
const impotsCourants = (m: number): number[] => [0, 0, m, 0, 0, 0, m, 0, 0, 0, m, 0, 0];
const loyers = [150, 100, 0, 150, 0, 100, 0, 150, 0, 100, 0, 150, 0];

/** Prévision de départ, avant tout accord : tension dès la sixième semaine. */
const SERIES_V1: Series = {
  clients: [1350, 1300, 1250, 1300, 1200, 1300, 1350, 1400, 1400, 1450, 1450, 1500, 1500],
  fournisseurs: [950, 950, 1000, 1000, 1050, 1050, 1050, 1050, 1050, 1050, 1050, 1100, 1100],
  salaires: salairesMensuels(1250),
  fiscal_social: [0, 0, 550, 0, 0, 0, 550, 0, 0, 0, 550, 0, 0],
  loyers_charges: loyers,
  service_dette: [0, 0, 0, 400, 0, 700, 0, 400, 0, 0, 0, 400, 0],
  investissements: [0, 0, 0, 0, 400, 0, 0, 0, 300, 0, 0, 0, 0],
};

const SERIES_V2: Series = {
  clients: [1350, 1350, 1300, 1300, 1350, 1400, 1400, 1450, 1450, 1500, 1500, 1500, 1550],
  fournisseurs: [1000, 950, 950, 950, 1000, 1000, 1000, 1000, 1000, 1050, 1050, 1050, 1050],
  salaires: salairesMensuels(1250),
  fiscal_social: impotsCourants(300),
  loyers_charges: loyers,
  investissements: [0, 0, 0, 0, 250, 0, 0, 0, 0, 0, 0, 0, 0],
  // Concours de trésorerie obtenu de la banque dans le cadre de l'accord.
  financement: [0, 0, 0, 0, 0, 0, 0, 0, 0, 1000, 0, 0, 0],
};

const SERIES_V3: Series = {
  clients: [1550, 1550, 1500, 1550, 1600, 1600, 1550, 1600, 1650, 1650, 1650, 1700, 1700],
  fournisseurs: [1000, 1000, 1000, 1000, 1050, 1050, 1050, 1050, 1050, 1050, 1100, 1100, 1100],
  salaires: salairesMensuels(1300),
  fiscal_social: impotsCourants(300),
  loyers_charges: loyers,
  cessions: [0, 0, 0, 0, 0, 0, 0, 0, 2400, 0, 0, 0, 0],
};

const SERIES_V4: Series = {
  clients: [1600, 1600, 1550, 1600, 1650, 1650, 1650, 1700, 1700, 1700, 1750, 1750, 1750],
  fournisseurs: [1100, 1100, 1100, 1100, 1150, 1150, 1150, 1150, 1200, 1200, 1200, 1200, 1200],
  salaires: salairesMensuels(1300),
  fiscal_social: impotsCourants(300),
  loyers_charges: loyers,
};

export const TRESORERIE_M3: readonly { spec: PrevisionSpec; realises: RealisesSpec }[] = [
  {
    spec: {
      debut: "2025-03-24",
      creee: "2025-03-24",
      soldeInitial: 3_400,
      seuilTension: 1_000,
      motif: "Prévision initiale établie avec la direction financière.",
      series: SERIES_V1,
    },
    realises: {
      semaines: 4,
      clients: [88, 96],
      fournisseurs: [100, 106],
      commentaires: { 2: "Un grand distributeur a retardé son règlement de deux semaines." },
      saisieAuPlusTard: "2025-04-21",
    },
  },
  {
    spec: {
      debut: "2025-04-21",
      creee: "2025-04-22",
      soldeInitial: 2_300,
      seuilTension: 1_000,
      motif: "Révision après les accords conclus avec la banque et les premiers fournisseurs.",
      series: SERIES_V2,
    },
    realises: {
      semaines: 10,
      clients: [90, 100],
      fournisseurs: [97, 104],
      commentaires: {
        6: "Première mensualité versée à la banque à la date convenue.",
        8: "Approvisionnement de malt payé comptant pour sécuriser la livraison.",
      },
      saisieAuPlusTard: "2025-06-30",
    },
  },
  {
    spec: {
      debut: "2025-06-30",
      creee: "2025-07-01",
      soldeInitial: 1_700,
      seuilTension: 1_000,
      motif:
        "Fenêtre glissante : accords en cours d'exécution, cession des entrepôts prévue en août.",
      series: SERIES_V3,
    },
    realises: {
      semaines: 9,
      clients: [95, 103],
      fournisseurs: [97, 103],
      commentaires: { 9: "Cession des entrepôts de Bonabéri encaissée avec une semaine d'avance." },
      saisieAuPlusTard: "2025-09-01",
    },
  },
  {
    spec: {
      debut: "2025-09-01",
      creee: "2025-09-02",
      soldeInitial: 4_600,
      seuilTension: 1_000,
      motif: "Dernière fenêtre avant la clôture : accords soldés et retour à un solde confortable.",
      series: SERIES_V4,
    },
    realises: {
      semaines: 10,
      clients: [97, 104],
      fournisseurs: [97, 104],
      saisieAuPlusTard: "2025-11-10",
    },
  },
];
