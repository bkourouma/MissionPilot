import { M } from "./redressement-outils.js";
import type { CreancierDef, EvenementDef } from "./redressement-creanciers.js";

/*
 * Créanciers du dossier « Brasseries du Wouri » (noms fictifs, montants en XOF) : cinq créanciers
 * avec accords d'étalement, tous soldés avant la clôture du 14 novembre 2025. Les accords
 * (échéanciers) et le reste dû sont calculés par le moteur ; les paiements reprennent le montant
 * de l'échéance visée. Une saisie erronée est corrigée par une annulation de paiement (ajout seul).
 */

const paiement = (jour: string, rang: number, par: EvenementDef["par"]): EvenementDef => ({
  jour,
  par,
  type: "paiement",
  rang,
});

export const CREANCIERS_M3: readonly CreancierDef[] = [
  {
    nom: "Banque Atlantique du Littoral (fictive)",
    categorie: "banque",
    garanti: true,
    reference: "CT-2023-118",
    principal: 4_800 * M,
    interets: 320 * M,
    arrete: "2025-03-31",
    echeanceInitiale: "2025-02-28",
    nature: "Crédit de campagne",
    creeLe: "2025-04-02",
    par: "chef",
    evenements: [
      {
        jour: "2025-04-02",
        par: "chef",
        type: "ouverture",
        conditions: "Prise de contact avec le directeur d'agence, remise du plan de trésorerie.",
      },
      {
        jour: "2025-04-08",
        par: "chef",
        type: "proposition",
        montant: 4_600 * M,
        conditions: "Étalement sur six mensualités, remise partielle des intérêts de retard.",
      },
      {
        jour: "2025-04-11",
        par: "chef",
        type: "contre_proposition",
        montant: 5_120 * M,
        conditions: "Étalement sur quatre mensualités sans remise.",
      },
      {
        jour: "2025-04-15",
        par: "chef",
        type: "accord",
        montant: 4_600 * M,
        conditions:
          "Six mensualités à compter du 30 mai 2025, remise partielle des intérêts de retard.",
        echeancier: { mode: "regulier", nombre: 6, premiere: "2025-05-30", periodiciteMois: 1 },
      },
      paiement("2025-05-30", 1, "consultant"),
      paiement("2025-06-30", 2, "consultant"),
      paiement("2025-07-31", 3, "consultant"),
      paiement("2025-08-29", 4, "consultant2"),
      paiement("2025-09-30", 5, "consultant2"),
      paiement("2025-10-31", 6, "consultant2"),
    ],
  },
  {
    nom: "Société Camerounaise de Malt et Houblon (fictive)",
    categorie: "fournisseur",
    garanti: false,
    reference: "FOU-0457",
    principal: 1_900 * M,
    interets: 0,
    arrete: "2025-03-31",
    echeanceInitiale: "2025-01-31",
    nature: "Approvisionnements de malt et de houblon",
    creeLe: "2025-04-02",
    par: "consultant",
    evenements: [
      {
        jour: "2025-04-03",
        par: "consultant",
        type: "ouverture",
        conditions: "Rendez-vous avec la direction commerciale du fournisseur.",
      },
      {
        jour: "2025-04-10",
        par: "consultant",
        type: "proposition",
        montant: 1_800 * M,
        conditions: "Quatre paiements mensuels de juin à septembre, livraisons maintenues.",
      },
      {
        jour: "2025-04-22",
        par: "consultant",
        type: "accord",
        montant: 1_800 * M,
        conditions: "Quatre paiements mensuels, livraisons maintenues pendant l'étalement.",
        echeancier: {
          mode: "explicite",
          lignes: [
            { date: "2025-06-13", montant: 450 * M },
            { date: "2025-07-15", montant: 450 * M },
            { date: "2025-08-14", montant: 450 * M },
            { date: "2025-09-15", montant: 450 * M },
          ],
        },
      },
      paiement("2025-06-13", 1, "consultant"),
      // Saisie du 15 juillet annulée : le règlement n'est arrivé que le 18.
      paiement("2025-07-15", 2, "consultant2"),
      { jour: "2025-07-16", par: "consultant2", type: "annulation_paiement", rang: 2 },
      {
        jour: "2025-07-18",
        par: "consultant",
        type: "note",
        conditions:
          "Règlement de la deuxième échéance reçu avec trois jours de retard, toléré par le fournisseur.",
      },
      paiement("2025-07-18", 2, "consultant"),
      paiement("2025-08-14", 3, "consultant"),
      paiement("2025-09-15", 4, "consultant"),
    ],
  },
  {
    nom: "Direction régionale des impôts du Littoral (fictive)",
    categorie: "fiscal",
    garanti: false,
    reference: "REC-2025-031",
    principal: 780 * M,
    interets: 55 * M,
    arrete: "2025-03-31",
    echeanceInitiale: "2025-02-15",
    nature: "Impôts et taxes en retard de paiement",
    creeLe: "2025-04-04",
    par: "consultant2",
    evenements: [
      {
        jour: "2025-04-07",
        par: "consultant2",
        type: "ouverture",
        conditions: "Demande d'étalement déposée auprès du service de recouvrement.",
      },
      {
        jour: "2025-04-30",
        par: "consultant2",
        type: "creance",
        creance: {
          principal: 780 * M,
          interets: 60 * M,
          arrete: "2025-04-30",
          commentaire: "Décompte actualisé reçu du service de recouvrement.",
        },
      },
      {
        jour: "2025-05-06",
        par: "consultant2",
        type: "proposition",
        montant: 750 * M,
        conditions: "Trois mensualités de juillet à septembre.",
      },
      {
        jour: "2025-05-14",
        par: "consultant2",
        type: "accord",
        montant: 750 * M,
        conditions: "Plan d'étalement en trois mensualités, remise de la majoration.",
        echeancier: { mode: "regulier", nombre: 3, premiere: "2025-07-31", periodiciteMois: 1 },
      },
      paiement("2025-07-31", 1, "consultant2"),
      paiement("2025-08-29", 2, "consultant2"),
      paiement("2025-09-30", 3, "consultant2"),
    ],
  },
  {
    nom: "Caisse nationale de prévoyance sociale (fictive)",
    categorie: "social",
    garanti: false,
    reference: "CNPS-2025-77",
    principal: 420 * M,
    interets: 15 * M,
    arrete: "2025-03-31",
    echeanceInitiale: "2025-03-15",
    nature: "Cotisations sociales en retard de paiement",
    creeLe: "2025-04-04",
    par: "consultant2",
    evenements: [
      {
        jour: "2025-04-09",
        par: "consultant2",
        type: "ouverture",
        conditions: "Courrier de demande de délai adressé à la direction régionale.",
      },
      {
        jour: "2025-05-13",
        par: "consultant2",
        type: "accord",
        montant: 400 * M,
        conditions: "Deux échéances de 200 millions fin août et fin septembre.",
        echeancier: {
          mode: "explicite",
          lignes: [
            { date: "2025-08-29", montant: 200 * M },
            { date: "2025-09-30", montant: 200 * M },
          ],
        },
      },
      paiement("2025-08-29", 1, "consultant2"),
      paiement("2025-09-30", 2, "consultant2"),
    ],
  },
  {
    nom: "Logistique et Entrepôts du Wouri (fictive)",
    categorie: "bailleur",
    garanti: false,
    principal: 290 * M,
    interets: 0,
    arrete: "2025-03-31",
    echeanceInitiale: "2025-03-01",
    nature: "Loyers d'entrepôts en retard de paiement",
    creeLe: "2025-04-03",
    par: "chef",
    evenements: [
      {
        jour: "2025-04-03",
        par: "chef",
        type: "ouverture",
        conditions: "Premier échange avec le bailleur des entrepôts de Bonabéri.",
      },
      {
        jour: "2025-04-17",
        par: "chef",
        type: "proposition",
        montant: 260 * M,
        conditions:
          "Règlement en quatre mensualités de juin à septembre, avec une remise de 30 millions.",
      },
      {
        jour: "2025-04-24",
        par: "chef",
        type: "contre_proposition",
        montant: 290 * M,
        conditions: "Paiement de 50 % en juin, solde en juillet, sans remise.",
      },
      {
        jour: "2025-05-20",
        par: "chef",
        type: "accord",
        montant: 260 * M,
        conditions: "Quatre mensualités de juin à septembre, remise de 30 millions sur le solde.",
        echeancier: { mode: "regulier", nombre: 4, premiere: "2025-06-30", periodiciteMois: 1 },
      },
      paiement("2025-06-30", 1, "consultant"),
      paiement("2025-07-31", 2, "consultant"),
      paiement("2025-08-29", 3, "consultant"),
      paiement("2025-09-30", 4, "consultant"),
    ],
  },
];

/** Dernier jour des événements antérieurs à la première échéance payée (phase « accords »). */
export const JOUR_FIN_ACCORDS_M3 = "2025-05-25";
