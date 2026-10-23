/**
 * Contre-analyse d'un brouillon IA (AGT-06, agent « contradicteur ») : logique pure, testée dans
 * `contradicteur.test.ts`. La revue est un brouillon IA à part : elle informe, ne bloque jamais et
 * ne modifie pas le brouillon relu. L'API reste seule juge des droits et des règles.
 */
import { aPermission } from "@missionpilot/shared";
import { ErreurApi } from "./api";
import { messageErreurIa } from "./ia";
import type { UtilisateurIa } from "./ia-contenu";

export const TYPE_ENTITE_REVUE = "revue_contradictoire";

export const MENTION_REVUE =
  "Brouillon IA : objections à examiner, non bloquantes ; le brouillon relu n'est pas modifié.";

export const MESSAGE_REVUE_ACTIVE =
  "Une contre-analyse de ce brouillon est déjà en cours : patientez, puis actualisez la liste.";

export interface ContenuRevue {
  contre_preuves: string[];
  incoherences: string[];
  affirmations_non_sourcees: string[];
}

export interface RevueContradictoire {
  id: string;
  generation_id: string | null;
  revue_generation_id: string | null;
  statut_contenu: string | null;
  version: number | null;
  contenu: ContenuRevue;
  nombres_non_verifies: string[];
  cree_le: string | null;
  mode_degrade: boolean;
}

export interface ListeRevues {
  revue_active: boolean;
  elements: RevueContradictoire[];
}

export const SECTIONS_REVUE: readonly {
  cle: keyof ContenuRevue;
  titre: string;
  aide: string;
}[] = [
  {
    cle: "contre_preuves",
    titre: "Contre-preuves",
    aide: "Éléments du dossier qui contredisent le brouillon.",
  },
  {
    cle: "incoherences",
    titre: "Incohérences",
    aide: "Passages qui se contredisent entre eux.",
  },
  {
    cle: "affirmations_non_sourcees",
    titre: "Affirmations non sourcées",
    aide: "Affirmations que rien ne permet d'étayer.",
  },
];

export const MESSAGES_ERREURS_REVUE: Readonly<Record<string, string>> = {
  REVUE_DEJA_ACTIVE: MESSAGE_REVUE_ACTIVE,
  BROUILLON_NON_REVISABLE:
    "Ce contenu ne peut pas être relu : seul un brouillon IA ou modifié, non validé, se soumet à une contre-analyse.",
  BRIQUE_NON_DECLAREE:
    "La contre-analyse n'est pas encore déclarée pour ce cabinet : un associé doit la préparer dans l'écran des agents.",
  AGENT_SUR_DEMANDE_SEULEMENT:
    "Cet agent ne se lance qu'à la demande d'un consultant, jamais automatiquement.",
  AGENT_INACTIF:
    "L'agent contradicteur est désactivé : un associé peut le réactiver dans l'écran des agents.",
  AUTONOMIE_N0:
    "Le niveau d'autonomie de la contre-analyse est N0 (aucune IA) : il doit être relevé dans l'écran des agents.",
  IA_DESACTIVEE: "L'IA est désactivée pour le cabinet : la contre-analyse est indisponible.",
  IA_NON_CONFIGUREE:
    "L'IA n'est pas configurée (aucune clé disponible) : la contre-analyse est indisponible.",
  PLAFOND_MISSION_ATTEINT:
    "Le plafond de coût IA de la mission est atteint : la contre-analyse est refusée jusqu'à son relèvement.",
  JEU_ESSAI_REQUIS:
    "Aucun jeu d'essai n'est enregistré pour le prompt de la contre-analyse : un associé doit préparer la revue dans l'écran des agents.",
  NON_REGRESSION_REQUISE:
    "Le prompt de la contre-analyse n'a pas encore passé l'évaluation de non-régression : un associé doit la lancer dans l'écran des agents.",
  REVUE_INCOHERENTE:
    "La contre-analyse produite est incohérente avec le brouillon relu et a été écartée. Vous pouvez la relancer.",
  REVUE_NON_PRODUITE:
    "Aucune contre-analyse exploitable n'a été produite. Le brouillon n'est pas modifié ; vous pouvez réessayer.",
};

/** Message français d'une erreur d'appel de contre-analyse. */
export function messageErreurRevue(e: unknown): string {
  if (e instanceof ErreurApi) {
    const fixe = MESSAGES_ERREURS_REVUE[e.code];
    if (fixe) return fixe;
    if (e.statut === 502) return MESSAGES_ERREURS_REVUE.REVUE_NON_PRODUITE ?? messageErreurIa(e);
  }
  return messageErreurIa(e);
}

export const estRevueDejaActive = (e: unknown) =>
  e instanceof ErreurApi && e.code === "REVUE_DEJA_ACTIVE";

/** Chemin de l'API (liste des revues d'un brouillon). */
export function cheminRevues(generationId: string, limite = 10): string {
  return `/api/agents/revues-contradictoires?generation_id=${encodeURIComponent(generationId)}&limite=${limite}`;
}

const estObjet = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const listeTextes = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.filter((t): t is string => typeof t === "string" && t.trim() !== "").map((t) => t.trim())
    : [];

/** Lecture défensive d'une revue : champs absents ou mal typés deviennent des valeurs vides. */
export function normaliserRevue(brut: unknown): RevueContradictoire | null {
  if (!estObjet(brut) || typeof brut.id !== "string") return null;
  const c = estObjet(brut.contenu) ? brut.contenu : {};
  return {
    id: brut.id,
    generation_id: typeof brut.generation_id === "string" ? brut.generation_id : null,
    revue_generation_id:
      typeof brut.revue_generation_id === "string" ? brut.revue_generation_id : null,
    statut_contenu: typeof brut.statut_contenu === "string" ? brut.statut_contenu : null,
    version: typeof brut.version === "number" ? brut.version : null,
    contenu: {
      contre_preuves: listeTextes(c.contre_preuves),
      incoherences: listeTextes(c.incoherences),
      affirmations_non_sourcees: listeTextes(c.affirmations_non_sourcees),
    },
    nombres_non_verifies: listeTextes(brut.nombres_non_verifies),
    cree_le: typeof brut.cree_le === "string" ? brut.cree_le : null,
    mode_degrade: brut.mode_degrade === true,
  };
}

/** Lecture défensive de GET /agents/revues-contradictoires. */
export function normaliserListeRevues(brut: unknown): ListeRevues {
  if (!estObjet(brut)) return { revue_active: false, elements: [] };
  const elements = Array.isArray(brut.elements)
    ? brut.elements.map(normaliserRevue).filter((r): r is RevueContradictoire => r !== null)
    : [];
  return { revue_active: brut.revue_active === true, elements };
}

export const nombreObjections = (c: ContenuRevue): number =>
  c.contre_preuves.length + c.incoherences.length + c.affirmations_non_sourcees.length;

export function resumeRevue(c: ContenuRevue): string {
  const n = nombreObjections(c);
  return n === 0 ? "Aucune objection relevée" : `${n} objection${n > 1 ? "s" : ""} à examiner`;
}

/**
 * Le bouton est proposé sur un brouillon IA ou modifié terminé, qui n'est pas lui-même une revue,
 * à un utilisateur qui a le droit « ia.utiliser » (confort d'affichage ; l'API décide).
 */
export function contreAnalysePossible(
  g: {
    statut: string;
    statut_contenu: string | null;
    entite: { type: string } | null;
  },
  utilisateur?: UtilisateurIa,
): boolean {
  if (g.statut !== "terminee") return false;
  if (g.statut_contenu !== "brouillon_ia" && g.statut_contenu !== "modifie") return false;
  if (g.entite?.type === TYPE_ENTITE_REVUE) return false;
  if (utilisateur && !aPermission(utilisateur.roles, "ia.utiliser")) return false;
  return true;
}
