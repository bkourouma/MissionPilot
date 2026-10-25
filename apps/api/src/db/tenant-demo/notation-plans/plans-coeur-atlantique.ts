import { CASTING } from "./casting.js";
import { ATLANTIQUE_V1, ATLANTIQUE_V2 } from "./plans-coeur-modeles.js";
import { axe, initiative, objectif, vision } from "./plans-coeur-outils.js";
import type { SpecPlan } from "./plans-coeur-types.js";

/*
 * Plan 5 — Atlantique Retail, mission 5 (business plan bancable) : plan validé, modèle financier
 * en deux versions (la 1 n'est pas validée, la 2 l'est : bancabilité calculable par le moteur),
 * cascade et portefeuille arbitré. Statuts d'initiative à la date du jeu de données (2026-10-24).
 */

export const TITRE_PLAN_ATLANTIQUE = "Business plan bancable 2026-2030 — Atlantique Retail";

export const PLAN_ATLANTIQUE: SpecPlan = {
  mission: CASTING.atlantique,
  titre: TITRE_PLAN_ATLANTIQUE,
  horizon: 5,
  verifierBancabilite: true,
  elements: [
    {
      cle: "diagnostic",
      type: "diagnostic",
      creation: {
        synthese:
          "Atlantique Retail exploite 31 supermarchés de proximité et réalise 24 milliards de FCFA de chiffre d'affaires. L'enseigne gagne des parts de marché dans les villes secondaires mais sa croissance est freinée par le financement des ouvertures (100 % dette bancaire jusqu'ici) et par une rotation des stocks de 44 jours. Les banques demandent un dossier chiffré à cinq ans montrant la capacité de remboursement du programme d'ouverture de sept magasins et d'une plateforme logistique.",
      },
      etapes: [{ valider: "directeur" }],
    },
    {
      cle: "swot",
      type: "swot",
      creation: {
        forces: [
          "Maillage de proximité et fort taux de réachat dans les villes secondaires",
          "Marque de distributeur à 14 % des ventes et à marge supérieure",
          "Paiement fournisseurs à 62 jours en moyenne",
        ],
        faiblesses: [
          "Dette bancaire déjà élevée et service de la dette concentré sur 2027-2028",
          "Rotation des stocks de 44 jours, supérieure à celle des concurrents directs",
          "Absence de plateforme logistique propre",
        ],
        opportunites: [
          "Émergence de la classe moyenne dans les villes secondaires",
          "Lignes de refinancement dédiées au commerce de détail structuré",
        ],
        menaces: [
          "Arrivée de deux enseignes internationales d'ici 2028",
          "Hausse des loyers commerciaux et du coût de l'énergie",
        ],
      },
      etapes: [{ valider: "directeur" }],
    },
    vision(
      "Devenir l'enseigne de proximité la plus rentable de la sous-région d'ici 2030, avec 38 magasins.",
      "Offrir au quotidien des produits de qualité au meilleur prix, au plus près des familles.",
      ["Proximité", "Prix justes", "Fiabilité"],
      { porteur: "directeur.mission" },
    ),
    axe(
      "B1",
      "Déployer le réseau de magasins",
      "Sept ouvertures en deux ans, puis une plateforme logistique régionale.",
      "chef.mission",
    ),
    axe(
      "B2",
      "Améliorer la marge et le panier moyen",
      "Achats groupés, marque de distributeur, fidélisation et animation commerciale.",
      "consultant",
    ),
    axe(
      "B3",
      "Consolider la structure financière",
      "Ouverture du capital, lissage des déblocages et maîtrise du besoin en fonds de roulement.",
      "directeur.mission",
    ),
    objectif("OB1", "B1", "Soutenir la fréquentation des nouveaux magasins", {
      perspective: "clients",
      indicateur: "Nombre de tickets de caisse (mensuel)",
      cible: "+12 % par an sur le périmètre étendu",
      echeance: "2028-12-31",
      description: "Les sept ouvertures doivent atteindre leur rythme de croisière en 18 mois.",
      porteur: "chef.mission",
      kpi: ["Nombre de tickets de caisse"],
    }),
    objectif("OB2", "B2", "Augmenter le panier moyen de 8 %", {
      perspective: "clients",
      indicateur: "Panier moyen (kFCFA)",
      cible: "+8 % d'ici 2028",
      echeance: "2028-12-31",
      description: "Fidélisation, offres groupées et montée en gamme de la marque de distributeur.",
      porteur: "consultant",
      kpi: ["Panier moyen"],
    }),
    objectif("OB3", "B1", "Atteindre 36 milliards de FCFA de chiffre d'affaires en 2030", {
      perspective: "finances",
      indicateur: "Chiffre d'affaires magasins (kFCFA)",
      cible: "36 milliards de FCFA en 2030",
      cibleRevisee: "36,9 milliards de FCFA en 2030 (scénario de base du modèle)",
      echeance: "2030-12-31",
      description: "Trajectoire du modèle financier validé, présentée aux banques.",
      porteur: "directeur.mission",
      kpi: ["Chiffre d'affaires magasins"],
    }),
    objectif("OB4", "B2", "Gagner 1,5 point de marge commerciale", {
      perspective: "finances",
      indicateur: "Marge commerciale (%)",
      cible: "+1,5 point en 2030",
      echeance: "2030-12-31",
      description:
        "Programme d'optimisation des achats et croissance de la marque de distributeur.",
      porteur: "consultant",
      kpi: ["Marge commerciale"],
    }),
    objectif("OB5", "B3", "Ramener la rotation des stocks à 40 jours", {
      perspective: "processus",
      indicateur: "Rotation des stocks (jours)",
      cible: "40 jours en 2030",
      echeance: "2030-12-31",
      description: "Réapprovisionnement automatique et plateforme logistique.",
      porteur: "directeur.mission",
      kpi: ["Rotation des stocks"],
    }),
    objectif("OB6", "B3", "Stabiliser la rotation du personnel sous 18 %", {
      perspective: "apprentissage",
      indicateur: "Taux de rotation du personnel (%)",
      cible: "< 18 % par an",
      echeance: "2028-12-31",
      description: "Parcours de chef de rayon et primes de fidélité.",
      porteur: "consultant.2",
      kpi: ["Taux de rotation du personnel"],
    }),
    objectif("OB7", "B2", "Atteindre un indice de satisfaction de 55 points", {
      perspective: "clients",
      indicateur: "Indice de satisfaction client (NPS)",
      cible: "55 points",
      echeance: "2028-12-31",
      description: "Enquête mensuelle en caisse et suivi des réclamations.",
      porteur: "consultant.2",
      kpi: ["Indice de satisfaction client (NPS)"],
    }),
    initiative("J1", "Ouverture de 4 magasins en 2026", {
      parent: "OB1",
      description:
        "Quatre magasins dans les villes secondaires déjà étudiées : baux signés, travaux et recrutement des équipes.",
      debut: "2026-02-02",
      echeance: "2026-11-30",
      budget: 2_400_000_000,
      gains: [180_000_000, 420_000_000, 540_000_000, 600_000_000, 640_000_000],
      statut: "en_cours",
      responsable: "chef.mission",
    }),
    initiative("J2", "Ouverture de 3 magasins en 2027", {
      parent: "OB1",
      description:
        "Trois magasins supplémentaires, financés par le crédit d'investissement et l'augmentation de capital.",
      debut: "2027-02-01",
      echeance: "2027-11-30",
      budget: 1_800_000_000,
      gains: [0, 150_000_000, 330_000_000, 410_000_000, 450_000_000],
      statut: "a_lancer",
      responsable: "directeur.mission",
      dependances: ["J1"],
    }),
    initiative("J3", "Plateforme logistique régionale", {
      parent: "OB5",
      description:
        "Entrepôt de 6 000 m² pour centraliser les achats et réduire les ruptures en magasin.",
      debut: "2028-01-10",
      echeance: "2028-12-15",
      budget: 1_500_000_000,
      gains: [0, 0, 0, 220_000_000, 380_000_000],
      statut: "a_lancer",
      responsable: "consultant",
      dependances: ["J2"],
    }),
    initiative("J4", "Programme d'optimisation des achats", {
      parent: "OB4",
      description: "",
      debut: "2026-02-16",
      echeance: "2026-07-14",
      budget: 0,
      gains: [60_000_000, 140_000_000, 140_000_000, 140_000_000, 140_000_000],
      statut: "terminee",
      responsable: "consultant",
      bibliotheque: { code: "reduction_couts" },
    }),
    initiative("J5", "Digitalisation de la gestion des stocks", {
      parent: "OB5",
      description: "",
      debut: "2026-03-02",
      echeance: "2026-11-26",
      budget: 380_000_000,
      gains: [20_000_000, 110_000_000, 150_000_000, 170_000_000, 170_000_000],
      statut: "en_cours",
      responsable: "consultant.2",
      bibliotheque: { code: "digitalisation_processus", budget: 380_000_000 },
    }),
    initiative("J6", "Programme de fidélisation clients", {
      parent: "OB2",
      description: "",
      debut: "2026-04-06",
      echeance: "2026-10-02",
      budget: 0,
      gains: [25_000_000, 70_000_000, 90_000_000, 90_000_000, 90_000_000],
      statut: "en_cours",
      responsable: "consultant",
      bibliotheque: { code: "developpement_commercial" },
    }),
  ],
  projets: [
    {
      initiative: "J1",
      titre: "Magasins 1 et 2 — ouverture au premier semestre",
      description: "Travaux, recrutement et approvisionnement des deux premiers magasins.",
      porteur: "chef.mission",
      debut: "2026-02-02",
      echeance: "2026-06-30",
      parcours: ["en_cours", "termine"],
      jalons: [
        {
          titre: "Ouverture du magasin n° 1",
          echeance: "2026-04-18",
          porteur: "chef.mission",
          parcours: ["prevu", "atteint"],
        },
        {
          titre: "Ouverture du magasin n° 2",
          echeance: "2026-06-27",
          porteur: "chef.mission",
          parcours: ["prevu", "atteint"],
        },
      ],
    },
    {
      initiative: "J1",
      titre: "Magasins 3 et 4 — ouverture au second semestre",
      description: "Baux signés ; ouverture avant la période des fêtes.",
      porteur: "chef.mission",
      debut: "2026-07-06",
      echeance: "2026-11-30",
      parcours: ["a_lancer", "en_cours"],
      jalons: [
        {
          titre: "Ouverture du magasin n° 3",
          echeance: "2026-10-10",
          porteur: "chef.mission",
          parcours: ["prevu", "atteint"],
        },
      ],
    },
    {
      initiative: "J5",
      titre: "Déploiement du réapprovisionnement automatique",
      description: "Paramétrage des seuils par rayon et formation des chefs de rayon.",
      porteur: "consultant.2",
      debut: "2026-03-02",
      echeance: "2026-11-26",
      parcours: ["en_cours"],
      jalons: [
        {
          titre: "Bascule des 12 premiers magasins",
          echeance: "2026-09-25",
          porteur: "consultant.2",
          parcours: ["prevu", "atteint"],
        },
      ],
    },
  ],
  modeles: [
    {
      hypotheses: ATLANTIQUE_V1,
      commentaire:
        "Premier jet du dossier : financement entièrement par la dette (ratios tendus en 2026).",
    },
    {
      hypotheses: ATLANTIQUE_V2,
      commentaire:
        "Version présentée aux banques : augmentation de capital de 1,8 milliard de FCFA et déblocages lissés.",
      valider: "directeur",
    },
  ],
  evaluations: [
    { initiative: "J1", versions: [{ valeur: 5, effort: 4, risque: 3, charge_jours: 400 }] },
    { initiative: "J2", versions: [{ valeur: 4, effort: 4, risque: 3, charge_jours: 320 }] },
    {
      initiative: "J3",
      versions: [
        {
          valeur: 4,
          effort: 5,
          risque: 4,
          charge_jours: 450,
          commentaire: "Dépend du financement du second crédit.",
        },
      ],
    },
    { initiative: "J5", versions: [{ valeur: 3, effort: 3, risque: 2, charge_jours: 150 }] },
    { initiative: "J6", versions: [{ valeur: 3, effort: 2, risque: 2, charge_jours: 80 }] },
  ],
  arbitrages: [
    {
      budget_max: 4_500_000_000,
      capacite_max: 1100,
      commentaire:
        "Arbitrage retenu pour le dossier bancaire : réseau et digitalisation avant la plateforme logistique.",
    },
  ],
  observations: [
    {
      initiative: "J4",
      efficacite: 66,
      commentaire: "Économies d'achat de 2,1 % sur le périmètre alimentaire.",
    },
    {
      initiative: "J6",
      efficacite: 74,
      commentaire: "Hausse du panier moyen des porteurs de la carte de fidélité.",
    },
  ],
};
