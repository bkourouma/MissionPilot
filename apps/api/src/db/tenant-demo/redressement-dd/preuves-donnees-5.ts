import { MISSIONS } from "./commun.js";
import type { DefMissionPreuves } from "./preuves-ecriture.js";

/*
 * Registre des preuves de la mission 5 du casting, « Business plan bancable — Atlantique Retail »
 * (12 janvier au 29 mai 2026) : constats FICTIFS de consultants, chiffres cohérents. Voir
 * preuves-donnees-1.ts pour la lecture des champs.
 */

export const REGISTRE_ATLANTIQUE: DefMissionPreuves = {
  mission: MISSIONS.businessPlan,
  equipe: ["consultant", "consultant2", "junior", "chef2", "directeur2"],
  dimensions: [
    { code: "rentabilite_magasins", libelle: "Rentabilité des magasins" },
    { code: "demande_marche", libelle: "Demande et marché" },
    { code: "concurrence", libelle: "Concurrence" },
    { code: "besoin_financement", libelle: "Besoin de financement" },
    { code: "achats", libelle: "Achats et fournisseurs" },
    { code: "clientele", libelle: "Clientèle" },
  ],
  preuves: [
    {
      cle: "p1",
      type: "document",
      source: "Comptes de gestion 2025 par magasin (42 magasins)",
      j: 14,
      fiabilite: "B",
      extrait:
        "Chiffre d'affaires 2025 : 58,7 milliards XOF. Marge brute : 26,4 % en 2025 contre 27,9 % en 2024. Neuf magasins sur 42 affichent un résultat d'exploitation négatif.",
      dims: ["rentabilite_magasins"],
      par: "consultant",
    },
    {
      cle: "p2",
      type: "document",
      source: "Business plan 2026-2030, version de la direction (novembre 2025)",
      j: 10,
      fiabilite: "C",
      extrait:
        "Marge brute 2025 estimée à 27,5 % (estimation d'octobre) ; marge cible de 28 % en 2028 ; ouverture de 12 magasins en trois ans ; besoin de financement de 9,5 milliards XOF.",
      dims: ["besoin_financement", "rentabilite_magasins"],
      par: "chef",
    },
    {
      cle: "p3",
      type: "donnee_externe",
      source:
        "Enquête nationale sur la consommation des ménages urbains, 2025 (institut de la statistique)",
      j: 20,
      fiabilite: "B",
      extrait:
        "Dépenses alimentaires des ménages urbains en hausse de 6,1 % en valeur et en baisse de 1,2 % en volume, pour une inflation alimentaire de 7,4 %.",
      dims: ["demande_marche"],
      par: "junior",
    },
    {
      cle: "p4",
      type: "entretien",
      source: "Entretien avec la directrice des achats, Mme Aïcha Ndiaye, 3 février 2026",
      j: 22,
      fiabilite: "B",
      extrait:
        "« Les remises de fin d'année des fournisseurs représentent environ 0,8 point de marge ; nous renégocions avec cinq fournisseurs majeurs, sans garantie de les conserver. »",
      dims: ["achats"],
      par: "consultant2",
      accord: true,
      revision: {
        j: 78,
        par: "consultant2",
        motif: "Mise à jour après la clôture des renégociations de mars 2026.",
        extrait:
          "« Les remises de fin d'année des fournisseurs représentent environ 0,8 point de marge. La renégociation est conclue avec trois fournisseurs sur cinq en mars ; leurs remises sont maintenues. »",
      },
    },
    {
      cle: "p5",
      type: "observation",
      source: "Visite de six magasins d'Abidjan et de Bouaké, 16 au 20 février 2026",
      j: 35,
      fiabilite: "B",
      extrait:
        "Taux de rupture en rayon de 11 % ; fréquentation en baisse dans les deux magasins situés à moins de 500 mètres d'un hard-discount ouvert en 2025, avec des files d'attente en caisse de plus de dix minutes.",
      dims: ["concurrence", "clientele"],
      par: "chef",
    },
    {
      cle: "p6",
      type: "questionnaire",
      source: "Enquête clients en magasin (410 répondants), mars 2026",
      j: 60,
      fiabilite: "B",
      extrait:
        "58 % des clients citent le prix comme premier critère de choix du magasin ; 23 % citent le temps d'attente en caisse.",
      dims: ["clientele"],
      par: "junior",
      nominatif: false,
    },
    {
      cle: "p7",
      type: "document",
      source: "Plaquette commerciale de l'enseigne hard-discount concurrente, janvier 2026",
      j: 40,
      fiabilite: "D",
      extrait:
        "Selon l'enseigne concurrente, ses magasins n'affectent pas la fréquentation des supermarchés voisins, dont la clientèle serait « différente ».",
      dims: ["concurrence"],
      par: "consultant",
    },
  ],
  assertions: [
    {
      cle: "a1",
      enonce:
        "La marge brute d'Atlantique Retail a baissé de 1,5 point entre 2024 et 2025 (de 27,9 % à 26,4 %).",
      classe: "R2",
      livrable: "Business plan bancable — analyse de la rentabilité",
      dim: "rentabilite_magasins",
      j: 30,
      par: "chef",
      statut: "retenue",
      liens: [
        { preuve: "p1", sens: "pour", j: 30, par: "chef" },
        { preuve: "p2", sens: "contre", j: 31, par: "chef" },
      ],
      arbitrage: {
        preuve: "p2",
        decision: "contradiction_levee",
        par: "directeur",
        j: 36,
        motif:
          "L'estimation de 27,5 % du plan de la direction date d'octobre 2025 ; les comptes de gestion clos par magasin prévalent. Le plan sera retravaillé sur la base de 26,4 %.",
      },
    },
    {
      cle: "a2",
      enonce:
        "Le besoin de financement de 9,5 milliards XOF est cohérent avec l'ouverture de 12 magasins en trois ans.",
      classe: "R3",
      livrable: "Business plan bancable — plan de financement",
      dim: "besoin_financement",
      j: 45,
      par: "consultant",
      statut: "retenue",
      liens: [
        { preuve: "p2", sens: "pour", j: 45, par: "consultant" },
        { preuve: "p1", sens: "contre", j: 46, par: "consultant" },
      ],
      arbitrage: {
        preuve: "p1",
        decision: "contradiction_maintenue",
        par: "chef2",
        j: 52,
        motif:
          "Le coût des ouvertures est cohérent avec le besoin, mais neuf magasins déficitaires fragilisent la capacité de remboursement. Contradiction maintenue : l'énoncé est nuancé.",
      },
      correction: {
        j: 56,
        par: "consultant",
        motif: "Nuance après arbitrage : réserve sur les magasins déficitaires.",
        statut: "retenue",
        enonce:
          "Le besoin de financement de 9,5 milliards XOF est cohérent avec l'ouverture de 12 magasins en trois ans, sous réserve du redressement ou de la fermeture des neuf magasins déficitaires.",
      },
    },
    {
      cle: "a3",
      enonce:
        "Les dépenses alimentaires des ménages urbains ont reculé de 1,2 % en volume en 2025 malgré une hausse de 6,1 % en valeur.",
      classe: "R1",
      livrable: "Business plan bancable — hypothèses de marché",
      dim: "demande_marche",
      j: 24,
      par: "junior",
      liens: [{ preuve: "p3", sens: "pour", j: 24, par: "junior" }],
    },
    {
      cle: "a4",
      enonce:
        "L'ouverture d'un hard-discount en 2025 à moins de 500 mètres a fait baisser la fréquentation de deux magasins visités.",
      classe: "R2",
      livrable: "Business plan bancable — environnement concurrentiel",
      dim: "concurrence",
      j: 48,
      par: "consultant2",
      statut: "retenue",
      liens: [
        { preuve: "p5", sens: "pour", j: 48, par: "consultant2" },
        { preuve: "p7", sens: "contre", j: 49, par: "consultant2" },
      ],
      arbitrage: {
        preuve: "p7",
        decision: "contradiction_levee",
        par: "directeur2",
        j: 54,
        motif:
          "La plaquette est un document commercial du concurrent, non vérifié (fiabilité D) ; les observations en magasin prévalent.",
      },
    },
    {
      cle: "a5",
      enonce:
        "Le prix est le premier critère de choix du magasin pour 58 % des clients interrogés, devant le temps d'attente en caisse (23 %).",
      classe: "R1",
      livrable: "Business plan bancable — hypothèses de marché",
      dim: "clientele",
      j: 62,
      par: "junior",
      liens: [{ preuve: "p6", sens: "pour", j: 62, par: "junior" }],
    },
    {
      cle: "a6",
      enonce:
        "Les remises de fin d'année des fournisseurs représentent 0,8 point de marge brute et sont maintenues pour trois des cinq fournisseurs renégociés.",
      classe: "R2",
      livrable: "Business plan bancable — hypothèses de marge",
      dim: "achats",
      j: 80,
      par: "consultant2",
      statut: "retenue",
      liens: [{ preuve: "p4", sens: "pour", j: 80, par: "consultant2" }],
    },
  ],
};
