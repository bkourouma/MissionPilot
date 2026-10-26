import { CASTING } from "./casting.js";
import { ELEMENTS_SICAFE } from "./plans-coeur-sicafe-elements.js";
import { SICAFE_V1, SICAFE_V2 } from "./plans-coeur-modeles.js";
import type { SpecPlan } from "./plans-coeur-types.js";

/*
 * Plan 1 — SICAFE, mission 1 : plan COMPLET et VALIDÉ (éléments, modèle financier, cascade,
 * portefeuille arbitré), partagé au portail client. Éléments : plans-coeur-sicafe-elements.ts.
 */

export const TITRE_PLAN_SICAFE = "Plan stratégique 2025-2028 — SICAFE";

export const PLAN_SICAFE: SpecPlan = {
  mission: CASTING.sicafe,
  titre: TITRE_PLAN_SICAFE,
  horizon: 4,
  elements: ELEMENTS_SICAFE,
  kpiNouveaux: [
    {
      objectif: "O8",
      corps: {
        libelle: "Énergie consommée par tonne séchée",
        description: "Électricité et combustibles du séchage de Daloa rapportés au tonnage séché.",
        unite: "kWh/t",
        sens: "plus_bas_mieux",
        nature: "flux",
        frequence: "mensuelle",
        debut_suivi: "2025-02-01",
        cible: 118,
      },
    },
  ],
  projets: [
    {
      initiative: "I1",
      titre: "Génie civil et séchoirs de Daloa",
      description: "Terrassement, six séchoirs, hangar de stockage et raccordement électrique.",
      porteur: "chef.mission",
      debut: "2025-05-05",
      echeance: "2025-12-19",
      parcours: ["en_cours", "termine"],
      jalons: [
        {
          titre: "Réception des six séchoirs",
          echeance: "2025-11-14",
          porteur: "chef.mission",
          parcours: ["prevu", "atteint"],
        },
        {
          titre: "Mise en service industrielle",
          echeance: "2025-12-19",
          porteur: "chef.mission",
          parcours: ["prevu", "atteint"],
        },
      ],
    },
    {
      initiative: "I3",
      titre: "Contractualisation — première vague (20 coopératives)",
      description: "Contrats de volume sur trois campagnes avec préfinancement des intrants.",
      porteur: "chef.mission",
      debut: "2025-07-01",
      echeance: "2025-12-19",
      parcours: ["en_cours", "termine"],
      jalons: [
        {
          titre: "Signature du 20e contrat",
          echeance: "2025-11-28",
          porteur: "chef.mission",
          parcours: ["prevu", "atteint"],
        },
      ],
    },
    {
      initiative: "I3",
      titre: "Contractualisation — seconde vague (20 coopératives)",
      description: "Extension aux coopératives de la région du Haut-Sassandra.",
      porteur: "consultant",
      debut: "2026-01-12",
      echeance: "2026-06-30",
      parcours: ["a_lancer", "en_cours", "termine"],
      jalons: [
        {
          titre: "Signature du 40e contrat",
          echeance: "2026-06-30",
          porteur: "consultant",
          parcours: ["prevu", "atteint"],
        },
      ],
    },
    {
      initiative: "I5",
      titre: "Traçabilité lot par lot",
      description:
        "Étiquetage des lots, saisie à la réception et export des fiches de traçabilité.",
      porteur: "consultant",
      debut: "2026-01-12",
      echeance: "2026-10-08",
      parcours: ["a_lancer", "en_cours"],
      jalons: [
        {
          titre: "Recette du module qualité",
          echeance: "2026-10-08",
          porteur: "consultant",
          parcours: ["prevu", "manque"],
        },
      ],
    },
    {
      initiative: "I7",
      titre: "Audits de certification — cohorte 1 (10 coopératives)",
      description: "Audits préparatoires puis audit de certification de la première cohorte.",
      porteur: "associe.2",
      debut: "2026-07-06",
      echeance: "2026-12-18",
      parcours: ["a_lancer", "en_cours"],
      jalons: [
        {
          titre: "Audit de certification de la cohorte 1",
          echeance: "2026-11-27",
          porteur: "associe.2",
          parcours: ["prevu"],
        },
      ],
    },
    {
      initiative: "I8",
      titre: "Prospection des torréfacteurs du Benelux",
      description: "Rendez-vous clients, échantillons et offres sur petits lots premium.",
      porteur: "directeur.mission",
      debut: "2026-03-02",
      echeance: "2026-12-18",
      parcours: ["a_lancer", "en_cours"],
      jalons: [
        {
          titre: "Premier conteneur livré à Rotterdam",
          echeance: "2026-09-18",
          porteur: "directeur.mission",
          parcours: ["prevu", "atteint"],
        },
      ],
    },
  ],
  modeles: [
    {
      hypotheses: SICAFE_V1,
      commentaire:
        "Hypothèses de cadrage : trajectoire prudente, un seul investissement lourd (séchage).",
      valider: "directeur",
    },
    {
      hypotheses: SICAFE_V2,
      commentaire:
        "Après l'atelier de direction : export plus rapide et chaîne de tri optique ajoutée.",
      valider: "associe",
    },
  ],
  evaluations: [
    {
      initiative: "I5",
      versions: [
        {
          valeur: 4,
          effort: 3,
          risque: 2,
          charge_jours: 180,
          commentaire: "Gain qualité direct sur l'export.",
        },
      ],
    },
    {
      initiative: "I6",
      versions: [
        {
          valeur: 4,
          effort: 4,
          risque: 3,
          charge_jours: 300,
          commentaire: "Investissement lourd, dépend de la recette de la traçabilité.",
        },
        {
          valeur: 4,
          effort: 4,
          risque: 2,
          charge_jours: 260,
          commentaire: "Risque revu à la baisse après l'offre ferme du fournisseur.",
        },
      ],
    },
    { initiative: "I7", versions: [{ valeur: 4, effort: 3, risque: 2, charge_jours: 120 }] },
    {
      initiative: "I8",
      versions: [
        {
          valeur: 5,
          effort: 3,
          risque: 3,
          charge_jours: 140,
          commentaire: "Réduit la dépendance aux deux acheteurs.",
        },
      ],
    },
    { initiative: "I10", versions: [{ valeur: 2, effort: 1, risque: 1, charge_jours: 30 }] },
    {
      initiative: "I11",
      versions: [
        {
          valeur: 3,
          effort: 4,
          risque: 4,
          charge_jours: 90,
          commentaire: "Option stratégique à instruire.",
        },
      ],
    },
  ],
  arbitrages: [
    {
      budget_max: 1_300_000_000,
      capacite_max: 900,
      commentaire:
        "Premier arbitrage du comité de pilotage : enveloppe de 1,3 milliard de FCFA sur 2026-2027.",
    },
    {
      budget_max: 1_700_000_000,
      capacite_max: 1000,
      ajouter: {
        initiative: "I11",
        motif:
          "Maintenue au portefeuille malgré son rang : l'étude conditionne l'accès à un financement de bailleur.",
      },
      commentaire: "Second arbitrage après l'obtention d'une enveloppe complémentaire.",
    },
  ],
  observations: [
    {
      initiative: "I2",
      efficacite: 78,
      commentaire: "Délai de recouvrement ramené de 63 à 52 jours en six mois.",
    },
    {
      initiative: "I4",
      efficacite: 72,
      commentaire: "Tableau de bord hebdomadaire adopté par la direction générale.",
    },
    {
      initiative: "I9",
      efficacite: 70,
      commentaire: "Rotation des managers de production en baisse sur l'année suivante.",
    },
    {
      initiative: "I10",
      efficacite: 58,
      commentaire: "Gains partiels : la hausse du carburant a absorbé une partie des économies.",
    },
  ],
  partager: true,
};
