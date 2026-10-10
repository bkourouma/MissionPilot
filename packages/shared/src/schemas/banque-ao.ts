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
import { confirmationIdentiteSchema } from "./double-authentification";
import { termeSensibleSchema } from "./ia";

/*
 * Banques et offres des appels d'offres (lot AO-B : AO-04 à AO-07, PRD complémentaire §9).
 *
 * - CV structurés et datés (AO-04), gabarits de CV par bailleur en DONNÉES, contrôle des
 *   exigences par le moteur pur `packages/engines/src/banque-cv` ;
 * - références et attestations de bonne exécution (AO-05) ;
 * - offre technique (AO-06) : brouillon IA ou gabarit déterministe, toujours validé par un
 *   humain avant usage ;
 * - offre financière (AO-07) : calculée par `packages/engines/src/offre-financiere`, visible des
 *   seuls détenteurs de `finance.lire`.
 * Un appel d'offres est désigné par un identifiant facultatif SANS clé étrangère (lot AO-A).
 */

const limite = z.coerce.number().int().min(1).max(100).default(30);
const curseur = z.string().max(500).optional();
const recherche = z.string().trim().max(100).optional();
const identifiant = z.string().uuid();
const identifiantOptionnel = identifiant.nullable().optional();

// ---------------------------------------------------------------------------
// CV (AO-04)
// ---------------------------------------------------------------------------

export const NIVEAUX_DIPLOME_AO = ["bac", "bac_2", "bac_3", "bac_4", "bac_5", "doctorat"] as const;
export type NiveauDiplomeAo = (typeof NIVEAUX_DIPLOME_AO)[number];
export const LIBELLES_NIVEAU_DIPLOME: Record<NiveauDiplomeAo, string> = {
  bac: "Baccalauréat",
  bac_2: "Bac + 2",
  bac_3: "Bac + 3 (licence)",
  bac_4: "Bac + 4",
  bac_5: "Bac + 5 (master)",
  doctorat: "Doctorat",
};

export const NIVEAUX_LANGUE_AO = ["notions", "courant", "bilingue", "maternelle"] as const;
export type NiveauLangueAo = (typeof NIVEAUX_LANGUE_AO)[number];
export const LIBELLES_NIVEAU_LANGUE: Record<NiveauLangueAo, string> = {
  notions: "Notions",
  courant: "Courant",
  bilingue: "Bilingue",
  maternelle: "Langue maternelle",
};

/** Mois « AAAA-MM » (années 1950 à 2100). */
export const moisCvSchema = z
  .string()
  .regex(/^(19[5-9]\d|20\d\d|2100)-(0[1-9]|1[0-2])$/, "Mois au format AAAA-MM attendu.");

export const cvExperienceSchema = z
  .object({
    intitule: texte(200),
    employeur: texte(200),
    pays: paysSchema.nullable().optional(),
    debut: moisCvSchema,
    fin: moisCvSchema.nullable(),
    secteurs: listeLibelles(10, 80),
    bailleur: texteOptionnel(120),
    description: texteOptionnel(3000),
  })
  .strict()
  .refine((e) => e.fin === null || e.fin >= e.debut, {
    message: "La fin d'une expérience ne précède pas son début.",
    path: ["fin"],
  });
export type CvExperience = z.infer<typeof cvExperienceSchema>;

export const cvDiplomeSchema = z
  .object({
    intitule: texte(200),
    niveau: z.enum(NIVEAUX_DIPLOME_AO),
    domaine: texte(120),
    etablissement: texteOptionnel(200),
    annee: z.number().int().min(1950).max(2100),
  })
  .strict();

export const cvLangueSchema = z
  .object({ langue: texte(60), niveau: z.enum(NIVEAUX_LANGUE_AO) })
  .strict();

export const cvContenuSchema = z
  .object({
    titre: texte(200),
    nationalite: texteOptionnel(80),
    resume: texteOptionnel(4000),
    secteurs: listeLibelles(20, 80),
    competences: listeLibelles(50, 120),
    experiences: z.array(cvExperienceSchema).max(60),
    diplomes: z.array(cvDiplomeSchema).max(20),
    langues: z.array(cvLangueSchema).max(10),
  })
  .strict();
export type CvContenu = z.infer<typeof cvContenuSchema>;

/** POST /api/banque-ao/cv : profil (expert interne rattaché à un collaborateur, ou externe). */
export const cvCreationSchema = z
  .object({
    nom: texte(160),
    collaborateur_id: identifiantOptionnel,
    contenu: cvContenuSchema,
  })
  .strict();

/** POST /api/banque-ao/cv/:id/versions : nouvelle version datée, motif obligatoire. */
export const cvVersionSchema = z.object({ contenu: cvContenuSchema, motif: texte(500) }).strict();

/**
 * POST /api/banque-ao/cv/:id/anonymisation : effacement du parcours d'une personne (départ,
 * droit à l'effacement). IRRÉVERSIBLE : motif obligatoire et reconfirmation d'identité.
 */
export const cvAnonymisationSchema = z
  .object({
    motif: texte(500),
    confirmation: confirmationIdentiteSchema.default({}),
  })
  .strict();

export const cvListeQuerySchema = z
  .object({ limite, curseur, q: recherche, secteur: recherche, langue: recherche })
  .strict();

/** POST /api/banque-ao/cv/:id/controle : exigences d'un dossier d'appel d'offres. */
export const cvExigencesSchema = z
  .object({
    annees_min: z.number().int().min(0).max(60).optional(),
    annees_par_secteur: z
      .array(z.object({ secteur: texte(80), annees: z.number().int().min(0).max(60) }).strict())
      .max(10)
      .default([]),
    niveau_diplome_min: z.enum(NIVEAUX_DIPLOME_AO).optional(),
    domaines_diplome: listeLibelles(10, 120).default([]),
    langues: z
      .array(z.object({ langue: texte(60), niveau_min: z.enum(NIVEAUX_LANGUE_AO) }).strict())
      .max(10)
      .default([]),
    experiences_bailleur: z
      .array(
        z.object({ bailleur: texte(120), nombre_min: z.number().int().min(0).max(60) }).strict(),
      )
      .max(10)
      .default([]),
    /** Mois de référence (en général celui du dépôt) ; défaut : mois courant du serveur. */
    reference: moisCvSchema.optional(),
  })
  .strict();
export type CvExigences = z.infer<typeof cvExigencesSchema>;

// Gabarits de CV par bailleur (données, jamais du code).
export const SECTIONS_CV = [
  "identite",
  "resume",
  "formations",
  "langues",
  "experiences",
  "competences",
  "secteurs",
] as const;
export type SectionCv = (typeof SECTIONS_CV)[number];

export const gabaritCvSectionsSchema = z
  .array(z.object({ section: z.enum(SECTIONS_CV), titre: texte(120) }).strict())
  .min(1)
  .max(SECTIONS_CV.length)
  .refine((s) => new Set(s.map((x) => x.section)).size === s.length, {
    message: "Une section ne figure qu'une fois dans un gabarit.",
  });

export const gabaritCvCreationSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^[a-z0-9_]{1,40}$/, "Code : minuscules, chiffres et tiret bas."),
    libelle: texte(160),
    bailleur: texte(120),
    sections: gabaritCvSectionsSchema,
    ordre_experiences: z.enum(["antechronologique", "chronologique"]).default("antechronologique"),
    /** Seules les expériences des N dernières années (null : toutes). */
    experiences_annees_max: z.number().int().min(1).max(60).nullable().default(null),
  })
  .strict();

export const FORMATS_EXPORT_CV = ["docx", "pdf"] as const;
export const cvExportQuerySchema = z
  .object({
    gabarit: z
      .string()
      .trim()
      .regex(/^[a-z0-9_]{1,40}$/),
    format: z.enum(FORMATS_EXPORT_CV).default("docx"),
    reference: moisCvSchema.optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Références et attestations (AO-05)
// ---------------------------------------------------------------------------

export const ROLES_CABINET_REFERENCE = ["seul", "chef_de_file", "membre", "sous_traitant"] as const;
export const LIBELLES_ROLE_REFERENCE: Record<(typeof ROLES_CABINET_REFERENCE)[number], string> = {
  seul: "Cabinet seul",
  chef_de_file: "Chef de file d'un groupement",
  membre: "Membre d'un groupement",
  sous_traitant: "Sous-traitant",
};

export const referenceContenuSchema = z
  .object({
    titre: texte(300),
    client_nom: texte(200),
    client_id: identifiantOptionnel,
    mission_id: identifiantOptionnel,
    pays: paysSchema,
    secteurs: listeLibelles(10, 80),
    bailleur: texteOptionnel(120),
    montant: montantSchema,
    devise: deviseSchema,
    date_debut: dateIsoSchema,
    date_fin: dateIsoSchema.nullable(),
    role_cabinet: z.enum(ROLES_CABINET_REFERENCE),
    description: texteOptionnel(4000),
  })
  .strict()
  .refine((r) => r.date_fin === null || r.date_fin >= r.date_debut, {
    message: "La fin d'une référence ne précède pas son début.",
    path: ["date_fin"],
  });
export type ReferenceContenu = z.infer<typeof referenceContenuSchema>;

export const referenceVersionSchema = z
  .object({ contenu: referenceContenuSchema, motif: texte(500) })
  .strict();

const montantFiltre = z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional();

/** GET /api/banque-ao/references : un filtre de montant exige la devise (pas de change implicite). */
export const referencesQuerySchema = z
  .object({
    limite,
    curseur,
    q: recherche,
    secteur: recherche,
    pays: paysSchema.optional(),
    bailleur: recherche,
    devise: deviseSchema.optional(),
    montant_min: montantFiltre,
    montant_max: montantFiltre,
  })
  .strict()
  .refine((q) => (q.montant_min === undefined && q.montant_max === undefined) || q.devise, {
    message: "Un filtre de montant exige la devise.",
    path: ["devise"],
  });

export const TYPES_ATTESTATION = [
  "attestation_bonne_execution",
  "proces_verbal_reception",
  "contrat",
  "autre",
] as const;
export const LIBELLES_TYPE_ATTESTATION: Record<(typeof TYPES_ATTESTATION)[number], string> = {
  attestation_bonne_execution: "Attestation de bonne exécution",
  proces_verbal_reception: "Procès-verbal de réception",
  contrat: "Contrat",
  autre: "Autre pièce",
};

export const attestationCreationSchema = z
  .object({
    fichier_id: identifiant,
    type: z.enum(TYPES_ATTESTATION),
    date_attestation: dateIsoSchema,
    emetteur: texte(200),
  })
  .strict();

export const attestationRetraitSchema = z.object({ motif: texte(500) }).strict();

// ---------------------------------------------------------------------------
// Offre technique (AO-06)
// ---------------------------------------------------------------------------

export const SECTIONS_OFFRE_TECHNIQUE = [
  "comprehension",
  "methodologie",
  "planning",
  "organisation",
] as const;
export type SectionOffreTechnique = (typeof SECTIONS_OFFRE_TECHNIQUE)[number];
export const LIBELLES_SECTION_OFFRE: Record<SectionOffreTechnique, string> = {
  comprehension: "Compréhension des termes de référence",
  methodologie: "Méthodologie",
  planning: "Planning",
  organisation: "Organisation et équipe",
};

export const offreTechniqueSectionsSchema = z
  .object({
    comprehension: texte(20000),
    methodologie: texte(20000),
    planning: texte(20000),
    organisation: texte(20000),
  })
  .strict();
export type OffreTechniqueSections = z.infer<typeof offreTechniqueSectionsSchema>;

export const offreTechniqueContexteSchema = z
  .object({
    client: texte(200),
    pays: paysSchema.nullable().optional(),
    secteur: texteOptionnel(120),
    bailleur: texteOptionnel(120),
    objectifs: texteOptionnel(4000),
    termes_reference: texte(20000),
  })
  .strict();

export const offreTechniqueCreationSchema = z
  .object({
    titre: texte(300),
    appel_offres_id: identifiantOptionnel,
    methode_version_id: identifiantOptionnel,
    contexte: offreTechniqueContexteSchema,
    cv_ids: z.array(identifiant).max(30).default([]),
    /** « ia » : brouillon par l'orchestrateur (repli déterministe) ; « gabarit » : code seul. */
    generation: z.enum(["ia", "gabarit"]).default("gabarit"),
    termes_sensibles: z.array(termeSensibleSchema).max(200).default([]),
  })
  .strict();
export type OffreTechniqueCreation = z.infer<typeof offreTechniqueCreationSchema>;

export const offreTechniqueVersionSchema = z
  .object({ sections: offreTechniqueSectionsSchema, motif: texte(500) })
  .strict();

/** Validation d'une version : `acquitte_chiffres` si le brouillon IA cite des nombres non vérifiés. */
export const offreTechniqueValidationSchema = z
  .object({
    version: z.number().int().min(1).max(10000),
    acquitte_chiffres: z.boolean().optional(),
  })
  .strict();

export const offresQuerySchema = z
  .object({ limite, curseur, appel_offres_id: identifiant.optional() })
  .strict();

// ---------------------------------------------------------------------------
// Offre financière (AO-07) : entrées du moteur ; les montants sont calculés par lui.
// ---------------------------------------------------------------------------

const quantite = z.number().min(0).max(100_000);

export const offreFinanciereEntreeSchema = z
  .object({
    devise: deviseSchema,
    honoraires: z
      .array(
        z
          .object({
            cle: texte(80),
            libelle: texte(200),
            jours: quantite,
            taux_journalier: montantSchema,
            cv_id: identifiantOptionnel,
          })
          .strict(),
      )
      .max(200)
      .default([]),
    per_diem: z
      .array(z.object({ libelle: texte(200), quantite, prix_unitaire: montantSchema }).strict())
      .max(200)
      .default([]),
    debours: z
      .array(z.object({ libelle: texte(200), quantite, prix_unitaire: montantSchema }).strict())
      .max(200)
      .default([]),
    taxes: z
      .array(
        z
          .object({
            libelle: texte(120),
            taux: z.number().min(0).max(100),
            assiette: z.enum(["honoraires", "total_ht"]),
          })
          .strict(),
      )
      .max(10)
      .default([]),
    conversion: z
      .object({
        devise_cible: deviseSchema,
        taux: z.number().positive().max(1_000_000),
        date_fixation: dateIsoSchema,
      })
      .strict()
      .nullable()
      .default(null),
  })
  .strict();
export type OffreFinanciereEntree = z.infer<typeof offreFinanciereEntreeSchema>;

export const offreFinanciereCreationSchema = z
  .object({
    titre: texte(300),
    appel_offres_id: identifiantOptionnel,
    entree: offreFinanciereEntreeSchema,
  })
  .strict();

export const offreFinanciereVersionSchema = z
  .object({ entree: offreFinanciereEntreeSchema, motif: texte(500) })
  .strict();
