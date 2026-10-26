import { CASTING } from "./casting.js";
import { BAOBAB_V1, BAOBAB_V2 } from "./plans-coeur-modeles-baobab.js";
import { axe, initiative, objectif, vision } from "./plans-coeur-outils.js";
import type { Donnees, SpecElement, SpecPlan } from "./plans-coeur-types.js";

/** Élément validé puis précisé : la dernière version est « modifiée » et reste à revalider. */
const avecEvolution = (v: SpecElement, maj: Donnees): SpecElement => ({
  ...v,
  etapes: [...(v.etapes ?? []), { maj }],
});

/*
 * Plan 6 — Baobab Assurances, mission 6 (EN COURS) : plan en BROUILLON, rédaction avancée mais
 * inachevée. Contenus à des étages différents : validés (diagnostic, vision puis modifiée, deux
 * axes, un objectif, deux initiatives), brouillons (SWOT, un axe, quatre objectifs, quatre
 * initiatives) ; modèle financier : version 1 validée, version 2 en brouillon ; cascade
 * partielle ; portefeuille évalué et proposé par le moteur mais NON arbitré.
 */

export const TITRE_PLAN_BAOBAB = "Plan stratégique 2026-2030 — Baobab Assurances";

export const PLAN_BAOBAB: SpecPlan = {
  mission: CASTING.baobab,
  titre: TITRE_PLAN_BAOBAB,
  horizon: 5,
  elements: [
    {
      cle: "diagnostic",
      type: "diagnostic",
      creation: {
        synthese:
          "Baobab Assurances collecte 27 milliards de FCFA de primes (branches dommages, santé et vie). La croissance du portefeuille est saine mais le ratio sinistres sur primes dérive de deux points depuis 2024, le règlement des sinistres automobiles dépasse 28 jours et la souscription reste très manuelle en agence.",
      },
      etapes: [
        {
          maj: {
            synthese:
              "Baobab Assurances collecte 27 milliards de FCFA de primes (branches dommages, santé et vie). La croissance du portefeuille est saine mais le ratio sinistres sur primes dérive de deux points depuis 2024, le règlement des sinistres automobiles dépasse 28 jours et la souscription reste très manuelle en agence. Les ateliers avec la direction technique confirment que la fraude déclarée et la lenteur de l'expertise expliquent plus de la moitié de la dérive.",
          },
        },
        { valider: "directeur" },
      ],
    },
    {
      cle: "swot",
      type: "swot",
      creation: {
        forces: [
          "Notoriété de la marque dans le Sénégal et le Mali",
          "Bilan solide : trésorerie de 6,4 milliards de FCFA et absence de dette",
        ],
        faiblesses: [
          "Souscription manuelle et délais de règlement des sinistres élevés",
          "Dépendance à l'assurance automobile (46 % des primes)",
        ],
        opportunites: [
          "Micro-assurance par téléphone mobile",
          "Réglementation CIMA favorable aux canaux numériques",
        ],
        menaces: [
          "Concurrence tarifaire des filiales de groupes internationaux",
          "Hausse de la fraude sur les sinistres automobiles",
        ],
      },
      etapes: [
        {
          maj: {
            opportunites: [
              "Micro-assurance par téléphone mobile",
              "Réglementation CIMA favorable aux canaux numériques",
              "Partenariats avec les banques pour l'assurance emprunteur",
            ],
          },
        },
      ],
    },
    avecEvolution(
      vision(
        "Être l'assureur de référence de l'Afrique de l'Ouest francophone pour les particuliers et les PME en 2030.",
        "Protéger durablement nos assurés avec des garanties claires et des sinistres réglés vite.",
        ["Écoute", "Rapidité", "Solidité"],
        { porteur: "directeur.mission" },
      ),
      { valeurs: ["Écoute", "Rapidité", "Solidité", "Inclusion"] },
    ),
    axe(
      "C1",
      "Croître sur l'assurance de personnes et la micro-assurance",
      "Élargir le portefeuille hors automobile : santé, vie et micro-assurance mobile.",
      "directeur.mission",
    ),
    axe(
      "C2",
      "Maîtriser la sinistralité et les coûts de gestion",
      "Lutte contre la fraude, expertise accélérée et règlement rapide.",
      "chef.mission",
    ),
    axe(
      "C3",
      "Digitaliser la souscription et la relation client",
      "Souscription en ligne, espace assuré et suivi des sinistres.",
      "consultant",
      false,
    ),
    objectif("D1", "C1", "Porter les primes émises à 40 milliards de FCFA en 2030", {
      perspective: "finances",
      indicateur: "Primes émises (MFCFA)",
      cible: "40 milliards de FCFA en 2030",
      echeance: "2030-12-31",
      description: "Croissance annuelle moyenne de 8 % portée par la santé et la micro-assurance.",
      porteur: "directeur.mission",
      kpi: ["Primes émises"],
    }),
    objectif("D2", "C2", "Ramener le ratio sinistres sur primes sous 62 %", {
      perspective: "finances",
      indicateur: "Ratio sinistres / primes (S/P) (%)",
      cible: "< 62 % en 2028",
      echeance: "2028-12-31",
      description: "Lutte contre la fraude et maîtrise du coût moyen des sinistres.",
      porteur: "chef.mission",
      kpi: ["Ratio sinistres / primes (S/P)"],
      valide: false,
    }),
    objectif("D3", "C2", "Régler 90 % des sinistres automobiles en moins de 15 jours", {
      perspective: "processus",
      indicateur: "Délai moyen de règlement des sinistres (jours)",
      cible: "15 jours",
      cibleRevisee: "15 jours pour les sinistres sans expertise contradictoire",
      echeance: "2027-12-31",
      description: "Expertise à distance par photo et délégation de règlement aux agences.",
      porteur: "consultant",
      kpi: ["Délai moyen de règlement des sinistres"],
      valide: false,
    }),
    objectif("D4", "C3", "Atteindre un indice de satisfaction de 50 points", {
      perspective: "clients",
      indicateur: "Indice de satisfaction client (NPS)",
      cible: "50 points",
      echeance: "2028-12-31",
      description: "Mesure après chaque sinistre réglé et après la souscription.",
      porteur: "consultant",
      valide: false,
    }),
    objectif("D5", "C1", "Contenir le taux de résiliation sous 9 %", {
      perspective: "clients",
      indicateur: "Taux de résiliation (%)",
      cible: "< 9 % par an",
      echeance: "2028-12-31",
      description: "Relances avant échéance et offres de fidélité multi-contrats.",
      porteur: "directeur.mission",
      kpi: ["Taux de résiliation"],
      valide: false,
    }),
    initiative("K1", "Refonte du système cœur de métier", {
      parent: "C3",
      description:
        "Remplacement du progiciel de gestion des contrats et sinistres, avec interfaces vers le paiement mobile.",
      debut: "2026-09-07",
      echeance: "2027-12-17",
      budget: 2_400_000_000,
      gains: [0, 150_000_000, 480_000_000, 620_000_000, 700_000_000],
      statut: "a_lancer",
      responsable: "chef.mission",
      brouillon: true,
    }),
    initiative("K2", "Canal de souscription digital", {
      parent: "C3",
      description: "",
      debut: "2027-01-11",
      echeance: "2027-10-06",
      budget: 900_000_000,
      gains: [0, 0, 220_000_000, 400_000_000, 520_000_000],
      statut: "a_lancer",
      responsable: "consultant",
      dependances: ["K1"],
      bibliotheque: { code: "digitalisation_processus", budget: 900_000_000 },
      brouillon: true,
    }),
    initiative("K3", "Réorganisation de la direction technique et sinistres", {
      parent: "C2",
      description: "",
      debut: "2026-09-14",
      echeance: "2027-03-12",
      budget: 0,
      gains: [40_000_000, 160_000_000, 200_000_000, 200_000_000, 200_000_000],
      statut: "en_cours",
      responsable: "chef.mission",
      bibliotheque: { code: "refonte_organisation" },
    }),
    initiative("K4", "Agences régionales (12 nouvelles)", {
      parent: "C1",
      description:
        "Ouverture de douze agences dans les capitales régionales, adossées à la micro-assurance.",
      debut: "2027-03-01",
      echeance: "2028-06-30",
      budget: 2_600_000_000,
      gains: [0, 0, 260_000_000, 560_000_000, 780_000_000],
      statut: "a_lancer",
      responsable: "directeur.mission",
      brouillon: true,
    }),
    initiative("K5", "Dispositif de contrôle interne et de lutte contre la fraude", {
      parent: "C2",
      description: "",
      debut: "2026-10-05",
      echeance: "2027-06-01",
      budget: 0,
      gains: [60_000_000, 220_000_000, 260_000_000, 260_000_000, 260_000_000],
      statut: "en_cours",
      responsable: "consultant",
      bibliotheque: { code: "controle_interne" },
    }),
    initiative("K6", "Programme de micro-assurance mobile", {
      parent: "C1",
      description:
        "Produits d'assurance décès et hospitalisation à partir de 500 FCFA par mois, vendus par paiement mobile.",
      debut: "2026-11-02",
      echeance: "2027-09-30",
      budget: 450_000_000,
      gains: [0, 40_000_000, 150_000_000, 260_000_000, 330_000_000],
      statut: "a_lancer",
      responsable: "consultant",
      brouillon: true,
    }),
  ],
  projets: [
    {
      initiative: "K3",
      titre: "Audit de l'organisation technique actuelle",
      description: "Cartographie des circuits de sinistres et des délais par étape.",
      porteur: "chef.mission",
      debut: "2026-09-14",
      echeance: "2026-11-27",
      parcours: ["en_cours"],
      jalons: [
        {
          titre: "Restitution de l'audit au comité de direction",
          echeance: "2026-11-27",
          porteur: "chef.mission",
          parcours: ["prevu"],
        },
      ],
    },
    {
      initiative: "K5",
      titre: "Cartographie des risques de fraude automobile",
      description: "Typologie des fraudes, indicateurs d'alerte et circuit d'escalade.",
      porteur: "consultant",
      debut: "2026-10-05",
      echeance: "2026-12-18",
      parcours: ["a_lancer"],
      jalons: [],
    },
  ],
  modeles: [
    {
      hypotheses: BAOBAB_V1,
      commentaire:
        "Trajectoire de référence après le diagnostic : investissements du cœur de métier et du canal digital.",
      valider: "directeur",
    },
    {
      hypotheses: BAOBAB_V2,
      commentaire:
        "Brouillon en discussion : accélération par douze agences et un emprunt de 1,8 milliard de FCFA.",
    },
  ],
  evaluations: [
    { initiative: "K1", versions: [{ valeur: 5, effort: 5, risque: 4, charge_jours: 520 }] },
    { initiative: "K3", versions: [{ valeur: 4, effort: 3, risque: 2, charge_jours: 160 }] },
    {
      initiative: "K4",
      versions: [
        {
          valeur: 4,
          effort: 5,
          risque: 4,
          charge_jours: 600,
          commentaire: "À rediscuter selon l'issue du premier trimestre 2027.",
        },
      ],
    },
    { initiative: "K5", versions: [{ valeur: 4, effort: 3, risque: 2, charge_jours: 140 }] },
  ],
  proposerSeulement: { budget_max: 3_500_000_000, capacite_max: 1000 },
};
