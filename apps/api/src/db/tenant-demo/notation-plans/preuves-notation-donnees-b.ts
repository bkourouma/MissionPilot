import { CASTING } from "./casting.js";
import type { DefRegistreNotation } from "./preuves-notation-types.js";

/*
 * Registres de preuves alignés sur les dimensions de la grille : missions 5 (Atlantique Retail),
 * 6 (Baobab Assurances) et 9 (Banque du Sahel). Constats FICTIFS, sans personne nommée.
 */

export const REGISTRE_ATLANTIQUE: DefRegistreNotation = {
  mission: CASTING.atlantique,
  grille: "competitivite-excellence",
  partielle: "positionnement",
  sans: "organisation",
  preuves: [
    {
      source: "Business plan 2025-2029 et comptes consolidés 2022 à 2024, Atlantique Retail Group",
      extrait:
        "Le business plan présente un déploiement de douze magasins sur cinq ans avec un budget d'investissement par ouverture. Le chiffre d'affaires comparable progresse de 4 % par an sur les trois derniers exercices.",
      fiabilite: "A",
      f: 0.02,
    },
    {
      source:
        "Entretien avec la direction générale, la direction des achats et la direction des magasins",
      extrait:
        "La direction décrit un pilotage hebdomadaire par magasin et des revues de gamme trimestrielles. Les décisions d'ouverture sont soumises à un comité d'investissement avec un seuil de rentabilité minimal.",
      fiabilite: "B",
      f: 0.03,
    },
    {
      source: "Visite de trois magasins et de la plateforme logistique, deux jours",
      extrait:
        "Les standards d'accueil et de présentation sont affichés et respectés dans deux magasins sur trois. Les inventaires tournants sont réalisés chaque semaine et les écarts de stock sont tracés.",
      fiabilite: "B",
      f: 0.05,
    },
    {
      source:
        "Questionnaire de notation « notation_generique » rempli par les directeurs de magasin",
      extrait:
        "Les directeurs de magasin se sentent écoutés et soutiennent le plan de développement. Ils demandent davantage de moyens de formation pour les équipes de caisse.",
      fiabilite: "B",
      f: 0.07,
    },
    {
      source: "Tableaux de marge par rayon et contrats fournisseurs 2024, Atlantique Retail",
      extrait:
        "La marge brute par rayon est suivie chaque semaine ; les conditions fournisseurs sont renégociées chaque année avec un objectif de gain de 1,2 point de marge. Les coûts de loyer sont indexés sur le chiffre d'affaires dans la moitié des baux.",
      fiabilite: "A",
      f: 0.09,
    },
    {
      source: "Étude de marché de la distribution alimentaire en zone Atlantique, 2024",
      extrait:
        "Étude d'un cabinet tiers : trois enseignes concurrentes ouvrent des surfaces comparables dans les mêmes zones. L'échantillon de l'étude est limité à 400 foyers.",
      fiabilite: "C",
      f: 0.11,
    },
  ],
  assertions: {
    strategie: {
      enonce:
        "Le plan de développement est formalisé (douze magasins en cinq ans) avec un budget d'investissement par ouverture.",
      classe: "R2",
    },
    processus: {
      enonce:
        "Les processus de magasin et de logistique sont standardisés, avec des inventaires tournants hebdomadaires.",
      classe: "R1",
    },
    pilotage: {
      enonce: "Le pilotage est hebdomadaire par magasin, avec des revues de gamme trimestrielles.",
      classe: "R1",
    },
    amelioration: {
      enonce:
        "Les écarts de stock sont tracés et traités ; la démarche d'amélioration reste centrée sur la logistique.",
      classe: "R1",
    },
    engagement: {
      enonce:
        "Les directeurs de magasin adhèrent au plan de développement et demandent plus de formation pour les équipes de caisse.",
      classe: "R1",
    },
    qualite: {
      enonce:
        "Les standards d'accueil et de présentation sont respectés dans deux magasins visités sur trois.",
      classe: "R1",
    },
    couts: {
      enonce:
        "La marge par rayon est suivie chaque semaine et les conditions fournisseurs sont renégociées chaque année.",
      classe: "R2",
    },
    innovation: {
      enonce:
        "L'enseigne teste de nouveaux formats de rayon, avec des essais encadrés dans trois magasins.",
      classe: "R1",
    },
    positionnement: {
      enonce:
        "Trois enseignes concurrentes ouvrent des surfaces comparables dans les mêmes zones d'implantation.",
      classe: "R2",
    },
  },
};

export const REGISTRE_BAOBAB: DefRegistreNotation = {
  mission: CASTING.baobab,
  grille: "competitivite-excellence",
  partielle: "engagement",
  sans: "couts",
  preuves: [
    {
      source: "Rapport annuel 2024 et plan à moyen terme 2023-2025 de Baobab Assurances",
      extrait:
        "Le plan à moyen terme fixe des objectifs de croissance des primes par branche et de ratio combiné. Le ratio combiné 2024 est de 97 %, en amélioration de deux points sur un an.",
      fiabilite: "A",
      f: 0.02,
    },
    {
      source:
        "Entretien avec la direction générale, la direction technique et la direction commerciale",
      extrait:
        "La direction technique suit les sinistres par branche chaque mois. La direction commerciale reconnaît que le suivi des agents généraux dépend de fichiers locaux non consolidés.",
      fiabilite: "B",
      f: 0.03,
    },
    {
      source: "Observation du traitement des sinistres automobile au siège de Dakar, deux jours",
      extrait:
        "Un dossier sinistre simple est traité en neuf jours en moyenne ; les étapes de validation sont tracées dans l'outil de gestion. Les dossiers complexes sortent du circuit et sont suivis à la main.",
      fiabilite: "B",
      f: 0.05,
    },
    {
      source: "Questionnaire de notation « notation_generique » rempli par les cadres du siège",
      extrait:
        "L'organisation par direction est jugée claire. Sur l'engagement, un tiers seulement des répondants estime que ses idées d'amélioration sont écoutées, mais l'échantillon est réduit.",
      fiabilite: "C",
      f: 0.07,
    },
    {
      source: "Procédures de souscription et de gestion des sinistres, version 2024",
      extrait:
        "Les procédures décrivent les délégations de souscription et les délais de traitement cibles par type de sinistre. Une revue annuelle est prévue mais la dernière date de dix-huit mois.",
      fiabilite: "B",
      f: 0.09,
    },
    {
      source: "Statistiques de la conférence interafricaine des marchés d'assurances, 2022 à 2024",
      extrait:
        "Le marché sénégalais de l'assurance non-vie croît de 6 % par an ; Baobab Assurances gagne 0,8 point de part de marché en branche automobile sur la période.",
      fiabilite: "A",
      f: 0.11,
    },
  ],
  assertions: {
    strategie: {
      enonce:
        "Le plan à moyen terme fixe des objectifs par branche et un ratio combiné cible, en amélioration en 2024.",
      classe: "R2",
    },
    processus: {
      enonce:
        "Le traitement des sinistres simples est tracé de bout en bout ; les dossiers complexes sortent du circuit outillé.",
      classe: "R1",
    },
    pilotage: {
      enonce:
        "Les sinistres sont suivis chaque mois par branche, mais le suivi des agents généraux n'est pas consolidé.",
      classe: "R1",
    },
    amelioration: {
      enonce:
        "Les procédures sont revues annuellement en principe ; la dernière revue date de dix-huit mois.",
      classe: "R1",
    },
    organisation: {
      enonce:
        "L'organisation par direction est claire et les délégations de souscription sont décrites.",
      classe: "R1",
    },
    engagement: {
      enonce:
        "Une minorité des cadres estime que ses idées d'amélioration sont écoutées ; l'échantillon reste réduit.",
      classe: "R1",
    },
    qualite: {
      enonce:
        "Les délais de traitement cibles sont définis par type de sinistre et respectés pour les dossiers simples.",
      classe: "R1",
    },
    innovation: {
      enonce:
        "L'assureur lance une offre de souscription simplifiée en ligne, encore limitée à la branche automobile.",
      classe: "R1",
    },
    positionnement: {
      enonce:
        "Baobab Assurances gagne 0,8 point de part de marché en automobile sur un marché qui croît de 6 % par an.",
      classe: "R2",
    },
  },
};

export const REGISTRE_BANQUE: DefRegistreNotation = {
  mission: CASTING.banqueSahel,
  grille: "grille-banque-pme",
  partielle: "innovation",
  sans: "amelioration",
  preuves: [
    {
      source: "Politique de crédit PME et rapport de gestion 2024, Banque du Sahel",
      extrait:
        "La politique de crédit définit des plafonds par secteur et des critères d'éligibilité des PME. Le portefeuille PME représente 31 % des encours ; le taux de créances douteuses est de 6,8 %.",
      fiabilite: "A",
      f: 0.02,
    },
    {
      source:
        "Entretien avec la direction des risques, la direction du réseau et la direction du crédit PME",
      extrait:
        "La direction des risques présente un comité de crédit hebdomadaire et une revue trimestrielle du portefeuille. Le réseau déclare utiliser la grille de notation pour les dossiers supérieurs à un seuil seulement.",
      fiabilite: "B",
      f: 0.03,
    },
    {
      source: "Observation de l'instruction de dossiers PME dans deux agences, trois jours",
      extrait:
        "Les dossiers sont instruits avec une liste de pièces standard ; les délais d'instruction varient de 8 à 25 jours selon l'agence. Les visites de clients avant octroi sont réalisées dans la majorité des cas.",
      fiabilite: "B",
      f: 0.05,
    },
    {
      source:
        "Questionnaire de notation « notation_generique » rempli par les chargés d'affaires PME",
      extrait:
        "Les chargés d'affaires jugent la répartition des rôles claire entre agence et direction du crédit. Ils demandent des outils d'analyse financière plus rapides.",
      fiabilite: "B",
      f: 0.07,
    },
    {
      source: "Rapports de suivi du portefeuille PME, quatre trimestres 2024",
      extrait:
        "Le suivi trimestriel porte sur les impayés, les incidents de paiement et les garanties. Le coût du risque est suivi par agence ; la marge d'intermédiation sur les crédits PME est stable.",
      fiabilite: "B",
      f: 0.09,
    },
    {
      source: "Statistiques monétaires et bancaires de la région, crédit aux PME, 2022 à 2024",
      extrait:
        "Les concurrents bancaires élargissent leurs offres de crédit aux PME avec des procédures simplifiées. Certaines banques lancent des outils d'instruction numérique, selon des déclarations non vérifiées.",
      fiabilite: "C",
      f: 0.11,
    },
  ],
  assertions: {
    strategie: {
      enonce:
        "La politique de crédit PME est écrite, avec des plafonds par secteur et des critères d'éligibilité.",
      classe: "R2",
    },
    processus: {
      enonce:
        "L'instruction des dossiers PME suit une liste de pièces standard, avec des délais variables selon l'agence.",
      classe: "R1",
    },
    pilotage: {
      enonce:
        "Le portefeuille PME est suivi chaque trimestre (impayés, incidents, garanties) et en comité de crédit hebdomadaire.",
      classe: "R1",
    },
    organisation: {
      enonce:
        "La répartition des rôles entre agence et direction du crédit est claire pour les chargés d'affaires.",
      classe: "R1",
    },
    engagement: {
      enonce:
        "Les chargés d'affaires PME adhèrent à la politique de crédit et demandent des outils d'analyse plus rapides.",
      classe: "R1",
    },
    qualite: {
      enonce:
        "Les visites de clients avant octroi sont réalisées dans la majorité des dossiers instruits.",
      classe: "R1",
    },
    couts: {
      enonce:
        "Le coût du risque est suivi par agence et la marge d'intermédiation sur les crédits PME est stable.",
      classe: "R2",
    },
    innovation: {
      enonce:
        "Des banques concurrentes déploient des outils d'instruction numérique que la Banque du Sahel n'a pas encore.",
      classe: "R1",
    },
    positionnement: {
      enonce:
        "Le portefeuille PME pèse 31 % des encours, face à des concurrents qui simplifient leurs procédures de crédit.",
      classe: "R2",
    },
  },
};
