import { z } from "zod";
import { dateIsoSchema, deviseSchema, texte, texteOptionnel } from "./commun";
import {
  codeReferentielSchema,
  fiabilitePreuveSchema,
  typeFacteurContexteSchema,
  typeSourcePreuveSchema,
  valeurFacteurContexteSchema,
  type TypeFacteurContexte,
  type ValeurFacteurContexte,
} from "./fondations";

/*
 * Dossier client vivant (DOS-01 à DOS-07, PRD complémentaire §5) : faits datés et sourcés,
 * facteurs de contexte du client (STD-04), états financiers ingérés et contrôlés par le moteur
 * (`packages/engines/src/dossier`), indice de fiabilité, frise, export. Les bornes des états
 * financiers reprennent celles du moteur (LIGNES_ETAT_MAX…).
 */

// ---------------------------------------------------------------------------
// Faits (DOS-01, DOS-02)
// ---------------------------------------------------------------------------

export const CATEGORIES_FAIT_DOSSIER = [
  "profil",
  "organisation",
  "processus",
  "produits_marches",
  "finances",
  "risques",
  "parties_prenantes",
] as const;
export type CategorieFaitDossier = (typeof CATEGORIES_FAIT_DOSSIER)[number];
export const categorieFaitDossierSchema = z.enum(CATEGORIES_FAIT_DOSSIER);

export const CATEGORIE_FAIT_LIBELLES: Record<CategorieFaitDossier, string> = {
  profil: "Profil",
  organisation: "Organisation",
  processus: "Processus",
  produits_marches: "Produits et marchés",
  finances: "Finances",
  risques: "Risques",
  parties_prenantes: "Parties prenantes",
};

/** Statut DÉRIVÉ d'un fait : proposé, confirmé, rejeté, ou remplacé par un fait plus récent. */
export const STATUTS_FAIT_DOSSIER = ["propose", "confirme", "rejete", "remplace"] as const;
export type StatutFaitDossier = (typeof STATUTS_FAIT_DOSSIER)[number];

/** Origine : saisie par un membre du cabinet, ou extraite par l'IA d'un document (toujours proposée). */
export const ORIGINES_FAIT_DOSSIER = ["saisie", "ia"] as const;
export type OrigineFaitDossier = (typeof ORIGINES_FAIT_DOSSIER)[number];

/** Plafonds de volume par client (export borné, déni de service). */
export const FAITS_PAR_CLIENT_MAX = 5000;
export const FACTEURS_PAR_CLIENT_MAX = 2000;
export const ETATS_PAR_CLIENT_MAX = 60;
/** Valeur absolue maximale d'un nombre ou d'un montant de fait. */
export const VALEUR_FAIT_MAX = 1_000_000_000_000_000;

const dateEffetSchema = dateIsoSchema.refine(
  (d) => d >= "1900-01-01" && d <= "2100-12-31",
  "Date entre 1900 et 2100 attendue.",
);

export const valeurFaitSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("texte"), texte: texte(2000) }).strict(),
  z
    .object({
      type: z.literal("nombre"),
      nombre: z.number().finite().min(-VALEUR_FAIT_MAX).max(VALEUR_FAIT_MAX),
    })
    .strict(),
  z
    .object({
      type: z.literal("montant"),
      montant: z.number().int().min(-VALEUR_FAIT_MAX).max(VALEUR_FAIT_MAX),
      devise: deviseSchema,
    })
    .strict(),
  z.object({ type: z.literal("date"), date: dateIsoSchema }).strict(),
  z.object({ type: z.literal("booleen"), booleen: z.boolean() }).strict(),
]);
export type ValeurFaitDossier = z.infer<typeof valeurFaitSchema>;
export type TypeValeurFaitDossier = ValeurFaitDossier["type"];

/** Source d'un fait ou d'une valeur : type, libellé, document et page éventuels (DOS-02). */
export const sourceDossierSchema = z
  .object({
    type: typeSourcePreuveSchema,
    libelle: texte(300),
    document_id: z.string().uuid().nullable().optional(),
    page: z.number().int().min(1).max(100_000).nullable().optional(),
    reference: texteOptionnel(120),
  })
  .strict()
  .refine(
    (s) => s.type === "document" || ((s.document_id ?? null) === null && (s.page ?? null) === null),
    "Document et page seulement pour une source de type document.",
  );
export type SourceDossier = z.infer<typeof sourceDossierSchema>;

export const faitCreationSchema = z
  .object({
    categorie: categorieFaitDossierSchema,
    cle: codeReferentielSchema,
    valeur: valeurFaitSchema,
    date_effet: dateEffetSchema,
    source: sourceDossierSchema,
    fiabilite: fiabilitePreuveSchema,
    /** « confirme » : l'auteur atteste le fait ; « propose » : à confirmer par un autre. */
    statut: z.enum(["propose", "confirme"]).default("propose"),
    remplace_id: z.string().uuid().optional(),
    commentaire: texteOptionnel(2000),
  })
  .strict();
export type FaitCreation = z.infer<typeof faitCreationSchema>;

export const faitDecisionSchema = z
  .object({
    decision: z.enum(["confirme", "rejete"]),
    motif: texteOptionnel(2000),
  })
  .strict()
  .refine((d) => d.decision !== "rejete" || Boolean(d.motif), {
    message: "Motif obligatoire pour rejeter un fait.",
    path: ["motif"],
  });
export type FaitDecision = z.infer<typeof faitDecisionSchema>;

export const faitsQuerySchema = z
  .object({
    categorie: categorieFaitDossierSchema.optional(),
    /** « courants » : ni remplacés ni rejetés ; « tous » : historique complet. */
    vue: z.enum(["courants", "propositions", "tous"]).default("courants"),
  })
  .strict();

// ---------------------------------------------------------------------------
// Facteurs de contexte du client (STD-04)
// ---------------------------------------------------------------------------

/**
 * Facteurs lus par l'indice de fiabilité (DOS-04, PRD §4.3) : codes et valeurs de convention,
 * à reprendre tels quels par le référentiel de méthodes (lot STD).
 */
export const FACTEUR_FIABILITE_COMPTES = "fiabilite_comptes";
export const FACTEUR_PART_INFORMEL = "part_informel";
export const VALEURS_FACTEURS_FIABILITE: Readonly<Record<string, readonly string[]>> = {
  [FACTEUR_FIABILITE_COMPTES]: ["certifies", "non_certifies", "reconstitues"],
  [FACTEUR_PART_INFORMEL]: ["faible", "moyenne", "forte"],
};

/** La valeur a la forme du type déclaré (booléen, nombre, code, liste de codes). */
export function valeurFacteurConforme(
  type: TypeFacteurContexte,
  valeur: ValeurFacteurContexte,
): boolean {
  if (type === "booleen") return typeof valeur === "boolean";
  if (type === "nombre") return typeof valeur === "number";
  if (type === "enumeration") return typeof valeur === "string";
  return Array.isArray(valeur) && new Set(valeur).size === valeur.length;
}

export const facteurValeurCreationSchema = z
  .object({
    code: codeReferentielSchema,
    type: typeFacteurContexteSchema,
    valeur: valeurFacteurContexteSchema,
    date_effet: dateEffetSchema,
    source: sourceDossierSchema,
    fiabilite: fiabilitePreuveSchema,
  })
  .strict()
  .superRefine((f, ctx) => {
    if (!valeurFacteurConforme(f.type, f.valeur)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["valeur"],
        message: "Valeur incompatible avec le type du facteur.",
      });
      return;
    }
    // Propriété PROPRE seulement : un code « constructor » ne lit pas le prototype.
    const permises = Object.hasOwn(VALEURS_FACTEURS_FIABILITE, f.code)
      ? VALEURS_FACTEURS_FIABILITE[f.code]
      : undefined;
    if (permises && (f.type !== "enumeration" || !permises.includes(f.valeur as string))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["valeur"],
        message: `Valeur attendue : ${permises.join(", ")}.`,
      });
    }
  });
export type FacteurValeurCreation = z.infer<typeof facteurValeurCreationSchema>;

// ---------------------------------------------------------------------------
// États financiers (DOS-03)
// ---------------------------------------------------------------------------

export const SECTIONS_ETAT_FINANCIER_DOSSIER = [
  "actif",
  "passif",
  "charges",
  "produits",
  "resultat",
] as const;
export type SectionEtatDossier = (typeof SECTIONS_ETAT_FINANCIER_DOSSIER)[number];

export const SECTION_ETAT_LIBELLES: Record<SectionEtatDossier, string> = {
  actif: "Actif",
  passif: "Passif",
  charges: "Charges",
  produits: "Produits",
  resultat: "Résultat net déclaré",
};

export const ROLES_LIGNE_ETAT_DOSSIER = ["total", "resultat_exercice", "resultat_net"] as const;
export type RoleLigneEtatDossier = (typeof ROLES_LIGNE_ETAT_DOSSIER)[number];

/** Bornes (identiques au moteur `controlerEtatFinancier`). */
export const LIGNES_ETAT_FINANCIER_MAX = 1000;
export const MONTANT_LIGNE_ETAT_DOSSIER_MAX = 1_000_000_000_000_000;
/** Tolérance des contrôles en unités mineures (montants publiés arrondis au millier…). */
export const TOLERANCE_ETAT_DOSSIER_MAX = 1_000_000;
export const IMPORT_ETAT_CSV_CARACTERES_MAX = 200_000;

/** Colonnes du fichier d'import (en-tête sans accent ni casse imposés). */
export const IMPORT_ETAT_COLONNES = ["section", "code", "libelle", "montant"] as const;
export const IMPORT_ETAT_COLONNES_FACULTATIVES = ["parent", "role"] as const;

/** Statut DÉRIVÉ d'un état : en revue, accepté (contrôles passés ou décision), rejeté, remplacé. */
export const STATUTS_ETAT_DOSSIER = ["en_revue", "accepte", "rejete", "remplace"] as const;
export type StatutEtatDossier = (typeof STATUTS_ETAT_DOSSIER)[number];

const codeLigneEtatSchema = z
  .string()
  .regex(/^[A-Za-z0-9_.-]{1,40}$/, "Code de poste : lettres, chiffres, « _ », « . », « - ».");

/** Référence de la valeur dans sa source : fichier, feuille, cellule, ligne ou page. */
export const referenceValeurSchema = z
  .object({
    fichier: texteOptionnel(200),
    feuille: texteOptionnel(100),
    cellule: z
      .string()
      .regex(/^[A-Z]{1,3}[1-9][0-9]{0,6}$/, "Cellule au format A1.")
      .nullable()
      .optional(),
    ligne: z.number().int().min(1).max(1_000_000).nullable().optional(),
    page: z.number().int().min(1).max(100_000).nullable().optional(),
  })
  .strict();
export type ReferenceValeur = z.infer<typeof referenceValeurSchema>;

export const ligneEtatFinancierSchema = z
  .object({
    code: codeLigneEtatSchema,
    libelle: texte(200),
    section: z.enum(SECTIONS_ETAT_FINANCIER_DOSSIER),
    montant: z
      .number()
      .int()
      .min(-MONTANT_LIGNE_ETAT_DOSSIER_MAX)
      .max(MONTANT_LIGNE_ETAT_DOSSIER_MAX),
    parent: codeLigneEtatSchema.nullable().optional(),
    role: z.enum(ROLES_LIGNE_ETAT_DOSSIER).nullable().optional(),
    reference: referenceValeurSchema.optional(),
  })
  .strict();
export type LigneEtatFinancierSaisie = z.infer<typeof ligneEtatFinancierSchema>;

const enTeteEtat = {
  exercice: z.number().int().min(1990).max(2100),
  date_cloture: dateIsoSchema,
  devise: deviseSchema,
  tolerance: z.number().int().min(0).max(TOLERANCE_ETAT_DOSSIER_MAX).default(0),
  source_libelle: texteOptionnel(300),
};

export const etatFinancierSaisieSchema = z
  .object({
    ...enTeteEtat,
    lignes: z.array(ligneEtatFinancierSchema).min(1).max(LIGNES_ETAT_FINANCIER_MAX),
  })
  .strict();
export type EtatFinancierSaisie = z.infer<typeof etatFinancierSaisieSchema>;

export const etatFinancierCsvSchema = z
  .object({
    ...enTeteEtat,
    csv: z.string().min(1).max(IMPORT_ETAT_CSV_CARACTERES_MAX),
    nom_fichier: texteOptionnel(200),
  })
  .strict();
export type EtatFinancierCsv = z.infer<typeof etatFinancierCsvSchema>;

const entierTexte = (min: number, max: number) =>
  z
    .string()
    .regex(/^\d{1,10}$/, "Entier attendu.")
    .transform(Number)
    .pipe(z.number().int().min(min).max(max));

/** En-tête d'un import Excel (multipart : les métadonnées passent par la requête). */
export const etatFinancierExcelQuerySchema = z
  .object({
    exercice: entierTexte(1990, 2100),
    date_cloture: dateIsoSchema,
    devise: deviseSchema,
    tolerance: entierTexte(0, TOLERANCE_ETAT_DOSSIER_MAX).default("0"),
  })
  .strict();

export const etatDecisionSchema = z
  .object({
    decision: z.enum(["accepte", "rejete"]),
    /** Obligatoire pour un rejet et pour accepter un état dont des contrôles échouent. */
    motif: texteOptionnel(2000),
  })
  .strict()
  .refine((d) => d.decision !== "rejete" || Boolean(d.motif), {
    message: "Motif obligatoire pour rejeter un état financier.",
    path: ["motif"],
  });
export type EtatDecision = z.infer<typeof etatDecisionSchema>;

// ---------------------------------------------------------------------------
// Liste, frise, export (DOS-06, DOS-07)
// ---------------------------------------------------------------------------

export const dossiersListeQuerySchema = z
  .object({
    q: z.string().trim().max(100).optional(),
    curseur: z.string().max(500).optional(),
    limite: z.coerce.number().int().min(1).max(100).default(30),
  })
  .strict();

export const FRISE_DOSSIER_LIMITE_MAX = 500;

export const friseQuerySchema = z
  .object({
    limite: z.coerce.number().int().min(1).max(FRISE_DOSSIER_LIMITE_MAX).default(200),
    ordre: z.enum(["recent_d_abord", "ancien_d_abord"]).default("recent_d_abord"),
  })
  .strict();

export const exportDossierQuerySchema = z
  .object({ format: z.enum(["json", "zip"]).default("json") })
  .strict();

export const paramsDossierSousId = z
  .object({ id: z.string().uuid(), sousId: z.string().uuid() })
  .strict();
