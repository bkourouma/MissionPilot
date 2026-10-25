import { MISSIONS } from "./commun.js";
import type { DefMissionPreuves } from "./preuves-ecriture.js";

/*
 * Registre des preuves de la mission 2 du casting, « Notation financière — Sahel Coton » (3 février
 * au 20 juin 2025) : constats FICTIFS de consultants, chiffres cohérents. Voir preuves-donnees-1.ts
 * pour la lecture des champs.
 */

export const REGISTRE_SAHEL_COTON: DefMissionPreuves = {
  mission: MISSIONS.notation,
  equipe: ["consultant", "consultant2", "junior"],
  dimensions: [
    { code: "liquidite", libelle: "Liquidité et trésorerie" },
    { code: "rentabilite", libelle: "Rentabilité" },
    { code: "structure_financiere", libelle: "Structure financière" },
    { code: "gouvernance_risques", libelle: "Gouvernance et risques" },
  ],
  preuves: [
    {
      cle: "p1",
      type: "document",
      source: "États financiers certifiés de Sahel Coton Mali, exercices 2022 à 2024",
      j: 5,
      fiabilite: "A",
      extrait:
        "Fin 2024 : fonds de roulement de -4,2 milliards XOF, dettes financières à court terme de 11,8 milliards XOF. Résultat net 2024 de 0,9 milliard XOF (1,6 en 2023) pour un chiffre d'affaires de 63,5 milliards XOF.",
      dims: ["structure_financiere", "rentabilite"],
      par: "consultant",
    },
    {
      cle: "p2",
      type: "document",
      source: "Relevés bancaires consolidés des trois banques partenaires, janvier et février 2025",
      j: 20,
      fiabilite: "B",
      extrait:
        "Utilisation moyenne des lignes de préfinancement de campagne de 92 % sur les deux mois ; dépassement ponctuel de trois jours en février, régularisé.",
      dims: ["liquidite"],
      par: "consultant2",
    },
    {
      cle: "p3",
      type: "entretien",
      source: "Entretien avec le directeur financier, M. Mamadou Traoré, 12 février 2025",
      j: 9,
      fiabilite: "B",
      extrait:
        "« Le préfinancement de la campagne 2024/25 est renégocié : deux banques ont confirmé leur ligne, la troisième n'a pas encore répondu. Le conseil reçoit un point de trésorerie chaque mois, ce que je juge suffisant. »",
      dims: ["liquidite", "gouvernance_risques"],
      par: "chef",
      revision: {
        j: 54,
        par: "consultant2",
        motif: "Ajout de la confirmation écrite de la troisième banque, reçue le 28 mars 2025.",
        fiabilite: "A",
        extrait:
          "« Le préfinancement de la campagne 2024/25 est renégocié : la troisième banque a confirmé sa ligne le 28 mars 2025 (lettre de confirmation au dossier). Le conseil reçoit un point de trésorerie chaque mois, ce que je juge suffisant. »",
      },
    },
    {
      cle: "p4",
      type: "donnee_externe",
      source: "Bulletin de campagne de l'interprofession cotonnière, prix 2024/25",
      j: 25,
      fiabilite: "B",
      extrait:
        "Prix d'achat au producteur fixé à 285 XOF/kg de coton-graine, stable ; cours mondial de la fibre en baisse de 11 % sur la campagne.",
      dims: ["rentabilite"],
      par: "junior",
    },
    {
      cle: "p5",
      type: "observation",
      source: "Visite des usines d'égrenage de Koutiala et de Sikasso, 6 et 7 mars 2025",
      j: 32,
      fiabilite: "B",
      extrait:
        "Stock de coton-graine à Koutiala d'environ 14 jours de production ; équipements de pesée et de comptage en bon état ; retards de paiement des transporteurs signalés par le chef d'usine.",
      dims: ["structure_financiere"],
      par: "consultant2",
    },
    {
      cle: "p6",
      type: "questionnaire",
      source: "Questionnaire de gouvernance adressé aux neuf administrateurs (sept réponses)",
      j: 40,
      fiabilite: "C",
      extrait:
        "Cinq administrateurs sur sept jugent le suivi de la trésorerie trop peu fréquent (mensuel) ; deux demandent un suivi hebdomadaire en période de campagne.",
      dims: ["gouvernance_risques"],
      par: "junior",
      nominatif: false,
    },
    {
      cle: "p7",
      type: "document",
      source: "Note interne de la direction financière sur la trésorerie, février 2025",
      j: 18,
      fiabilite: "C",
      extrait:
        "Aucune tension de trésorerie à prévoir sur la campagne 2024/25 : les préfinancements couvrent l'ensemble des besoins.",
      dims: ["liquidite"],
      par: "consultant",
    },
  ],
  assertions: [
    {
      cle: "a1",
      enonce:
        "Le fonds de roulement de Sahel Coton est négatif de 4,2 milliards XOF fin 2024 et la trésorerie de campagne repose à plus de 90 % sur des préfinancements bancaires.",
      classe: "R3",
      livrable: "Rapport de notation — liquidité",
      dim: "liquidite",
      j: 30,
      par: "chef",
      statut: "retenue",
      liens: [
        { preuve: "p1", sens: "pour", j: 30, par: "chef" },
        { preuve: "p2", sens: "pour", j: 30, par: "chef" },
        { preuve: "p7", sens: "contre", j: 31, par: "chef" },
      ],
      arbitrage: {
        preuve: "p7",
        decision: "contradiction_levee",
        par: "directeur",
        j: 36,
        motif:
          "La note interne de février ignore les tirages sur préfinancement visibles dans les relevés bancaires (fiabilité B) ; elle est écartée. La tension de trésorerie reste retenue dans la notation.",
      },
    },
    {
      cle: "a2",
      enonce:
        "Le résultat net 2024 (0,9 milliard XOF) reste positif malgré une baisse de 11 % du cours mondial de la fibre, grâce à un prix d'achat producteur stable.",
      classe: "R2",
      livrable: "Rapport de notation — rentabilité",
      dim: "rentabilite",
      j: 34,
      par: "consultant",
      statut: "retenue",
      liens: [
        { preuve: "p1", sens: "pour", j: 34, par: "consultant" },
        { preuve: "p4", sens: "pour", j: 34, par: "consultant" },
      ],
    },
    {
      cle: "a3",
      enonce:
        "Le suivi de la trésorerie par le conseil d'administration, mensuel, est jugé insuffisant par la majorité des administrateurs ayant répondu (5 sur 7).",
      classe: "R2",
      livrable: "Rapport de notation — gouvernance",
      dim: "gouvernance_risques",
      j: 44,
      par: "consultant2",
      liens: [
        { preuve: "p6", sens: "pour", j: 44, par: "consultant2" },
        { preuve: "p3", sens: "contre", j: 45, par: "consultant2" },
      ],
      arbitrage: {
        preuve: "p3",
        decision: "contradiction_maintenue",
        par: "directeur",
        j: 60,
        motif:
          "La direction juge la fréquence mensuelle suffisante, les administrateurs non : l'écart de perception est réel et assumé. La contradiction est maintenue et traitée dans les recommandations.",
      },
      correction: {
        j: 64,
        par: "consultant2",
        motif: "Nuance après arbitrage : position de la direction financière ajoutée.",
        statut: "retenue",
        enonce:
          "Le suivi mensuel de la trésorerie par le conseil est jugé insuffisant par 5 administrateurs sur 7, alors que la direction financière le juge suffisant ; l'écart de perception est assumé et traité dans les recommandations de gouvernance.",
      },
    },
    {
      cle: "a4",
      enonce:
        "La troisième banque partenaire a confirmé par écrit sa ligne de préfinancement de la campagne 2024/25 le 28 mars 2025.",
      classe: "R2",
      livrable: "Rapport de notation — liquidité",
      dim: "liquidite",
      j: 58,
      par: "chef",
      statut: "retenue",
      liens: [{ preuve: "p3", sens: "pour", j: 58, par: "chef" }],
    },
    {
      cle: "a5",
      enonce:
        "Le stock de coton-graine de l'usine de Koutiala couvre environ 14 jours de production au début de mars 2025.",
      classe: "R1",
      livrable: "Annexe — visite des usines d'égrenage",
      dim: "structure_financiere",
      j: 36,
      par: "junior",
      liens: [{ preuve: "p5", sens: "pour", j: 36, par: "junior" }],
    },
  ],
};
