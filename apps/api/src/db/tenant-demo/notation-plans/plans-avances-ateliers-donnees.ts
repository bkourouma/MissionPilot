import type { MethodeAtelier } from "@missionpilot/shared";
import type { CleDirigeant } from "./plans-avances-portail.js";

/*
 * Spécifications des ateliers en ligne semés par l'étape « plans-avances » (données seulement ; le
 * moteur de rejeu est plans-avances-ateliers.ts). Une option est soit une initiative du plan
 * (rang dans l'ordre de création des initiatives, 1 = première), soit un libellé libre ; `impact` et
 * `effort` (1 à 5) sont la tendance du groupe : chaque participant s'en écarte d'un bruit à graine
 * fixe (ctx.alea.deriver), jamais de hasard. Les agrégats, eux, sortent du moteur à la clôture.
 */

export type Personne = "chef" | "directeur" | "consultant" | "associe" | CleDirigeant;
export type PlanAtelier = "sicafe" | "atlantique" | "baobab";

export type OptionSpec =
  | { initiative: number; impact: number; effort: number }
  | { libelle: string; description?: string; impact: number; effort: number };

export interface SpecAtelier {
  plan: PlanAtelier;
  titre: string;
  consigne: string;
  methodes: readonly MethodeAtelier[];
  options: readonly OptionSpec[];
  /** Statut atteint à la date du jeu de données. */
  statut: "brouillon" | "ouvert" | "clos";
  /** Invités (cabinet puis dirigeants du client). */
  participants: readonly Personne[];
  /** Qui dépose quoi (ouvert ou clos) ; qui est absent de la liste n'a rien déposé. */
  contributions: readonly (readonly [Personne, readonly MethodeAtelier[]])[];
  /** Participants qui REMPLACENT leur vote (deuxième version, ajout seul). */
  revisions?: readonly (readonly [Personne, MethodeAtelier])[];
  /** Synthèse IA de l'atelier clos : brouillon, retouchée (« modifié »), ou aucune. */
  synthese?: "brouillon" | "modifie";
}

const TOUTES: readonly MethodeAtelier[] = ["vote", "priorisation", "matrice"];

const tous = (qui: readonly Personne[], methodes = TOUTES) =>
  qui.map((p) => [p, methodes] as const);

const EQUIPE: readonly Personne[] = ["chef", "directeur", "consultant"];
const SICAFE: readonly CleDirigeant[] = ["sicafe.dg", "sicafe.dga", "sicafe.operations"];
const BAOBAB: readonly CleDirigeant[] = ["baobab.dg", "baobab.dga", "baobab.commercial"];

export const ATELIERS: readonly SpecAtelier[] = [
  {
    plan: "sicafe",
    titre: "Atelier de priorisation des initiatives du plan 2025-2028",
    consigne:
      "Parmi les initiatives candidates du plan, répartissez 10 points (5 au plus sur une même initiative), " +
      "classez-les par ordre de priorité, puis placez chacune selon sa valeur pour SICAFÉ et son effort de mise en œuvre.",
    methodes: TOUTES,
    options: [
      { initiative: 1, impact: 4, effort: 5 },
      { initiative: 2, impact: 4, effort: 2 },
      { initiative: 3, impact: 5, effort: 3 },
      { initiative: 5, impact: 3, effort: 3 },
      { initiative: 6, impact: 4, effort: 4 },
      { initiative: 7, impact: 4, effort: 3 },
      { initiative: 8, impact: 5, effort: 4 },
      { initiative: 11, impact: 2, effort: 4 },
    ],
    statut: "clos",
    participants: [...EQUIPE, ...SICAFE],
    contributions: tous([...EQUIPE, ...SICAFE]),
    revisions: [["sicafe.dga", "vote"]],
    synthese: "modifie",
  },
  {
    plan: "sicafe",
    titre: "Choix des marchés d'export à ouvrir en priorité",
    consigne:
      "Répartissez 10 points entre les marchés d'export envisagés (5 au plus sur un même marché). " +
      "La matrice valeur / effort n'a été remplie que par deux dirigeants : son agrégat reste masqué.",
    methodes: ["vote", "matrice"],
    options: [
      {
        libelle: "Union européenne (Rotterdam, Anvers)",
        description: "Acheteurs historiques, exigences de traçabilité élevées.",
        impact: 5,
        effort: 3,
      },
      {
        libelle: "Maghreb (Maroc, Algérie)",
        description: "Proximité logistique, torréfacteurs en croissance.",
        impact: 3,
        effort: 2,
      },
      {
        libelle: "Afrique de l'Ouest (CEDEAO)",
        description: "Marché régional, paiement en monnaie locale.",
        impact: 3,
        effort: 1,
      },
      {
        libelle: "Moyen-Orient (Émirats, Arabie saoudite)",
        description: "Négociants établis à Dubaï.",
        impact: 3,
        effort: 4,
      },
      {
        libelle: "Asie du Sud-Est (Vietnam, Indonésie)",
        description: "Transformateurs de cacao, prix plus volatils.",
        impact: 2,
        effort: 5,
      },
      {
        libelle: "Amérique du Nord",
        description: "Segments équitable et biologique.",
        impact: 2,
        effort: 4,
      },
    ],
    statut: "clos",
    participants: [...EQUIPE, ...SICAFE],
    contributions: [
      ...tous([...EQUIPE, ...SICAFE], ["vote"]),
      ["sicafe.dg", ["matrice"]],
      ["sicafe.dga", ["matrice"]],
    ],
  },
  {
    plan: "baobab",
    titre: "Atelier de priorisation des chantiers du plan 2026-2030",
    consigne:
      "Répartissez 10 points entre les six chantiers du plan (5 au plus sur un même chantier), classez-les, " +
      "puis placez-les selon leur impact sur la performance technique et leur effort.",
    methodes: TOUTES,
    options: [
      { initiative: 1, impact: 5, effort: 5 },
      { initiative: 2, impact: 4, effort: 3 },
      { initiative: 3, impact: 3, effort: 2 },
      { initiative: 4, impact: 4, effort: 5 },
      { initiative: 5, impact: 4, effort: 2 },
      { initiative: 6, impact: 3, effort: 3 },
    ],
    statut: "clos",
    participants: [...EQUIPE, ...BAOBAB],
    contributions: tous([...EQUIPE, ...BAOBAB]),
    synthese: "brouillon",
  },
  {
    plan: "baobab",
    titre: "Arbitrage des priorités de la première année",
    consigne:
      "Atelier en cours : répartissez 10 points entre les priorités de l'année 1 et classez-les. " +
      "Les résultats seront publiés à la clôture, sous réserve d'au moins 3 contributeurs par méthode.",
    methodes: ["vote", "priorisation"],
    options: [
      { libelle: "Stabiliser le système cœur avant toute nouvelle offre", impact: 5, effort: 4 },
      { libelle: "Accélérer la souscription digitale", impact: 4, effort: 3 },
      { libelle: "Renforcer le dispositif de lutte contre la fraude", impact: 4, effort: 2 },
      { libelle: "Déployer la micro-assurance mobile", impact: 3, effort: 3 },
      { libelle: "Étendre le réseau d'agences", impact: 3, effort: 5 },
      { libelle: "Réorganiser la direction technique et sinistres", impact: 3, effort: 2 },
    ],
    statut: "ouvert",
    participants: [...EQUIPE, ...BAOBAB],
    contributions: [
      ["chef", ["vote"]],
      ["consultant", ["vote", "priorisation"]],
      ["baobab.dg", ["vote", "priorisation"]],
      ["baobab.dga", ["vote"]],
    ],
  },
  {
    plan: "baobab",
    titre: "Cartographie des risques stratégiques à instruire",
    consigne:
      "Brouillon préparé par l'équipe : placez chaque risque selon son impact sur le plan et la difficulté de le maîtriser.",
    methodes: ["matrice"],
    options: [
      { libelle: "Retard de la refonte du système cœur de métier", impact: 5, effort: 4 },
      { libelle: "Hausse de la sinistralité sur la branche automobile", impact: 4, effort: 3 },
      { libelle: "Dépendance à un réassureur unique", impact: 4, effort: 2 },
      { libelle: "Évolution de la réglementation de la zone CIMA", impact: 3, effort: 3 },
      { libelle: "Fuite de compétences actuarielles", impact: 3, effort: 3 },
    ],
    statut: "brouillon",
    participants: ["chef", "directeur"],
    contributions: [],
  },
  {
    plan: "atlantique",
    titre: "Leviers de financement à instruire avec les banques",
    consigne:
      "Atelier interne du cabinet (aucun dirigeant du client invité) : répartissez 10 points entre les leviers " +
      "de financement du business plan puis classez-les.",
    methodes: ["vote", "priorisation"],
    options: [
      { libelle: "Crédit d'investissement bancaire senior (7 ans)", impact: 5, effort: 2 },
      { libelle: "Crédit-bail des équipements de froid", impact: 3, effort: 1 },
      { libelle: "Ouverture du capital à un fonds de développement", impact: 4, effort: 5 },
      { libelle: "Emprunt obligataire sur le marché régional", impact: 3, effort: 5 },
      { libelle: "Avance en compte courant d'associés", impact: 2, effort: 1 },
      { libelle: "Affacturage inversé des fournisseurs", impact: 3, effort: 3 },
    ],
    statut: "clos",
    participants: [...EQUIPE, "associe"],
    contributions: tous([...EQUIPE, "associe"], ["vote", "priorisation"]),
  },
];
