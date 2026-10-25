import type { CleMission } from "./casting.js";
import type { MissionFacturation } from "./donnees-facturation.js";

/* Données de facturation du Tenant démo (suite) : voir donnees-facturation.ts. */

const REF_ACOMPTE = "Acompte à la signature";

export const DONNEES_B: Partial<Record<CleMission, MissionFacturation>> = {
  "mboa-dd": {
    manuel: false,
    echeances: [
      {
        cle: "A",
        libelle: "Acompte à la lettre d'engagement (25 %)",
        type: "acompte",
        pct: 25,
        date: "2025-08-27",
      },
      {
        cle: "B",
        libelle: "Remise du rapport de due diligence (35 %)",
        type: "jalon",
        pct: 35,
        date: "2025-12-01",
        jalon: "Rapport de due diligence",
      },
      {
        cle: "C",
        libelle: "Solde après présentation au comité d'investissement (40 %)",
        type: "jalon",
        pct: 40,
        date: "2025-12-19",
        jalon: "Présentation au comité d'investissement",
      },
    ],
    factures: [
      {
        cle: "F1",
        echeances: ["A"],
        date: "2025-08-29",
        objet: "Acompte à la lettre d'engagement",
        etat: "emise",
        paiements: [{ jours: 18, part: "reste", mode: "virement" }],
      },
      {
        cle: "F2",
        echeances: ["B"],
        date: "2025-12-03",
        objet: "Remise du rapport de due diligence",
        etat: "emise",
        paiements: [{ jours: 27, part: "reste", mode: "virement" }],
      },
      {
        cle: "F3",
        echeances: ["C"],
        date: "2025-12-22",
        objet: "Solde de la due diligence",
        etat: "emise",
        paiements: [
          { jours: 30, part: 60, mode: "virement", commentaire: "Premier règlement partiel" },
          { jours: 52, part: "reste", mode: "virement" },
        ],
      },
      {
        cle: "FD",
        echeances: [],
        debours: true,
        date: "2025-12-22",
        objet: "Débours refacturés (due diligence)",
        etat: "emise",
      },
      {
        cle: "FD2",
        echeances: [],
        debours: true,
        date: "2026-01-08",
        objet: "Débours refacturés (due diligence), référence de commande corrigée",
        etat: "emise",
        paiements: [
          {
            jours: 28,
            part: "reste",
            mode: "mobile_money",
            operateur: "mtn_momo",
            commentaire: "Paiement MTN MoMo",
          },
        ],
      },
    ],
    debours: [
      {
        jour: "2025-09-15",
        categorie: "transport",
        libelle: "Billets d'avion Abidjan-Yaoundé (2 consultants)",
        montant: 468_000,
        refacturable: true,
      },
      {
        jour: "2025-09-16",
        categorie: "hebergement",
        libelle: "Hébergement à Yaoundé, 5 nuits",
        montant: 375_000,
        refacturable: true,
      },
      {
        jour: "2025-10-07",
        categorie: "transport",
        libelle: "Visites de sites solaires : location de véhicule",
        montant: 232_000,
        refacturable: true,
      },
      {
        jour: "2025-11-12",
        categorie: "communication",
        libelle: "Salle de données sécurisée (3 mois)",
        montant: 275_000,
        refacturable: true,
      },
      {
        jour: "2025-12-04",
        categorie: "fournitures",
        libelle: "Impression du rapport de due diligence (12 exemplaires)",
        montant: 96_000,
        refacturable: true,
      },
    ],
  },
  "atlantique-bp": {
    manuel: false,
    echeances: [
      {
        cle: "A",
        libelle: "Acompte à la commande (50 %)",
        type: "acompte",
        pct: 50,
        date: "2026-01-07",
      },
      {
        cle: "B",
        libelle: "Solde à la remise du dossier bancable (50 %)",
        type: "jalon",
        pct: 50,
        date: "2026-05-29",
        jalon: "Restitution au dirigeant et remise du dossier",
      },
    ],
    factures: [
      {
        cle: "F1",
        echeances: ["A"],
        date: "2026-01-09",
        objet: "Acompte à la commande du business plan",
        etat: "emise",
        paiements: [{ jours: 21, part: "reste", mode: "virement" }],
      },
      {
        cle: "F2",
        echeances: ["B"],
        debours: true,
        date: "2026-06-02",
        objet: "Solde du business plan et débours refacturés",
        etat: "emise",
        paiements: [{ jours: 57, part: "reste", mode: "virement" }],
      },
    ],
    debours: [
      {
        jour: "2026-01-26",
        categorie: "transport",
        libelle: "Billets d'avion Abidjan-Dakar",
        montant: 346_000,
        refacturable: true,
      },
      {
        jour: "2026-01-27",
        categorie: "hebergement",
        libelle: "Hébergement à Dakar, 3 nuits",
        montant: 252_000,
        refacturable: true,
      },
      {
        jour: "2026-05-19",
        categorie: "fournitures",
        libelle: "Impression et reliure du dossier de financement (8 exemplaires)",
        montant: 128_000,
        refacturable: true,
      },
    ],
  },
  "teranga-flash": {
    manuel: false,
    echeances: [
      {
        cle: "A",
        libelle: "Acompte à la commande (30 %)",
        type: "acompte",
        pct: 30,
        date: "2026-09-10",
      },
      {
        cle: "B",
        libelle: "Solde à la restitution des recommandations (70 %)",
        type: "jalon",
        pct: 70,
        date: "2026-11-20",
        jalon: "Restitution et recommandations",
      },
    ],
    factures: [
      {
        cle: "F1",
        echeances: ["A"],
        date: "2026-09-11",
        objet: "Acompte à la commande du diagnostic flash",
        etat: "emise",
      },
    ],
    debours: [
      {
        jour: "2026-09-24",
        categorie: "transport",
        libelle: "Taxis pour les visites d'entrepôts",
        montant: 38_000,
        refacturable: false,
      },
    ],
  },
  "sicafe-export-plan": {
    manuel: false,
    echeances: [
      { cle: "A", libelle: `${REF_ACOMPTE} (30 %)`, type: "acompte", pct: 30, date: "2026-10-07" },
      {
        cle: "B",
        libelle: "Restitution du diagnostic (30 %)",
        type: "jalon",
        pct: 30,
        date: "2027-02-08",
        jalon: "Restitution du diagnostic",
      },
      {
        cle: "C",
        libelle: "Séminaire de validation (20 %)",
        type: "jalon",
        pct: 20,
        date: "2027-03-02",
        jalon: "Séminaire de validation avec le comité de direction",
      },
      {
        cle: "D",
        libelle: "Solde à la restitution finale (20 %)",
        type: "jalon",
        pct: 20,
        date: "2027-04-30",
        jalon: "Restitution finale",
      },
    ],
    factures: [
      {
        cle: "F1",
        echeances: ["A"],
        date: "2026-10-08",
        objet: "Acompte à la signature du plan stratégique export",
        etat: "a_approuver",
      },
    ],
    debours: [],
  },
};
