import { M } from "./redressement-outils.js";
import type { CreancierDef } from "./redressement-creanciers.js";

/*
 * Créanciers du dossier « Gabon Offshore Services » (noms fictifs, montants en XOF) : un accord en
 * cours d'exécution (banque, première mensualité payée) et quatre négociations ouvertes sans accord.
 * Le reste dû, l'échu et l'avancement de l'accord sont calculés par le moteur à chaque lecture.
 */

export const CREANCIERS_M7: readonly CreancierDef[] = [
  {
    nom: "Banque Équatoriale d'Investissement (fictive)",
    categorie: "banque",
    garanti: true,
    reference: "CT-2025-044",
    principal: 3_000 * M,
    interets: 210 * M,
    arrete: "2026-08-31",
    echeanceInitiale: "2026-07-31",
    nature: "Crédit d'équipement des navires d'appui",
    creeLe: "2026-08-18",
    par: "chef",
    evenements: [
      {
        jour: "2026-08-18",
        par: "chef",
        type: "ouverture",
        conditions: "Rendez-vous avec la direction des entreprises de la banque.",
      },
      {
        jour: "2026-09-04",
        par: "chef",
        type: "proposition",
        montant: 2_900 * M,
        conditions:
          "Huit mensualités à compter d'octobre, remise partielle des intérêts de retard.",
      },
      {
        jour: "2026-09-18",
        par: "chef",
        type: "accord",
        montant: 2_900 * M,
        conditions:
          "Huit mensualités à compter du 15 octobre 2026, remise partielle des intérêts de retard.",
        echeancier: { mode: "regulier", nombre: 8, premiere: "2026-10-15", periodiciteMois: 1 },
      },
      { jour: "2026-10-16", par: "consultant2", type: "paiement", rang: 1 },
    ],
  },
  {
    nom: "Société de Maintenance Navale du Gabon (fictive)",
    categorie: "fournisseur",
    garanti: false,
    reference: "FOU-2210",
    principal: 1_300 * M,
    interets: 0,
    arrete: "2026-08-31",
    echeanceInitiale: "2026-06-30",
    nature: "Sous-traitance de maintenance des navires",
    creeLe: "2026-08-24",
    par: "consultant2",
    evenements: [
      {
        jour: "2026-08-24",
        par: "consultant2",
        type: "ouverture",
        conditions: "Premier échange avec la direction commerciale du sous-traitant.",
      },
      {
        jour: "2026-09-02",
        par: "consultant2",
        type: "proposition",
        montant: 1_200 * M,
        conditions: "Étalement sur six mois à partir de novembre.",
      },
      {
        jour: "2026-09-16",
        par: "consultant2",
        type: "contre_proposition",
        montant: 1_300 * M,
        conditions: "Acompte de 30 % immédiat, solde en quatre mois.",
      },
      {
        jour: "2026-09-30",
        par: "consultant2",
        type: "creance",
        creance: {
          principal: 1_300 * M,
          interets: 30 * M,
          arrete: "2026-09-30",
          commentaire: "Pénalités contractuelles notifiées par le sous-traitant.",
        },
      },
      {
        jour: "2026-10-12",
        par: "consultant2",
        type: "note",
        conditions:
          "Réunion de conciliation fixée au 3 novembre ; le sous-traitant maintient les interventions urgentes.",
      },
    ],
  },
  {
    nom: "Direction générale des impôts — recouvrement (fictive)",
    categorie: "fiscal",
    garanti: false,
    principal: 620 * M,
    interets: 40 * M,
    arrete: "2026-08-31",
    echeanceInitiale: "2026-06-15",
    nature: "Impôts et taxes en retard de paiement",
    creeLe: "2026-09-10",
    par: "chef2",
    evenements: [
      {
        jour: "2026-09-10",
        par: "chef2",
        type: "ouverture",
        conditions: "Demande d'étalement déposée auprès du service de recouvrement.",
      },
      {
        jour: "2026-10-05",
        par: "chef2",
        type: "proposition",
        montant: 620 * M,
        conditions: "Six mensualités à compter de décembre, sans remise.",
      },
    ],
  },
  {
    nom: "Caisse de prévoyance sociale du Gabon (fictive)",
    categorie: "social",
    garanti: false,
    principal: 380 * M,
    interets: 12 * M,
    arrete: "2026-08-31",
    echeanceInitiale: "2026-07-15",
    nature: "Cotisations sociales en retard de paiement",
    creeLe: "2026-09-14",
    par: "chef2",
    evenements: [
      {
        jour: "2026-09-14",
        par: "chef2",
        type: "ouverture",
        conditions: "Courrier de demande de délai adressé à la direction régionale.",
      },
      {
        jour: "2026-10-02",
        par: "chef2",
        type: "note",
        conditions: "La caisse attend le plan de trésorerie actualisé avant de répondre.",
      },
    ],
  },
  {
    nom: "Immobilière du Cap Lopez (fictive)",
    categorie: "bailleur",
    garanti: false,
    principal: 260 * M,
    interets: 0,
    arrete: "2026-08-31",
    echeanceInitiale: "2026-08-01",
    nature: "Loyers des bureaux et du quai en retard de paiement",
    creeLe: "2026-09-08",
    par: "consultant2",
    evenements: [
      {
        jour: "2026-09-08",
        par: "consultant2",
        type: "ouverture",
        conditions: "Prise de contact avec le gestionnaire de l'immeuble.",
      },
      {
        jour: "2026-09-24",
        par: "consultant2",
        type: "proposition",
        montant: 230 * M,
        conditions: "Paiement en trois fois d'ici janvier, remise de 30 millions.",
      },
      {
        jour: "2026-10-08",
        par: "consultant2",
        type: "contre_proposition",
        montant: 260 * M,
        conditions: "Paiement en deux fois, sans remise.",
      },
    ],
  },
];
