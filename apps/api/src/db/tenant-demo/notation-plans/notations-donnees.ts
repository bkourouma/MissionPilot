import type { CleCompteCabinet } from "../cles.js";
import { CASTING, type MissionCasting } from "./casting.js";
import type { CommentaireIa, PlanAction } from "./notations-extras.js";
import type { Action } from "./notations-parcours.js";

/*
 * Données des notations des missions 2 (Sahel Coton) et 9 (Banque du Sahel). Les notes sortent
 * des moteurs : seules les actions humaines (qui calcule, ajuste de combien et pourquoi, soumet,
 * renvoie, publie) sont décrites ici.
 */

export interface DefNotation {
  mission: MissionCasting;
  /** Code de la grille (étape « notation-referentiels »). */
  grille: string;
  /** Chef de mission : ajoute les membres, lie la méthode, lit. */
  chef: CleCompteCabinet;
  creePar: CleCompteCabinet;
  /** Comptes à placer dans l'équipe de la mission (un expert ne voit que les missions de son équipe). */
  equipe: readonly CleCompteCabinet[];
  methode: { contexte: Record<string, unknown>; motif: string };
  versions: readonly (readonly Action[])[];
  plans: readonly PlanAction[];
  commentaires: readonly CommentaireIa[];
}

const ajuster = (
  par: CleCompteCabinet,
  dimension: string,
  delta: number,
  motif: string,
): Action => ({ t: "ajuster", par, dimension, delta, motif });

export const NOTATIONS: readonly DefNotation[] = [
  {
    mission: CASTING.sahelCoton,
    grille: "competitivite-excellence",
    chef: "chef.mission",
    creePar: "consultant",
    equipe: ["consultant", "consultant.2", "expert.metier", "expert.metier.2"],
    methode: {
      contexte: {
        effectif: 85,
        filieres: ["coton"],
        agricole: true,
        pays: "ml",
        zone: "uemoa",
        taille: "moyenne",
        saisonnalite: "campagne_agricole",
      },
      motif: "Notation financière d'un égreneur de coton : contexte du dossier client repris.",
    },
    versions: [
      [
        { t: "calcul", par: "consultant", secteur: null, strategie: "ignorer" },
        ajuster(
          "chef.mission",
          "pilotage",
          -22,
          "Tableaux de bord mensuels non diffusés aux ateliers ni à la direction.",
        ),
        ajuster(
          "chef.mission",
          "processus",
          -20,
          "Processus d'égrenage non formalisés : aucune procédure écrite vue en atelier.",
        ),
        ajuster(
          "chef.mission",
          "qualite",
          -18,
          "Taux de rebut de fibre non suivi et réclamations clients non tracées.",
        ),
        ajuster(
          "chef.mission",
          "couts",
          -16,
          "Coût de revient par tonne de fibre estimé hors saison, non rapproché de la comptabilité.",
        ),
        { t: "soumettre", par: "consultant" },
        {
          t: "renvoyer",
          par: "expert.metier.2",
          motif:
            "Ajustements cumulés disproportionnés par rapport aux preuves et pondérations du secteur agro-industrie non appliquées : relancer le calcul avec le secteur du client.",
        },
      ],
      [
        { t: "calcul", par: "consultant", secteur: "agro_industrie", strategie: "penaliser" },
        ajuster(
          "chef.mission",
          "couts",
          6,
          "Comptabilité analytique par campagne vérifiée sur pièces.",
        ),
        ajuster("chef.mission", "pilotage", -3, "Revue de direction trimestrielle non documentée."),
        { t: "soumettre", par: "consultant" },
        {
          t: "publier",
          par: "expert.metier",
          qualite: {
            chef: "chef.mission",
            consultant: "consultant",
            second: "expert.metier.2",
            directeur: "directeur.mission.2",
          },
        },
      ],
    ],
    plans: [
      { version: 1, par: "consultant", capacite: 6 },
      { version: 2, par: "consultant", capacite: 10, secteur: "agro_industrie" },
    ],
    commentaires: [
      { version: 1, par: "consultant" },
      {
        version: 2,
        par: "consultant",
        precision:
          "Précision du consultant : la saisonnalité de la campagne cotonnière explique les écarts de perception sur le pilotage.",
      },
    ],
  },
  {
    mission: CASTING.banqueSahel,
    grille: "grille-banque-pme",
    chef: "chef.mission.2",
    creePar: "consultant.2",
    equipe: ["consultant", "consultant.2", "expert.metier", "expert.metier.2"],
    methode: {
      contexte: {
        effectif: 320,
        filieres: ["banque"],
        agricole: false,
        pays: "bf",
        zone: "uemoa",
        taille: "grande",
      },
      motif: "Notation d'un portefeuille PME bancaire : contexte du dossier client repris.",
    },
    versions: [
      [
        { t: "calcul", par: "consultant.2", secteur: null, strategie: "ignorer" },
        ajuster(
          "chef.mission.2",
          "qualite",
          -30,
          "Taux de créances douteuses sous-estimé par la direction.",
        ),
        { t: "soumettre", par: "consultant.2" },
        {
          t: "renvoyer",
          par: "expert.metier",
          motif: "Ajustement insuffisamment étayé : joindre la balance âgée du portefeuille.",
        },
        ajuster(
          "chef.mission.2",
          "couts",
          -20,
          "Coût du risque rapporté à l'encours : balance âgée jointe.",
        ),
        { t: "soumettre", par: "consultant.2" },
        {
          t: "renvoyer",
          par: "expert.metier.2",
          motif:
            "Les réponses manquantes ne doivent pas être ignorées sur un portefeuille bancaire : calcul pénalisant exigé.",
        },
      ],
      [
        { t: "calcul", par: "consultant.2", secteur: "services", strategie: "penaliser" },
        ajuster(
          "chef.mission.2",
          "pilotage",
          4,
          "Comité de crédit hebdomadaire effectivement tenu (procès-verbaux vus).",
        ),
        { t: "soumettre", par: "consultant.2" },
      ],
    ],
    plans: [{ version: 2, par: "consultant.2", capacite: 8, secteur: "services" }],
    commentaires: [{ version: 2, par: "consultant.2" }],
  },
];
