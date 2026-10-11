/**
 * Catalogue FERMÉ des outils du copilote (AGT-08) : la seule chose que le modèle de langage
 * (quand l'IA est activée) ou le routeur déterministe peut choisir. Aucun outil n'est ajouté à
 * l'exécution : une entrée de plus passe par ce fichier, par `ACTIONS` côté API pour une action
 * modifiante, et par les tests.
 *
 * Les outils de LECTURE répondent par des gabarits français construits par le code (gabarits.ts)
 * à partir des résultats des services : aucun texte libre généré, aucun chiffre venu d'un modèle.
 * Les outils d'ACTION ne s'exécutent jamais directement : ils produisent une proposition que
 * l'utilisateur confirme (PRD complémentaire §7 : « toute action modifiante est confirmée »).
 */

export const OUTILS_LECTURE_COPILOTE = [
  "mes_taches",
  "mes_feuilles_temps",
  "resume_mission",
  "kpi_rouges",
  "factures_echues",
  "recherche",
] as const;

export const OUTILS_ACTION_COPILOTE = ["creer_tache"] as const;

export const OUTILS_COPILOTE = [...OUTILS_LECTURE_COPILOTE, ...OUTILS_ACTION_COPILOTE] as const;

export type OutilCopilote = (typeof OUTILS_COPILOTE)[number];
export type OutilLectureCopilote = (typeof OUTILS_LECTURE_COPILOTE)[number];
export type OutilActionCopilote = (typeof OUTILS_ACTION_COPILOTE)[number];

/** Paramètres typés de chaque outil (jamais un identifiant : le modèle n'en connaît aucun). */
export interface ParametresCopilote {
  mes_taches: Record<string, never>;
  mes_feuilles_temps: Record<string, never>;
  /** Nom (ou fragment) de la mission ; absent : la mission du contexte de l'écran. */
  resume_mission: { mission?: string };
  kpi_rouges: Record<string, never>;
  factures_echues: Record<string, never>;
  recherche: { texte: string };
  creer_tache: {
    titre: string;
    /** Date ISO `AAAA-MM-JJ`. */
    echeance?: string;
    /** Nom du collaborateur ; absent : l'utilisateur lui-même. */
    pour?: string;
    /** Nom (ou fragment) de la mission liée. */
    mission?: string;
  };
}

export type ChoixCopilote = {
  [O in OutilCopilote]: { outil: O; parametres: ParametresCopilote[O] };
}[OutilCopilote];

export interface DefinitionOutilCopilote {
  libelle: string;
  /** Description donnée au modèle de langage (et à l'aide), en français. */
  description: string;
  /** Format des paramètres, tel que décrit au modèle. */
  format_parametres: string;
  /** Une action modifiante n'est jamais exécutée sans confirmation de l'utilisateur. */
  modifiant: boolean;
}

export const DEFINITIONS_OUTILS_COPILOTE: Readonly<Record<OutilCopilote, DefinitionOutilCopilote>> =
  {
    mes_taches: {
      libelle: "Mes tâches",
      description:
        "Liste les tâches ouvertes de l'utilisateur, avec leurs échéances et les retards.",
      format_parametres: "{}",
      modifiant: false,
    },
    mes_feuilles_temps: {
      libelle: "Mes feuilles de temps",
      description: "Liste les feuilles de temps de l'utilisateur qui restent à soumettre.",
      format_parametres: "{}",
      modifiant: false,
    },
    resume_mission: {
      libelle: "Résumé d'une mission",
      description:
        "Résume une mission : statut, avancement, jalons en retard et indicateurs au rouge. " +
        "Le nom de la mission est facultatif quand l'écran en fournit une.",
      format_parametres: '{"mission": "nom ou fragment du nom de la mission (facultatif)"}',
      modifiant: false,
    },
    kpi_rouges: {
      libelle: "KPI au rouge",
      description: "Liste les indicateurs (KPI) au rouge des missions de l'utilisateur.",
      format_parametres: "{}",
      modifiant: false,
    },
    factures_echues: {
      libelle: "Factures échues",
      description: "Liste les factures échues non soldées (retard de paiement des clients).",
      format_parametres: "{}",
      modifiant: false,
    },
    recherche: {
      libelle: "Recherche",
      description:
        "Recherche des mots dans les missions, livrables, rapports, preuves et retours d'expérience.",
      format_parametres: '{"texte": "mots à rechercher"}',
      modifiant: false,
    },
    creer_tache: {
      libelle: "Créer une tâche",
      description:
        "Propose la création d'une tâche (pour l'utilisateur ou un collaborateur) ; " +
        "l'utilisateur confirme avant toute création.",
      format_parametres:
        '{"titre": "intitulé de la tâche", "echeance": "AAAA-MM-JJ (facultatif)", ' +
        '"pour": "nom du collaborateur (facultatif)", "mission": "nom de la mission (facultatif)"}',
      modifiant: true,
    },
  };

export const estOutilCopilote = (valeur: unknown): valeur is OutilCopilote =>
  typeof valeur === "string" && (OUTILS_COPILOTE as readonly string[]).includes(valeur);

export const estOutilModifiant = (outil: OutilCopilote): boolean =>
  DEFINITIONS_OUTILS_COPILOTE[outil].modifiant;

/** Au plus ce nombre d'éléments par réponse (paginée côté lecture, jamais de liste sans borne). */
export const LIMITE_ELEMENTS_COPILOTE = 10;
/** Message de l'utilisateur : longueur maximale, en caractères. */
export const MESSAGE_COPILOTE_MAX = 1000;
