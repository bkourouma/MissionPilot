import { MISSIONS } from "./commun.js";
import type { DefMissionPreuves } from "./preuves-ecriture.js";

/*
 * Registre des preuves de la mission 3 du casting, « Redressement — Brasseries du Wouri »
 * (10 mars au 14 novembre 2025) : constats FICTIFS de consultants, chiffres cohérents.
 *
 * Aucune qualification juridique dans les libellés : « retards de paiement », « accord
 * d'étalement », « tension de trésorerie ». Voir preuves-donnees-1.ts pour la lecture des champs.
 */

export const REGISTRE_BRASSERIES: DefMissionPreuves = {
  mission: MISSIONS.redressementTermine,
  equipe: ["consultant", "consultant2", "junior", "chef2", "directeur2"],
  dimensions: [
    { code: "tresorerie", libelle: "Trésorerie et dettes fournisseurs" },
    { code: "marges_couts", libelle: "Marges et coûts" },
    { code: "exploitation", libelle: "Exploitation et qualité" },
    { code: "commercial", libelle: "Réseau commercial" },
    { code: "relations_banques", libelle: "Relations bancaires" },
  ],
  preuves: [
    {
      cle: "p1",
      type: "document",
      source: "États financiers 2024 et situation intermédiaire à fin février 2025",
      j: 8,
      fiabilite: "B",
      extrait:
        "Chiffre d'affaires 2024 : 41,3 milliards XOF. EBITDA 2024 : 3,1 milliards XOF (5,6 en 2023). Marge brute en recul de 2,6 points sur janvier-février 2025 par rapport à janvier-février 2024.",
      dims: ["marges_couts"],
      par: "consultant",
    },
    {
      cle: "p2",
      type: "document",
      source: "Échéancier des dettes fournisseurs au 31 mars 2025",
      j: 22,
      fiabilite: "B",
      extrait:
        "Dettes fournisseurs échues : 6,8 milliards XOF ; délai moyen de paiement de 118 jours ; 22 fournisseurs critiques payés avec plus de 60 jours de retard.",
      dims: ["tresorerie"],
      par: "consultant2",
      revision: {
        j: 112,
        par: "consultant2",
        motif: "Mise à jour au 30 juin 2025 après les premiers paiements prioritaires.",
        source: "Échéancier des dettes fournisseurs au 30 juin 2025",
        extrait:
          "Dettes fournisseurs échues : 5,1 milliards XOF ; délai moyen de paiement de 104 jours ; 14 fournisseurs critiques payés avec plus de 60 jours de retard.",
      },
    },
    {
      cle: "p3",
      type: "entretien",
      source: "Entretien avec le directeur général, M. Emmanuel Nkoulou, 18 mars 2025",
      j: 8,
      fiabilite: "B",
      extrait:
        "« Nous avons absorbé la hausse des accises du 1er janvier sans toucher aux prix de gros : nous craignions de perdre des parts de marché face aux importations. »",
      dims: ["marges_couts"],
      par: "chef",
      accord: true,
    },
    {
      cle: "p4",
      type: "donnee_externe",
      source: "Loi de finances 2025 — droits d'accises sur les boissons alcoolisées",
      j: 10,
      fiabilite: "A",
      extrait:
        "Taux d'accises sur les bières porté de 25 % à 30 % de la base imposable à compter du 1er janvier 2025.",
      dims: ["marges_couts"],
      par: "junior",
      auteur: "consultant",
    },
    {
      cle: "p5",
      type: "observation",
      source: "Visite de la brasserie de Douala-Bonabéri et des entrepôts, 2 avril 2025",
      j: 23,
      fiabilite: "B",
      extrait:
        "Taux de casse en embouteillage mesuré à 4,8 % pour une norme interne de 2 % ; deux lignes sur quatre arrêtées l'après-midi faute de bouteilles consignées.",
      dims: ["exploitation"],
      par: "consultant2",
    },
    {
      cle: "p6",
      type: "questionnaire",
      source: "Enquête auprès des grossistes partenaires (15 sollicités, 11 réponses), avril 2025",
      j: 45,
      fiabilite: "C",
      extrait:
        "Sept grossistes sur onze déclarent des ruptures de produit au moins une fois par mois ; quatre citent le manque de bouteilles consignées.",
      dims: ["commercial"],
      par: "junior",
      nominatif: false,
    },
    {
      cle: "p7",
      type: "document",
      source: "Budget de trésorerie 2025 de la direction financière (version d'avril)",
      j: 35,
      fiabilite: "C",
      extrait:
        "Retour à l'équilibre de trésorerie dès juin 2025 sans nouvel étalement de dettes, grâce à une revalorisation des prix de gros de 4 % dès avril.",
      dims: ["tresorerie", "marges_couts"],
      par: "consultant",
    },
    {
      cle: "p8",
      type: "document",
      source: "Lettre d'accord de principe de la banque chef de file, juillet 2025",
      j: 125,
      fiabilite: "A",
      extrait:
        "Étalement de 5,2 milliards XOF sur 36 mois avec un différé de six mois, sous condition de la validation du plan de redressement par le comité de crédit.",
      dims: ["relations_banques", "tresorerie"],
      par: "chef",
    },
  ],
  assertions: [
    {
      cle: "a1",
      enonce:
        "Le délai moyen de paiement des fournisseurs est passé de 118 jours au 31 mars 2025 à 104 jours au 30 juin 2025, et les dettes échues de 6,8 à 5,1 milliards XOF.",
      classe: "R2",
      livrable: "Rapport de redressement — trésorerie",
      dim: "tresorerie",
      j: 115,
      par: "consultant2",
      statut: "retenue",
      liens: [{ preuve: "p2", sens: "pour", j: 115, par: "consultant2" }],
    },
    {
      cle: "a2",
      enonce:
        "La non-répercussion de la hausse des accises (+5 points au 1er janvier 2025) a fait reculer la marge brute de 2,6 points sur les deux premiers mois de 2025.",
      classe: "R3",
      livrable: "Rapport de redressement — diagnostic de marge",
      dim: "marges_couts",
      j: 40,
      par: "consultant",
      statut: "retenue",
      liens: [
        { preuve: "p1", sens: "pour", j: 40, par: "consultant" },
        { preuve: "p3", sens: "pour", j: 40, par: "consultant" },
        { preuve: "p4", sens: "pour", j: 40, par: "consultant" },
        { preuve: "p7", sens: "contre", j: 41, par: "consultant" },
      ],
      arbitrage: {
        preuve: "p7",
        decision: "contradiction_maintenue",
        par: "chef2",
        j: 60,
        motif:
          "La revalorisation de 4 % n'est que budgétée ; elle ne compense pas les 5 points d'accises. L'effet de la hausse est confirmé, son ampleur est nuancée : contradiction maintenue.",
      },
      correction: {
        j: 62,
        par: "consultant",
        motif: "Nuance après arbitrage : revalorisation budgétée ajoutée.",
        statut: "retenue",
        enonce:
          "La non-répercussion de la hausse des accises (+5 points au 1er janvier 2025) a fait reculer la marge brute de 2,6 points sur les deux premiers mois de 2025 ; la revalorisation de 4 % budgétée en avril n'en compense qu'une partie.",
      },
    },
    {
      cle: "a3",
      enonce:
        "L'équilibre de trésorerie ne peut pas être atteint en juin 2025 sans accord d'étalement des dettes bancaires.",
      classe: "R3",
      livrable: "Rapport de redressement — plan de trésorerie",
      dim: "tresorerie",
      j: 38,
      par: "chef",
      statut: "retenue",
      liens: [
        { preuve: "p2", sens: "pour", j: 38, par: "chef" },
        { preuve: "p7", sens: "contre", j: 39, par: "chef" },
        { preuve: "p8", sens: "pour", j: 126, par: "chef" },
      ],
      arbitrage: {
        preuve: "p7",
        decision: "contradiction_levee",
        par: "directeur2",
        j: 50,
        motif:
          "Le budget d'avril suppose des recettes (revalorisation de 4 %) non encore encaissées et ignore l'échéancier fournisseurs (6,8 milliards XOF échus). Il est écarté au profit de l'échéancier daté du 31 mars.",
      },
    },
    {
      cle: "a4",
      enonce:
        "Le taux de casse en embouteillage (4,8 %) est plus de deux fois la norme interne (2 %).",
      classe: "R2",
      livrable: "Rapport de redressement — exploitation",
      dim: "exploitation",
      j: 30,
      par: "junior",
      liens: [{ preuve: "p5", sens: "pour", j: 30, par: "junior" }],
    },
    {
      cle: "a5",
      enonce:
        "Les ruptures de produit pèsent sur les ventes : sept grossistes sur onze en signalent au moins une par mois, en lien avec la pénurie de bouteilles consignées.",
      classe: "R2",
      livrable: "Rapport de redressement — réseau commercial",
      dim: "commercial",
      j: 50,
      par: "consultant2",
      statut: "retenue",
      liens: [
        { preuve: "p6", sens: "pour", j: 50, par: "consultant2" },
        { preuve: "p5", sens: "pour", j: 50, par: "consultant2" },
      ],
    },
    {
      cle: "a6",
      enonce:
        "Un accord de principe d'étalement de 5,2 milliards XOF sur 36 mois est acquis, sous réserve de la validation du plan de redressement.",
      classe: "R3",
      livrable: "Rapport de redressement — plan de financement",
      dim: "relations_banques",
      j: 128,
      par: "chef",
      statut: "retenue",
      liens: [{ preuve: "p8", sens: "pour", j: 128, par: "chef" }],
    },
  ],
};
