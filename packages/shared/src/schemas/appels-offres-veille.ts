import { z } from "zod";
import {
  dateIsoSchema,
  deviseSchema,
  listeLibelles,
  montantSchema,
  paysSchema,
  texte,
  texteOptionnel,
} from "./commun";

/*
 * Veille multi-sources des appels d'offres (AO-01, PRD complémentaire §9) : contrat des routes
 * /api/appels-offres/veille/**. Les scores et les raisons du rapprochement ne sont JAMAIS reçus :
 * ils sortent du moteur (packages/engines/src/appels-offres/veille.ts). Lecture : `ao.lire` ;
 * collecte, import, décisions et création de fiche : `ao.gerer`. Aucune donnée FIN-02.
 */

/** Plafonds (déni de service) : doublés par le moteur et par la base. */
export const VEILLE_IMPORT_TEXTE_MAX = 1_048_576;
export const VEILLE_IMPORT_AVIS_MAX = 200;
export const VEILLE_RESULTATS_MAX = 5_000;
export const VEILLE_MOTIF_MIN = 10;
export const VEILLE_PAGE_MAX = 200;

export const VEILLE_STATUTS = ["nouveau", "retenu", "ecarte", "fiche_creee"] as const;
export type VeilleStatut = (typeof VEILLE_STATUTS)[number];
export const veilleStatutSchema = z.enum(VEILLE_STATUTS);
export const VEILLE_STATUT_LIBELLES: Record<VeilleStatut, string> = {
  nouveau: "Nouveau",
  retenu: "Retenu",
  ecarte: "Écarté",
  fiche_creee: "Fiche créée",
};

export const VEILLE_DECISIONS = ["retenir", "ecarter", "reexaminer", "creer_fiche"] as const;
export type VeilleDecision = (typeof VEILLE_DECISIONS)[number];
export const VEILLE_DECISION_LIBELLES: Record<VeilleDecision, string> = {
  retenir: "Retenu",
  ecarter: "Écarté",
  reexaminer: "Réexaminé",
  creer_fiche: "Fiche créée",
};

export const VEILLE_FORMATS = ["auto", "csv", "json"] as const;

const urlAvis = z
  .string()
  .trim()
  .max(500)
  .url("Adresse invalide.")
  .refine((u) => /^https?:\/\/[^\s<>"]+$/i.test(u), "Adresse http ou https attendue.");

/** Saisie manuelle d'un avis (sans responsable ni statut : ce n'est pas encore une fiche). */
export const veilleAvisSaisieSchema = z
  .object({
    reference: texteOptionnel(80),
    titre: texte(300),
    objet: texteOptionnel(4000),
    bailleur: texteOptionnel(150),
    pays: paysSchema.nullable().optional(),
    secteur: texteOptionnel(120),
    montant_estime: montantSchema.nullable().optional(),
    devise: deviseSchema.optional(),
    date_publication: dateIsoSchema.nullable().optional(),
    date_limite: dateIsoSchema.nullable().optional(),
    url: z.preprocess((v) => (v === "" ? null : v), urlAvis.nullable().optional()),
    mots_cles: listeLibelles(30, 80).optional(),
  })
  .strict();
export type VeilleAvisSaisie = z.infer<typeof veilleAvisSaisieSchema>;

/** Import d'un fichier CSV ou JSON : la page poste le TEXTE lu côté navigateur. */
export const veilleImportSchema = z
  .object({
    texte: z.string().min(1).max(VEILLE_IMPORT_TEXTE_MAX),
    format: z.enum(VEILLE_FORMATS).default("auto"),
  })
  .strict();
export type VeilleImport = z.infer<typeof veilleImportSchema>;

export const veilleSourceActivationSchema = z.object({ active: z.boolean() }).strict();

export const veilleCollecteSchema = z
  .object({
    sources: z
      .array(z.string().regex(/^[a-z0-9_]{1,40}$/))
      .max(10)
      .optional(),
  })
  .strict();

/** Motif d'un écartement ou d'un réexamen (10 caractères au moins). */
export const veilleMotifSchema = z
  .object({ motif: z.string().trim().min(VEILLE_MOTIF_MIN).max(2000) })
  .strict();

/** Motif facultatif (retenir). */
export const veilleMotifOptionnelSchema = z
  .object({ motif: z.string().trim().min(VEILLE_MOTIF_MIN).max(2000).optional() })
  .strict();

export const veilleResultatsQuerySchema = z
  .object({
    statut: veilleStatutSchema.optional(),
    q: z.string().trim().max(100).optional(),
    score_min: z.coerce.number().int().min(0).max(100).optional(),
    limite: z.coerce.number().int().min(1).max(VEILLE_PAGE_MAX).default(50),
    decalage: z.coerce.number().int().min(0).max(VEILLE_RESULTATS_MAX).default(0),
  })
  .strict();
export type VeilleResultatsQuery = z.infer<typeof veilleResultatsQuerySchema>;
