import { z } from "zod";
import { texte } from "./commun";
import type { StatutContenu } from "./documents";
import { termeSensibleSchema } from "./ia";
import { RED_DOMAINES, type RedDomaine, type RedPersonne } from "./redressement";

/*
 * RED-04 : cartographie des causes racines PROPOSÉE PAR L'IA (lot 2). Contrat des routes
 * /api/redressement/dossiers/:id/causes et /api/redressement/causes/:id, et des types de réponse.
 *
 * - L'IA propose (« brouillon_ia »), un consultant modifie (« modifie ») puis valide (« valide ») :
 *   seule une cartographie VALIDÉE est exploitable dans un livrable. L'historique est en ajout seul.
 * - Aucun chiffre ne vient du modèle : le niveau de confiance d'une cause est un libellé fixe, et
 *   les nombres cités par une proposition sont contrôlés contre les sorties des moteurs.
 * - Les bornes ci-dessous DUPLIQUENT celles de `packages/engines/src/redressement/causes.ts`
 *   (parité vérifiée par `redressement-causes.test.ts` de l'API).
 * - Aucune qualification juridique dans les libellés.
 */

export const RED_CAUSES_MAX = 12;
export const RED_CAUSE_LIBELLE_MAX = 120;
export const RED_CAUSE_DESCRIPTION_MAX = 1000;
/** Cartographies (versions) au plus par dossier. */
export const RED_CAUSES_VERSIONS_MAX = 30;
/** Texte libre facultatif du consultant, transmis au modèle comme donnée non fiable. */
export const RED_CAUSES_CONTEXTE_MAX = 2000;
export const RED_CAUSES_TERMES_SENSIBLES_MAX = 200;

export const RED_NIVEAUX_CONFIANCE_CAUSE = ["faible", "moyen", "eleve"] as const;
export type RedNiveauConfianceCause = (typeof RED_NIVEAUX_CONFIANCE_CAUSE)[number];
export const RED_NIVEAU_CONFIANCE_CAUSE_LIBELLES: Record<RedNiveauConfianceCause, string> = {
  faible: "Confiance faible",
  moyen: "Confiance moyenne",
  eleve: "Confiance élevée",
};

/** Statut de la cartographie (colonne `statut`). */
export const RED_STATUTS_CAUSES = ["brouillon", "valide"] as const;
export type RedStatutCauses = (typeof RED_STATUTS_CAUSES)[number];
/** Statut du contenu (dernier rang de l'historique) : brouillon IA, modifié ou validé. */
export const RED_STATUTS_CONTENU_CAUSES = ["brouillon_ia", "modifie", "valide"] as const;
export const RED_STATUT_CONTENU_CAUSES_LIBELLES: Record<StatutContenu, string> = {
  brouillon_ia: "Brouillon IA",
  modifie: "Modifié",
  valide: "Validé",
};

/* ----- Entrées ----- */

export const redCauseSchema = z
  .object({
    /** Absent : attribué par le serveur (le plus petit « cNN » libre). */
    id: z
      .string()
      .regex(/^c\d{2}$/, "Identifiant « cNN » attendu.")
      .optional(),
    domaine: z.enum(RED_DOMAINES),
    libelle: texte(RED_CAUSE_LIBELLE_MAX),
    description: texte(RED_CAUSE_DESCRIPTION_MAX),
    /** Absent ou nul : aucune confiance indiquée (la réponse rend `null`, qu'on peut renvoyer tel quel). */
    confiance: z.enum(RED_NIVEAUX_CONFIANCE_CAUSE).nullable().optional(),
  })
  .strict();
export type RedCauseEntree = z.infer<typeof redCauseSchema>;

/** POST /api/redressement/dossiers/:id/causes/generation. */
export const redCausesGenerationSchema = z
  .object({
    contexte: texte(RED_CAUSES_CONTEXTE_MAX).optional(),
    termes_sensibles: z.array(termeSensibleSchema).max(RED_CAUSES_TERMES_SENSIBLES_MAX).default([]),
  })
  .strict();
export type RedCausesGeneration = z.infer<typeof redCausesGenerationSchema>;

/** PATCH /api/redressement/causes/:id : la cartographie complète remplace la précédente. */
export const redCausesModificationSchema = z
  .object({ causes: z.array(redCauseSchema).min(1).max(RED_CAUSES_MAX) })
  .strict();
export type RedCausesModification = z.infer<typeof redCausesModificationSchema>;

/** POST /api/redressement/causes/:id/validation. */
export const redCausesValidationSchema = z
  .object({ acquitte_chiffres: z.boolean().optional() })
  .strict();
export type RedCausesValidation = z.infer<typeof redCausesValidationSchema>;

/* ----- Réponses ----- */

export interface RedCauseVue {
  id: string;
  domaine: RedDomaine;
  libelle: string;
  description: string;
  confiance: RedNiveauConfianceCause | null;
}

export interface RedCausesRangVue {
  rang: number;
  statut_contenu: StatutContenu;
  auteur: RedPersonne;
  chiffres_non_verifies: boolean;
  chiffres_acquittes: boolean;
  cree_le: string;
}

export interface RedCausesVersionVue {
  id: string;
  dossier_id: string;
  version: number;
  /** Colonne `statut` : « valide » = exploitable dans un livrable. */
  statut: RedStatutCauses;
  /** Dernier rang de l'historique : brouillon IA, modifié ou validé. */
  statut_contenu: StatutContenu;
  /** Seule une cartographie validée peut figurer dans un livrable. */
  exploitable_livrable: boolean;
  /** Fabriquée par le repli déterministe (IA indisponible ou sortie inexploitable). */
  gabarit: boolean;
  chiffres_non_verifies: boolean;
  /** Nombres de la proposition qui ne viennent pas d'un moteur : à vérifier puis acquitter. */
  nombres_non_verifies: string[];
  chiffres_acquittes: boolean;
  causes: RedCauseVue[];
  demande_id: string;
  cree_par: RedPersonne;
  cree_le: string;
  modifie_le: string;
  valide_par: RedPersonne | null;
  valide_le: string | null;
  historique: RedCausesRangVue[];
}

export interface RedCausesListeVue {
  /** Plus récente d'abord. */
  elements: RedCausesVersionVue[];
}
