import { MISSIONS } from "./commun.js";
import type { DefMissionPreuves } from "./preuves-ecriture.js";

/*
 * Registre des preuves de la mission 1 du casting, « Plan stratégique 2025-2028 — SICAFE »
 * (4 novembre 2024 au 30 avril 2025) : constats FICTIFS de consultants, chiffres cohérents.
 *
 * `j` = nombre de jours depuis le début de la mission (borné à sa fin). Chaque mission porte des
 * preuves de types variés, une révision de preuve (version 2), des assertions « pour » et
 * « contre », deux contradictions arbitrées par un compte qui n'est ni l'auteur de l'assertion ni
 * celui de la preuve contraire, et une assertion nuancée après arbitrage (correction).
 */

export const REGISTRE_SICAFE: DefMissionPreuves = {
  mission: MISSIONS.plan2025,
  equipe: ["consultant", "consultant2", "junior"],
  dimensions: [
    { code: "perf_financiere", libelle: "Performance financière" },
    { code: "marche_clients", libelle: "Marché et clients" },
    { code: "outil_industriel", libelle: "Outil industriel" },
    { code: "alignement_strategique", libelle: "Alignement stratégique" },
  ],
  preuves: [
    {
      cle: "p1",
      type: "document",
      source: "Rapports de gestion SICAFÉ 2022-2024 (états de gestion provisoires 2024)",
      j: 6,
      fiabilite: "B",
      extrait:
        "Chiffre d'affaires 2024 : 86,4 milliards XOF (82,1 en 2022). Marge brute : 24,6 % en 2022, 22,8 % en 2023 et 20,9 % en 2024 (états provisoires).",
      dims: ["perf_financiere"],
      par: "consultant",
      revision: {
        j: 60,
        par: "consultant2",
        motif:
          "Remplacement des états provisoires par les comptes certifiés 2024 reçus le 2 janvier 2025.",
        fiabilite: "A",
        extrait:
          "Chiffre d'affaires 2024 : 86,4 milliards XOF (82,1 en 2022). Marge brute : 24,6 % en 2022, 22,8 % en 2023 et 20,7 % en 2024 (comptes certifiés).",
        source: "Comptes certifiés SICAFÉ 2022-2024 (rapport du commissaire aux comptes)",
      },
    },
    {
      cle: "p2",
      type: "entretien",
      source: "Entretien avec la directrice commerciale, Mme Adjoua Koffi, 14 novembre 2024",
      j: 10,
      fiabilite: "B",
      extrait:
        "« Nos acheteurs européens exigent la traçabilité à la parcelle ; sans dossier complet, nous sortons de la short-list. En 2024, nous avons perdu plusieurs appels d'offres pour cette raison. »",
      dims: ["marche_clients"],
      par: "consultant",
      accord: true,
    },
    {
      cle: "p3",
      type: "donnee_externe",
      source:
        "Organisation internationale du cacao, bulletin trimestriel de statistiques, campagne 2023/24",
      j: 14,
      fiabilite: "A",
      extrait:
        "Cours moyen du cacao en hausse de 62 % sur la campagne 2023/24. La couverture à terme ne dépasse pas 30 % des volumes chez les transformateurs de la sous-région.",
      dims: ["perf_financiere"],
      par: "junior",
      auteur: "consultant2",
    },
    {
      cle: "p4",
      type: "observation",
      source:
        "Visite de l'usine de broyage d'Abidjan (zone industrielle de Yopougon), 20 janvier 2025",
      j: 78,
      fiabilite: "B",
      extrait:
        "Journée d'observation en fin de campagne : taux d'utilisation de la ligne de broyage de 68 % et trois arrêts non planifiés (convoyeur, broyeur à marteaux, coupure d'alimentation).",
      dims: ["outil_industriel"],
      par: "consultant2",
    },
    {
      cle: "p5",
      type: "questionnaire",
      source: "Enquête interne auprès des cadres (32 répondants), 14 décembre 2024",
      j: 40,
      fiabilite: "C",
      extrait:
        "Seuls 41 % des cadres citent la même priorité stratégique que la direction générale ; 59 % déclarent ne pas connaître les objectifs 2025 de leur direction.",
      dims: ["alignement_strategique"],
      par: "chef",
      nominatif: false,
    },
    {
      cle: "p6",
      type: "document",
      source: "Registre des appels d'offres export 2024 (direction commerciale)",
      j: 30,
      fiabilite: "B",
      extrait:
        "14 appels d'offres traités en 2024 : 5 perdus, dont 3 avec le motif « traçabilité parcellaire insuffisante » noté par l'acheteur et 2 sur le prix.",
      dims: ["marche_clients"],
      par: "consultant2",
    },
    {
      cle: "p7",
      type: "document",
      source: "Note de synthèse de la direction commerciale au comité de direction, décembre 2024",
      j: 35,
      fiabilite: "C",
      extrait: "Les appels d'offres perdus en 2024 l'ont été exclusivement sur le prix.",
      dims: ["marche_clients"],
      par: "junior",
    },
    {
      cle: "p8",
      type: "document",
      source: "Fiche de production de l'usine d'Abidjan, exercice 2024",
      j: 45,
      fiabilite: "B",
      extrait:
        "Taux d'utilisation moyen annuel de la ligne de broyage : 79 %, de 91 % au premier semestre de campagne à 66 % en fin de campagne (janvier à mars).",
      dims: ["outil_industriel"],
      par: "consultant",
    },
  ],
  assertions: [
    {
      cle: "a1",
      enonce:
        "La marge brute de SICAFÉ a baissé de 3,9 points entre 2022 et 2024 (de 24,6 % à 20,7 %), sous l'effet de la hausse des cours du cacao.",
      classe: "R2",
      livrable: "Diagnostic stratégique — performance financière",
      dim: "perf_financiere",
      j: 64,
      par: "chef",
      statut: "retenue",
      liens: [
        { preuve: "p1", sens: "pour", j: 64, par: "chef" },
        { preuve: "p3", sens: "pour", j: 64, par: "chef" },
      ],
    },
    {
      cle: "a2",
      enonce:
        "SICAFÉ perd des appels d'offres export faute de dossier de traçabilité à la parcelle : 3 des 5 appels perdus en 2024.",
      classe: "R2",
      livrable: "Diagnostic stratégique — marché et clients",
      dim: "marche_clients",
      j: 50,
      par: "consultant",
      statut: "retenue",
      liens: [
        { preuve: "p2", sens: "pour", j: 50, par: "consultant" },
        { preuve: "p6", sens: "pour", j: 50, par: "consultant" },
        { preuve: "p7", sens: "contre", j: 51, par: "consultant" },
      ],
      arbitrage: {
        preuve: "p7",
        decision: "contradiction_levee",
        par: "chef",
        j: 54,
        motif:
          "Le registre des appels d'offres (fiabilité B) reprend les motifs de refus notifiés par les acheteurs ; la note de la direction commerciale est une synthèse non sourcée (fiabilité C). La preuve contraire est écartée.",
      },
    },
    {
      cle: "a3",
      enonce:
        "Le taux d'utilisation de la ligne de broyage d'Abidjan est de 68 % en fin de campagne, sous le seuil de rentabilité estimé à 75 %.",
      classe: "R2",
      livrable: "Diagnostic stratégique — outil industriel",
      dim: "outil_industriel",
      j: 82,
      par: "consultant2",
      liens: [
        { preuve: "p4", sens: "pour", j: 82, par: "consultant2" },
        { preuve: "p8", sens: "contre", j: 83, par: "consultant2" },
      ],
      arbitrage: {
        preuve: "p8",
        decision: "contradiction_maintenue",
        par: "directeur",
        j: 88,
        motif:
          "Les deux chiffres sont exacts et ne portent pas sur la même période : 79 % en moyenne annuelle, 66 à 68 % en fin de campagne. La contradiction est maintenue et l'énoncé est nuancé.",
      },
      correction: {
        j: 92,
        par: "consultant2",
        motif: "Nuance après arbitrage : moyenne annuelle ajoutée à l'énoncé.",
        statut: "retenue",
        enonce:
          "Le taux d'utilisation de la ligne de broyage d'Abidjan passe sous le seuil de rentabilité estimé à 75 % en fin de campagne (68 % observé en janvier), alors que la moyenne annuelle 2024 est de 79 %.",
      },
    },
    {
      cle: "a4",
      enonce:
        "Moins de la moitié des cadres de SICAFÉ partage la priorité stratégique de la direction générale (41 %).",
      classe: "R1",
      livrable: "Atelier de cadrage stratégique",
      dim: "alignement_strategique",
      j: 44,
      par: "junior",
      liens: [{ preuve: "p5", sens: "pour", j: 44, par: "junior" }],
    },
    {
      cle: "a5",
      enonce:
        "La couverture à terme du cacao (moins de 30 % des volumes chez les pairs) expose SICAFÉ à la volatilité des cours : une politique de couverture de 50 % des volumes est recommandée.",
      classe: "R2",
      livrable: "Plan stratégique 2025-2028 — risques",
      dim: "perf_financiere",
      j: 70,
      par: "associe",
      statut: "retenue",
      avis: "Avis de l'associé fondé sur six transformateurs accompagnés dans la sous-région ; les données de position de SICAFÉ n'ont pas encore été communiquées.",
      liens: [{ preuve: "p3", sens: "pour", j: 71, par: "associe" }],
    },
  ],
};
