import { CASTING } from "./casting.js";
import { MISSION_BRASSERIES } from "./notations-complement-donnees.js";
import type { DefRegistreNotation } from "./preuves-notation-types.js";

/*
 * Registres de preuves alignés sur les dimensions de la grille : missions 1 (SICAFE), 2 (Sahel
 * Coton) et 3 (Brasseries du Wouri). Constats FICTIFS ; aucune personne nommée (fonctions seules),
 * donc aucun extrait nominatif. Voir preuves-notation-types.ts pour la lecture des champs.
 */

export const REGISTRE_SICAFE: DefRegistreNotation = {
  mission: CASTING.sicafe,
  grille: "competitivite-excellence",
  partielle: "innovation",
  sans: "positionnement",
  preuves: [
    {
      source:
        "Plan stratégique 2022-2024 et tableau de bord de revue du comité de direction, SICAFE",
      extrait:
        "Le plan 2022-2024 fixe six objectifs chiffrés déclinés par filiale ; le comité de direction les revoit chaque trimestre avec un tableau de bord de 14 indicateurs. Quatre objectifs sur six sont atteints à fin 2024.",
      fiabilite: "A",
      f: 0.02,
    },
    {
      source:
        "Entretien avec la direction générale, la direction financière et la direction industrielle",
      extrait:
        "La direction générale présente la stratégie chaque année aux cadres, mais pas à l'ensemble du personnel. La direction industrielle confirme que les arbitrages d'investissement suivent le plan ; les écarts sont discutés en comité.",
      fiabilite: "B",
      f: 0.03,
    },
    {
      source: "Visite des sites de transformation (usines de San Pedro et d'Abidjan), deux jours",
      extrait:
        "Procédures affichées aux postes clés, contrôle qualité en entrée de lot systématique, relevés de rebut tenus à la main puis saisis chaque semaine. Peu de standardisation entre les deux sites sur la maintenance préventive.",
      fiabilite: "B",
      f: 0.05,
    },
    {
      source: "Questionnaire de notation « notation_generique » rempli par les cadres de direction",
      extrait:
        "Les réponses des cadres sont favorables sur l'organisation et l'engagement des équipes, avec un écart notable entre la direction générale et les responsables de site sur la clarté des responsabilités.",
      fiabilite: "B",
      f: 0.07,
    },
    {
      source: "Comptabilité analytique par filiale et rapports de gestion mensuels 2024, SICAFE",
      extrait:
        "Les coûts de revient par filiale sont rapprochés de la comptabilité générale chaque mois ; l'écart moyen est inférieur à 2 %. Les rapports de gestion sont remis au comité de direction avant le dixième jour ouvré.",
      fiabilite: "B",
      f: 0.09,
    },
    {
      source:
        "Statistiques de l'organisation internationale du café et du cacao, campagnes 2022 à 2024",
      extrait:
        "La part de marché du groupe dans la transformation locale du café-cacao progresse de 1,5 point sur la période ; deux concurrents régionaux investissent dans l'innovation produit.",
      fiabilite: "C",
      f: 0.11,
    },
  ],
  assertions: {
    strategie: {
      enonce:
        "La stratégie de SICAFE est écrite, chiffrée et revue chaque trimestre par le comité de direction.",
      classe: "R2",
    },
    processus: {
      enonce:
        "Les processus de transformation sont documentés aux postes clés, mais peu standardisés entre les deux sites.",
      classe: "R1",
    },
    pilotage: {
      enonce:
        "Le pilotage s'appuie sur un tableau de bord de quatorze indicateurs revu en comité de direction.",
      classe: "R1",
    },
    amelioration: {
      enonce:
        "La démarche d'amélioration continue repose sur des relevés hebdomadaires de rebut et des plans d'action de site.",
      classe: "R1",
    },
    organisation: {
      enonce:
        "L'organisation est claire au niveau de la direction, moins au niveau des responsables de site.",
      classe: "R1",
    },
    engagement: {
      enonce:
        "L'engagement des cadres est fort ; la stratégie n'est pas encore présentée à l'ensemble du personnel.",
      classe: "R1",
    },
    qualite: {
      enonce:
        "Le contrôle qualité en entrée de lot est systématique et les rebuts sont suivis chaque semaine.",
      classe: "R1",
    },
    couts: {
      enonce:
        "La maîtrise des coûts est étayée par une comptabilité analytique rapprochée chaque mois.",
      classe: "R2",
    },
    innovation: {
      enonce:
        "Deux concurrents régionaux investissent dans l'innovation produit : SICAFE doit structurer sa démarche.",
      classe: "R1",
    },
  },
};

export const REGISTRE_SAHEL_COTON: DefRegistreNotation = {
  mission: CASTING.sahelCoton,
  grille: "competitivite-excellence",
  partielle: "organisation",
  sans: "innovation",
  preuves: [
    {
      source:
        "États financiers certifiés et rapports de gestion de campagne, Sahel Coton, 2022 à 2024",
      extrait:
        "Trois exercices certifiés sans réserve. Les rapports de gestion de campagne présentent le coût de revient par tonne de fibre et le comparent au budget ; l'écart 2024 est de 3,1 %.",
      fiabilite: "A",
      f: 0.02,
    },
    {
      source: "Entretien avec la direction générale et la direction des usines d'égrenage",
      extrait:
        "La direction reconnaît que les tableaux de bord mensuels n'atteignent pas les ateliers. Les décisions de campagne sont prises en comité restreint, sans revue documentée ; la saisonnalité explique une partie des écarts.",
      fiabilite: "B",
      f: 0.03,
    },
    {
      source: "Observation en usine d'égrenage pendant la campagne (deux jours, trois équipes)",
      extrait:
        "Les réglages des égreneuses se transmettent à l'oral entre équipes ; aucune procédure écrite visible en atelier. Le taux de rebut de fibre est relevé par un seul contremaître, sans suivi hebdomadaire.",
      fiabilite: "B",
      f: 0.05,
    },
    {
      source:
        "Questionnaire de notation « notation_generique » rempli par la direction et l'encadrement",
      extrait:
        "Réponses dispersées sur la clarté de l'organisation : la direction juge les rôles clairs, l'encadrement de campagne beaucoup moins. Taux de réponse de 70 % de l'échantillon visé.",
      fiabilite: "C",
      f: 0.07,
    },
    {
      source:
        "Dossier de comptabilité analytique par campagne et grille des prix payés aux producteurs",
      extrait:
        "La comptabilité analytique est tenue par campagne ; les prix payés aux producteurs sont rapprochés des prix de référence de la filière. Les coûts de transport restent estimés hors saison.",
      fiabilite: "B",
      f: 0.09,
    },
    {
      source:
        "Cours de la fibre de coton et rapports de la filière cotonnière régionale, 2023 à 2025",
      extrait:
        "Le prix de la fibre a reculé de 11 % entre 2023 et 2025. Les égreneurs régionaux de taille comparable affichent des coûts de revient légèrement inférieurs.",
      fiabilite: "B",
      f: 0.11,
    },
  ],
  assertions: {
    strategie: {
      enonce:
        "Les orientations de campagne sont connues de la direction mais ne sont pas formalisées dans un plan écrit.",
      classe: "R2",
    },
    processus: {
      enonce:
        "Les processus d'égrenage ne sont pas formalisés : les réglages se transmettent à l'oral entre équipes.",
      classe: "R1",
    },
    pilotage: {
      enonce:
        "Les tableaux de bord mensuels existent mais ne sont pas diffusés aux ateliers ni revus en comité.",
      classe: "R1",
    },
    amelioration: {
      enonce:
        "Aucune démarche d'amélioration continue n'est visible : le rebut de fibre est relevé sans analyse des causes.",
      classe: "R1",
    },
    organisation: {
      enonce:
        "L'organisation de campagne est perçue différemment par la direction et par l'encadrement des usines.",
      classe: "R1",
    },
    engagement: {
      enonce:
        "Les équipes saisonnières sont mobilisées pendant la campagne, avec peu de retour sur leurs résultats.",
      classe: "R1",
    },
    qualite: {
      enonce:
        "Le suivi de la qualité de la fibre repose sur un seul contremaître et n'est pas consolidé chaque semaine.",
      classe: "R1",
    },
    couts: {
      enonce:
        "La comptabilité analytique par campagne est fiable ; le coût de revient 2024 s'écarte de 3,1 % du budget.",
      classe: "R2",
    },
    positionnement: {
      enonce:
        "Face à des égreneurs régionaux aux coûts légèrement inférieurs, la compétitivité de Sahel Coton dépend de ses coûts de transport.",
      classe: "R2",
    },
  },
};

export const REGISTRE_BRASSERIES: DefRegistreNotation = {
  mission: MISSION_BRASSERIES,
  grille: "competitivite-excellence",
  partielle: "couts",
  sans: "engagement",
  preuves: [
    {
      source: "Plan de redressement validé en conseil et comptes 2022 à 2024, Brasseries du Wouri",
      extrait:
        "Le plan de redressement fixe des jalons trimestriels (volumes, marge brute, trésorerie) validés en conseil d'administration. Les comptes 2024 montrent une marge brute en recul de 4 points par rapport à 2022.",
      fiabilite: "A",
      f: 0.02,
    },
    {
      source:
        "Entretien avec la direction générale, la direction commerciale et la direction de production",
      extrait:
        "La direction attribue la baisse des volumes à la hausse des prix de l'emballage et à la concurrence informelle. Les arbitrages de production sont pris chaque semaine, sans revue formelle des écarts.",
      fiabilite: "B",
      f: 0.03,
    },
    {
      source:
        "Observation de la brasserie de Douala et des chaînes de conditionnement, trois jours",
      extrait:
        "Lignes de conditionnement vieillissantes, arrêts non planifiés relevés sur carnet papier. Contrôles qualité en cours de fabrication effectués à fréquence régulière et tracés par lot.",
      fiabilite: "B",
      f: 0.05,
    },
    {
      source:
        "Questionnaire de notation « notation_generique » rempli par les cadres et chefs d'équipe",
      extrait:
        "Les chefs d'équipe se déclarent peu informés des objectifs du plan de redressement ; l'organisation par direction est jugée claire par l'ensemble des répondants.",
      fiabilite: "C",
      f: 0.07,
    },
    {
      source: "Rapports mensuels de production et d'arrêts de lignes, janvier à décembre 2024",
      extrait:
        "Le taux de rendement synthétique des lignes ressort à 68 % en moyenne ; les arrêts non planifiés représentent 14 % du temps d'ouverture. Les rapports sont diffusés au comité de direction chaque mois.",
      fiabilite: "B",
      f: 0.09,
    },
    {
      source: "Données de marché de la distribution de boissons au Cameroun, 2022 à 2024",
      extrait:
        "Le marché de la bière recule de 3 % en volume sur la période ; les prix de l'emballage verre augmentent de 9 %. Une estimation unique, non recoupée, des coûts logistiques des concurrents circule dans la filière.",
      fiabilite: "D",
      f: 0.11,
    },
  ],
  assertions: {
    strategie: {
      enonce:
        "Le plan de redressement est validé en conseil et décliné en jalons trimestriels chiffrés.",
      classe: "R2",
    },
    processus: {
      enonce:
        "Les contrôles qualité en cours de fabrication sont tracés par lot ; les arrêts de ligne ne le sont pas de façon outillée.",
      classe: "R1",
    },
    pilotage: {
      enonce:
        "Le comité de direction reçoit des rapports mensuels de production, mais les écarts ne font pas l'objet d'une revue formelle.",
      classe: "R1",
    },
    amelioration: {
      enonce:
        "Les arrêts non planifiés (14 % du temps d'ouverture) ne donnent pas lieu à une analyse systématique des causes.",
      classe: "R1",
    },
    organisation: {
      enonce: "L'organisation par direction est claire et connue de l'ensemble des cadres.",
      classe: "R1",
    },
    qualite: {
      enonce:
        "La qualité du produit est maîtrisée en cours de fabrication, avec une traçabilité par lot.",
      classe: "R1",
    },
    couts: {
      enonce:
        "Les coûts logistiques restent mal connus : une seule estimation, non recoupée, est disponible.",
      classe: "R2",
    },
    innovation: {
      enonce: "L'outil de production vieillissant limite les innovations de conditionnement.",
      classe: "R1",
    },
    positionnement: {
      enonce:
        "Le marché recule de 3 % en volume et la concurrence informelle pèse sur le positionnement prix.",
      classe: "R2",
    },
  },
};
