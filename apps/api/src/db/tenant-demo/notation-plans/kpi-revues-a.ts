import type { SpecAction, SpecRevue } from "./kpi-types.js";

/* Revues de performance et actions correctives des missions 1 (SICAFE), 2 (Sahel Coton) et 5 (Atlantique Retail). */

export const REVUES_SICAFE: SpecRevue[] = [
  {
    titre: "Revue de performance — premier trimestre 2025",
    date: "2025-03-21",
    etat: "cloturee",
    compteRendu:
      "Le chiffre d'affaires et la marge reculent en février (arrêt d'une ligne de conditionnement). Le délai de recouvrement se dégrade depuis janvier. Le comité demande une relance systématique des factures échues et une analyse des écarts de février.",
    decisions: [
      {
        libelle: "Déployer une relance systématique des factures échues depuis plus de 60 jours",
        kpi: "sicafe.recouvrement",
        responsable: "chef",
        echeance: "2025-04-11",
        fin: "executee",
        commentaire:
          "Procédure de relance appliquée aux douze principaux clients ; le délai moyen repasse sous 72 jours en avril.",
        actions: [
          {
            titre: "Rédiger la procédure de relance et former l'équipe commerciale",
            description:
              "Trois paliers de relance (courrier, appel, visite) selon l'ancienneté de la facture.",
            kpi: "sicafe.recouvrement",
            responsable: "membre",
            echeance: "2025-04-04",
            fin: "terminee",
            dateEffet: "2025-04-07",
            commentaire: "Date d'effet : première vague de relances envoyée le 7 avril 2025.",
            alerte: "SEUIL_HAUT",
            commentaires: ["Procédure validée par la direction financière du client."],
          },
        ],
      },
      {
        libelle: "Analyser les causes du recul du chiffre d'affaires de février",
        kpi: "sicafe.ca",
        responsable: "chef",
        echeance: "2025-04-04",
        fin: "executee",
        commentaire:
          "Analyse livrée au comité : arrêt de deux semaines d'une ligne de conditionnement, sans perte de clients.",
        actions: [],
      },
      {
        libelle: "Renégocier les prix d'achat du café vert avec les trois fournisseurs principaux",
        kpi: "sicafe.cout",
        responsable: "directeur",
        echeance: "2025-04-25",
        fin: "abandonnee",
        motif:
          "Contrats annuels en cours jusqu'en décembre : la renégociation est reportée à l'exercice suivant, hors du périmètre de la mission.",
        actions: [],
      },
    ],
  },
];

export const ACTIONS_SICAFE: SpecAction[] = [
  {
    titre: "Mettre en place un contrôle qualité à la réception des lots",
    description:
      "Échantillonnage systématique à la réception pour réduire les lots refusés en aval.",
    kpi: "sicafe.defaut",
    responsable: "membre",
    echeance: "2025-03-28",
    fin: "terminee",
    dateEffet: "2025-03-03",
    commentaire: "Contrôle opérationnel depuis la première semaine de mars 2025.",
  },
];

export const REVUES_SAHEL: SpecRevue[] = [
  {
    titre: "Revue de performance — dossier de notation",
    date: "2025-05-16",
    etat: "cloturee",
    compteRendu:
      "L'endettement net recule de façon régulière et la marge d'exploitation progresse. Le besoin en fonds de roulement reste le point de vigilance avant la présentation au comité de notation.",
    decisions: [
      {
        libelle:
          "Réduire le besoin en fonds de roulement par un meilleur suivi des stocks de fibre",
        kpi: "sahel.bfr",
        responsable: "chef",
        echeance: "2025-06-06",
        fin: "executee",
        commentaire:
          "Suivi hebdomadaire des stocks en place ; besoin en fonds de roulement ramené à 80 jours.",
        actions: [],
      },
      {
        libelle: "Présenter à la banque l'échéancier de désendettement",
        kpi: "sahel.endettement",
        responsable: "directeur",
        echeance: "2025-06-13",
        fin: "executee",
        commentaire: "Échéancier présenté à la banque chef de file le 12 juin.",
        actions: [
          {
            titre: "Construire l'échéancier de désendettement sur dix-huit mois",
            description:
              "Trajectoire de remboursement compatible avec la saisonnalité de la trésorerie.",
            kpi: "sahel.endettement",
            responsable: "membre",
            echeance: "2025-05-30",
            fin: "terminee",
            dateEffet: "2025-05-26",
            commentaire: "Date d'effet : première échéance remboursée selon le nouveau calendrier.",
          },
        ],
      },
    ],
  },
];

export const ACTIONS_SAHEL: SpecAction[] = [
  {
    titre: "Fiabiliser le calcul du délai de recouvrement par client",
    description:
      "Rapprocher le fichier clients de la comptabilité pour neutraliser les avoirs et acomptes.",
    kpi: "sahel.recouvrement",
    responsable: "chef",
    echeance: "2025-04-30",
    fin: "terminee",
    dateEffet: "2025-04-14",
    commentaire: "Méthode de calcul en vigueur à compter de la clôture de mars 2025.",
    alerte: "SEUIL_HAUT",
  },
];

export const REVUES_ATLANTIQUE: SpecRevue[] = [
  {
    titre: "Revue de performance — préparation du business plan",
    date: "2026-04-17",
    etat: "cloturee",
    compteRendu:
      "Le chiffre d'affaires est porté par le trafic en magasin et un panier moyen en hausse. La rotation des stocks reste au-dessus de la cible. Les hypothèses du business plan sont alignées sur ces tendances.",
    decisions: [
      {
        libelle: "Retenir une marge commerciale de 26 % comme hypothèse du business plan",
        kpi: "atl.marge",
        responsable: "directeur",
        echeance: "2026-04-24",
        fin: "executee",
        commentaire:
          "Hypothèse intégrée au modèle financier et validée avec la direction générale.",
        actions: [],
      },
      {
        libelle: "Lancer un plan d'écoulement des références à rotation lente",
        kpi: "atl.stocks",
        responsable: "chef",
        echeance: "2026-05-15",
        fin: "executee",
        commentaire:
          "Plan d'écoulement engagé sur quarante références ; couverture ramenée à 47 jours.",
        actions: [
          {
            titre: "Cartographier les références à rotation lente par magasin",
            description:
              "Classement ABC des références et identification de celles à déstocker en priorité.",
            kpi: "atl.stocks",
            responsable: "membre",
            echeance: "2026-04-30",
            fin: "terminee",
            dateEffet: "2026-04-27",
            commentaire: "Date d'effet : démarrage des opérations de déstockage le 27 avril 2026.",
          },
        ],
      },
    ],
  },
];

export const ACTIONS_ATLANTIQUE: SpecAction[] = [
  {
    titre: "Négocier des délais de paiement fournisseurs plus longs",
    description: "Allonger les délais pour réduire le besoin de trésorerie lié aux stocks.",
    kpi: "atl.stocks",
    responsable: "directeur",
    echeance: "2026-03-31",
    fin: "abandonnee",
    motif:
      "Les principaux fournisseurs ont refusé de modifier leurs conditions avant la fin de l'exercice.",
  },
];
