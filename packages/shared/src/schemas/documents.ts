import { z } from "zod";
import { auMoinsUnChamp, dateIsoSchema, MESSAGE_CORPS_VIDE } from "./commun";
import { documentCreationSchema } from "./missions";

/*
 * Fichiers de mission, versions de documents, statut des contenus
 * (SOC-05, SOC-06), justificatifs de débours (FIN-05), commentaires et tâches
 * assignées (SOC-08).
 *
 * Le binaire d'un fichier n'est jamais dans un corps JSON : il est téléversé
 * en multipart (champ « fichier ») et l'API renvoie ses métadonnées. Le type
 * est détecté par l'API à partir du CONTENU (signature) ; le nom est assaini.
 */

/* ----- Fichiers ----- */

/** Types acceptés (liste blanche), détectés par signature du contenu. */
export const TYPES_FICHIER = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/csv",
  "text/plain",
] as const;
export type TypeFichier = (typeof TYPES_FICHIER)[number];

/** Extensions admises par type : l'extension du nom doit correspondre au contenu. */
export const EXTENSIONS_FICHIER: Record<TypeFichier, readonly string[]> = {
  "application/pdf": ["pdf"],
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/webp": ["webp"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["xlsx"],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ["pptx"],
  "text/csv": ["csv"],
  "text/plain": ["txt"],
};

/** Types affichables dans le navigateur (`affichage=inline`) ; les autres sont toujours téléchargés. */
export const TYPES_FICHIER_EN_LIGNE: readonly TypeFichier[] = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
];

/** Plafond par fichier par défaut (15 Mo), paramétrable côté API. */
export const TAILLE_FICHIER_MAX_DEFAUT = 15 * 1024 * 1024;

/** Nom du champ multipart qui porte le fichier. */
export const CHAMP_FICHIER = "fichier";

export const fichierTelechargementQuerySchema = z
  .object({ affichage: z.enum(["inline", "attachment"]).optional() })
  .strict();

/* ----- Documents de mission : versions et statut du contenu ----- */

/** Statut d'un contenu produit par l'IA (SOC-06) : null = document déposé hors circuit IA. */
export const STATUTS_CONTENU = ["brouillon_ia", "modifie", "valide"] as const;
export type StatutContenu = (typeof STATUTS_CONTENU)[number];

/**
 * Dépôt d'une version de document : le contrat existant (type, nom,
 * chemin_stockage) plus un fichier téléversé (`fichier_id`) et, pour un
 * contenu généré, le statut initial « brouillon_ia ». Fichier et chemin
 * s'excluent.
 */
export const documentDepotSchema = documentCreationSchema
  .extend({
    fichier_id: z.string().uuid().optional(),
    statut_contenu: z.literal("brouillon_ia").optional(),
  })
  .strict()
  .refine(
    (d) => !(d.fichier_id && d.chemin_stockage),
    "Un document désigne un fichier téléversé OU un chemin, pas les deux.",
  );

/** Transition du statut d'un contenu : modifié (relu et corrigé) ou validé. */
export const documentStatutSchema = z.object({ statut: z.enum(["modifie", "valide"]) }).strict();

/* ----- Entités commentables et liables à une tâche ----- */

export const TYPES_ENTITE_COLLABORATION = [
  "mission",
  "mission_tache",
  "facture",
  "debours",
  "opportunite",
  "proposition",
] as const;
export type TypeEntiteCollaboration = (typeof TYPES_ENTITE_COLLABORATION)[number];

const entiteType = z.enum(TYPES_ENTITE_COLLABORATION);
const uuid = z.string().uuid();
const curseurSchema = z.string().max(500).optional();

/** Caractères de contrôle refusés (hors tabulation et sauts de ligne). */
// eslint-disable-next-line no-control-regex
const CONTROLES = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/** Texte brut borné, sans caractère de contrôle ; jamais interprété comme HTML. */
const texteBrut = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((t) => !CONTROLES.test(t), "Caractère de contrôle refusé.");

export const TAILLE_COMMENTAIRE_MAX = 5000;
/** Fenêtre de modification d'un commentaire par son auteur. */
export const DELAI_MODIFICATION_COMMENTAIRE_MINUTES = 15;
export const MENTIONS_MAX = 20;

/* ----- Commentaires (SOC-08) ----- */

export const commentaireCreationSchema = z
  .object({
    entite_type: entiteType,
    entite_id: uuid,
    texte: texteBrut(TAILLE_COMMENTAIRE_MAX),
    /** Utilisateurs mentionnés (@nom dans le texte) : identifiants du même cabinet. */
    mentions: z
      .array(uuid)
      .max(MENTIONS_MAX)
      .default([])
      .transform((l) => [...new Set(l)]),
  })
  .strict();

export const commentaireModificationSchema = z
  .object({ texte: texteBrut(TAILLE_COMMENTAIRE_MAX) })
  .strict();

export const commentairesQuerySchema = z
  .object({
    entite_type: entiteType,
    entite_id: uuid,
    limite: z.coerce.number().int().min(1).max(100).default(50),
    curseur: curseurSchema,
  })
  .strict();

export const mentionnablesQuerySchema = z
  .object({
    entite_type: entiteType,
    entite_id: uuid,
    q: z.string().trim().max(100).optional(),
  })
  .strict();

/* ----- Tâches assignées (SOC-08) ----- */

export const STATUTS_TACHE_COLLABORATION = ["a_faire", "en_cours", "fait"] as const;
export type StatutTacheCollaboration = (typeof STATUTS_TACHE_COLLABORATION)[number];

export const ECHEANCE_MIN = "2000-01-01";
export const ECHEANCE_MAX = "2100-12-31";
const echeanceSchema = dateIsoSchema.refine(
  (v) => v >= ECHEANCE_MIN && v <= ECHEANCE_MAX,
  "Échéance hors de la plage autorisée (années 2000 à 2100).",
);

export const tacheCollaborationCreationSchema = z
  .object({
    titre: texteBrut(200),
    description: z
      .string()
      .trim()
      .max(5000)
      .refine((t) => !CONTROLES.test(t), "Caractère de contrôle refusé.")
      .default(""),
    assignee_id: uuid,
    echeance: echeanceSchema.nullable().default(null),
    entite_type: entiteType.optional(),
    entite_id: uuid.optional(),
  })
  .strict()
  .refine(
    (t) => (t.entite_type === undefined) === (t.entite_id === undefined),
    "Une entité liée se désigne par son type ET son identifiant.",
  );

/** Le créateur modifie tout ; l'assigné ne modifie que le statut (contrôlé par l'API). */
export const tacheCollaborationModificationSchema = z
  .object({
    titre: texteBrut(200),
    description: z
      .string()
      .trim()
      .max(5000)
      .refine((t) => !CONTROLES.test(t), "Caractère de contrôle refusé."),
    assignee_id: uuid,
    echeance: echeanceSchema.nullable(),
    statut: z.enum(STATUTS_TACHE_COLLABORATION),
  })
  .partial()
  .strict()
  .refine(auMoinsUnChamp, MESSAGE_CORPS_VIDE);

export const tachesCollaborationQuerySchema = z
  .object({
    /** « assignees » (défaut) : mes tâches ; « creees » : celles que j'ai assignées. */
    vue: z.enum(["assignees", "creees"]).default("assignees"),
    statut: z.enum(STATUTS_TACHE_COLLABORATION).optional(),
    limite: z.coerce.number().int().min(1).max(100).default(30),
    curseur: curseurSchema,
  })
  .strict();

export type DocumentDepot = z.infer<typeof documentDepotSchema>;
export type CommentaireCreation = z.infer<typeof commentaireCreationSchema>;
export type TacheCollaborationCreation = z.infer<typeof tacheCollaborationCreationSchema>;
export type TacheCollaborationModification = z.infer<typeof tacheCollaborationModificationSchema>;
