import { z } from "zod";
import {
  auMoinsUnChamp,
  dateIsoSchema,
  deviseSchema,
  MESSAGE_CORPS_VIDE,
  montantSchema,
  texte,
  texteOptionnel,
} from "./commun";
import { cheminStockageSur } from "./missions";

/*
 * Facturation de la V1 (FIN-02, FIN-05, FIN-06, FIN-07, FIN-15) : paramètres
 * de facturation du cabinet, taux négociés par client, débours et notes de
 * frais, échéancier, factures et avoirs. Montants en entiers d'unités
 * mineures (FCFA : 1 unité ; EUR/USD : centimes) ; tous les calculs sont faits
 * par @missionpilot/engines.
 */

/** Dates de facturation : années 2000 à 2100 (bornes aussi posées en base, 0040). */
export const FACTURATION_DATE_MIN = "2000-01-01";
export const FACTURATION_DATE_MAX = "2100-12-31";

export const dateFacturationSchema = dateIsoSchema.refine(
  (v) => v >= FACTURATION_DATE_MIN && v <= FACTURATION_DATE_MAX,
  "Date hors de la plage autorisée (années 2000 à 2100).",
);

/** Pourcentage en points (18 pour 18 %), de 0 à 100, quatre décimales au plus. */
export const pourcentageSchema = z
  .number()
  .min(0)
  .max(100)
  .refine((v) => Math.abs(v * 10_000 - Math.round(v * 10_000)) < 1e-6, "Quatre décimales au plus.");

/** Taux de TVA en points, deux décimales au plus. */
export const tauxTvaSchema = z
  .number()
  .min(0)
  .max(100)
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-9, "Deux décimales au plus.");

const curseurSchema = z.string().max(500).optional();
const limiteSchema = z.coerce.number().int().min(1).max(100).default(30);

/* ----- Paramètres de facturation du cabinet (FIN-07) ----- */

/** Valeur de départ (Côte d'Ivoire) à faire valider par le métier : TVA 18 %. */
export const TAUX_TVA_DEPART = 18;
export const BASES_RETENUE = ["HT", "TTC"] as const;
export type BaseRetenue = (typeof BASES_RETENUE)[number];

/** Texte d'une ligne (sans saut de ligne). */
const ligneTexte = (max: number) =>
  texteOptionnel(max).refine(
    (v) => v === null || v === undefined || !/[\r\n]/.test(v),
    "Une seule ligne attendue.",
  );

/**
 * Champs d'identité légale et de paiement (mentions légales, IBAN) : réservés
 * à « cabinet.gerer » (un IBAN modifié détourne les paiements).
 */
export const CHAMPS_PARAMETRES_IDENTITE = [
  "raison_sociale",
  "forme_juridique",
  "rccm",
  "compte_contribuable",
  "regime_fiscal",
  "adresse",
  "telephone",
  "email",
  "banque",
  "iban",
  "autres_coordonnees",
  "mentions_complementaires",
  "prefixe_facture",
  "prefixe_avoir",
  "chiffres_numero",
] as const;

/**
 * Coordonnées de paiement : leur MODIFICATION exige en plus une
 * reconfirmation d'identité (`mot_de_passe`, et `code` ou `code_secours` si la
 * 2FA est active) jointe au corps du PATCH (voir confirmationIdentiteSchema).
 */
export const CHAMPS_PARAMETRES_BANCAIRES = ["banque", "iban", "autres_coordonnees"] as const;

/** Champs opérationnels (délai, TVA, retenue) : « facture.emettre ». */
export const CHAMPS_PARAMETRES_OPERATIONNELS = [
  "delai_paiement_jours",
  "taux_tva_defaut",
  "taux_tva_autorises",
  "taux_tva_debours",
  "retenue_active",
  "retenue_taux",
  "retenue_base",
  "retenue_libelle",
  "valeurs_validees",
] as const;

const prefixeSchema = z
  .string()
  .trim()
  .regex(/^[A-Z0-9]{1,10}$/, "Préfixe : majuscules et chiffres, 10 caractères au plus.");

export const parametresFacturationSchema = z
  .object({
    raison_sociale: ligneTexte(200),
    forme_juridique: ligneTexte(80),
    rccm: ligneTexte(80),
    compte_contribuable: ligneTexte(80),
    regime_fiscal: ligneTexte(120),
    adresse: texteOptionnel(500),
    telephone: ligneTexte(40),
    email: ligneTexte(254),
    banque: ligneTexte(120),
    iban: z.preprocess(
      (v) => (typeof v === "string" ? v.replace(/\s+/g, "").toUpperCase() || null : v),
      z
        .string()
        .regex(/^[A-Z]{2}[0-9A-Z]{10,32}$/, "IBAN : 2 lettres puis 10 à 32 caractères.")
        .nullable()
        .optional(),
    ),
    autres_coordonnees: texteOptionnel(500),
    mentions_complementaires: texteOptionnel(1000),
    prefixe_facture: prefixeSchema,
    prefixe_avoir: prefixeSchema,
    chiffres_numero: z.number().int().min(3).max(8),
    delai_paiement_jours: z.number().int().min(0).max(365),
    taux_tva_defaut: tauxTvaSchema,
    taux_tva_autorises: z
      .array(tauxTvaSchema)
      .min(1)
      .max(10)
      .transform((t) => [...new Set(t)].sort((a, b) => a - b)),
    /** Taux appliqué par défaut aux débours refacturés (souvent hors champ : 0). */
    taux_tva_debours: tauxTvaSchema,
    retenue_active: z.boolean(),
    retenue_taux: pourcentageSchema,
    retenue_base: z.enum(BASES_RETENUE),
    retenue_libelle: texte(120).refine((v) => !/[\r\n]/.test(v), "Une seule ligne attendue."),
    /** Le métier confirme les valeurs de départ (TVA, retenue). */
    valeurs_validees: z.boolean(),
  })
  .partial()
  .strict()
  .refine(auMoinsUnChamp, MESSAGE_CORPS_VIDE)
  .refine(
    (p) => p.prefixe_facture === undefined || p.prefixe_facture !== p.prefixe_avoir,
    "Les préfixes des factures et des avoirs doivent différer.",
  );

/* ----- Taux négociés par client (FIN-02) ----- */

const validiteCoherente = (v: { valide_du?: string | null; valide_au?: string | null }) =>
  !v.valide_du || !v.valide_au || v.valide_au >= v.valide_du;
const MESSAGE_VALIDITE = "La fin de validité précède son début.";

export const tauxClientCreationSchema = z
  .object({
    grade_id: z.string().uuid(),
    taux: montantSchema,
    devise: deviseSchema.default("XOF"),
    valide_du: dateFacturationSchema.nullable().default(null),
    valide_au: dateFacturationSchema.nullable().default(null),
  })
  .strict()
  .refine(validiteCoherente, MESSAGE_VALIDITE);

export const tauxClientModificationSchema = z
  .object({
    taux: montantSchema,
    valide_du: dateFacturationSchema.nullable(),
    valide_au: dateFacturationSchema.nullable(),
  })
  .partial()
  .strict()
  .refine(auMoinsUnChamp, MESSAGE_CORPS_VIDE)
  .refine(validiteCoherente, MESSAGE_VALIDITE);

/* ----- Débours et notes de frais (FIN-05) ----- */

export const CATEGORIES_DEBOURS = [
  "transport",
  "hebergement",
  "restauration",
  "per_diem",
  "communication",
  "fournitures",
  "sous_traitance_locale",
  "autre",
] as const;
export type CategorieDebours = (typeof CATEGORIES_DEBOURS)[number];

export const STATUTS_DEBOURS = ["brouillon", "soumis", "valide", "rejete"] as const;
export type StatutDebours = (typeof STATUTS_DEBOURS)[number];

/** Montant strictement positif. */
const montantPositifSchema = montantSchema.refine((v) => v > 0, "Montant strictement positif.");

/** Justificatif : référence de fichier (chemin relatif sûr), jamais le binaire. */
export const justificatifSchema = texteOptionnel(500).refine(
  (c) => c === null || c === undefined || cheminStockageSur(c),
  "Chemin de justificatif refusé : chemin relatif sans « .. », « \\ » ni schéma.",
);

const champsDebours = {
  date: dateFacturationSchema,
  categorie: z.enum(CATEGORIES_DEBOURS),
  libelle: texte(200),
  montant: montantPositifSchema,
  devise: deviseSchema,
  refacturable: z.boolean(),
  justificatif: justificatifSchema,
};

export const deboursCreationSchema = z
  .object({
    ...champsDebours,
    devise: champsDebours.devise.optional(),
    refacturable: champsDebours.refacturable.default(true),
  })
  .strict();

export const deboursModificationSchema = z
  .object(champsDebours)
  .partial()
  .strict()
  .refine(auMoinsUnChamp, MESSAGE_CORPS_VIDE);

export const deboursRejetSchema = z.object({ motif: texte(500) }).strict();

export const deboursListeQuerySchema = z
  .object({
    statut: z.enum(STATUTS_DEBOURS).optional(),
    limite: limiteSchema,
    curseur: curseurSchema,
  })
  .strict();

/* ----- Échéancier de facturation (FIN-06, MIS-10) ----- */

export const TYPES_ECHEANCE = [
  "acompte",
  "jalon",
  "avancement",
  "regie",
  "abonnement",
  "part_variable",
] as const;
export type TypeEcheance = (typeof TYPES_ECHEANCE)[number];

export const STATUTS_ECHEANCE = ["prevue", "a_facturer", "facturee"] as const;
export type StatutEcheance = (typeof STATUTS_ECHEANCE)[number];

/** Échéance saisie à la main : un montant OU un pourcentage du budget signé. */
export const echeanceCreationSchema = z
  .object({
    type: z.enum(TYPES_ECHEANCE).refine((t) => t !== "regie", "La régie se calcule sur les temps."),
    libelle: texte(200),
    montant: montantPositifSchema.optional(),
    pourcentage: pourcentageSchema.refine((v) => v > 0, "Pourcentage positif.").optional(),
    date_prevue: dateFacturationSchema,
    jalon_id: z.string().uuid().nullable().default(null),
  })
  .strict()
  .refine(
    (e) => (e.montant === undefined) !== (e.pourcentage === undefined),
    "Indiquer un montant ou un pourcentage du budget signé, pas les deux.",
  );

export const echeanceModificationSchema = z
  .object({
    libelle: texte(200),
    montant: montantPositifSchema,
    pourcentage: pourcentageSchema.refine((v) => v > 0, "Pourcentage positif."),
    date_prevue: dateFacturationSchema,
    jalon_id: z.string().uuid().nullable(),
    /** Seules transitions saisies : prévue ↔ à facturer. */
    statut: z.enum(["prevue", "a_facturer"]),
  })
  .partial()
  .strict()
  .refine(auMoinsUnChamp, MESSAGE_CORPS_VIDE)
  .refine(
    (e) => !(e.montant !== undefined && e.pourcentage !== undefined),
    "Indiquer un montant ou un pourcentage, pas les deux.",
  );

const jalonGenerationSchema = z
  .object({
    libelle: texte(200),
    pourcentage: pourcentageSchema.refine((v) => v > 0, "Pourcentage positif."),
    date: dateFacturationSchema,
    type: z.enum(["acompte", "jalon", "avancement"]).default("jalon"),
    jalon_id: z.string().uuid().nullable().default(null),
  })
  .strict();

export const PERIODICITES = ["mensuelle", "trimestrielle", "semestrielle", "annuelle"] as const;

/**
 * Génération automatique selon le mode de facturation de la mission (MIS-10).
 * Forfait : jalons (par défaut 30 % à la signature, 70 % à la fin) ;
 * forfait avec part variable : part fixe en jalons + part variable ;
 * abonnement : montant périodique ; régie : voir `regieSchema`.
 */
export const echeancierGenerationSchema = z
  .object({
    jalons: z.array(jalonGenerationSchema).min(1).max(50).optional(),
    part_fixe: montantSchema.optional(),
    part_variable: z
      .object({
        libelle: texte(200),
        montant_maximum: montantSchema,
        atteinte: pourcentageSchema,
        date: dateFacturationSchema,
      })
      .strict()
      .optional(),
    abonnement: z
      .object({
        libelle: texte(200),
        montant_periodique: montantPositifSchema,
        date_debut: dateFacturationSchema,
        nombre_periodes: z.number().int().min(1).max(120),
        periodicite: z.enum(PERIODICITES),
      })
      .strict()
      .optional(),
  })
  .strict();

/** Échéances de régie sur les temps VALIDÉS non encore rattachés, jusqu'à une date. */
export const regieSchema = z.object({ jusqu_au: dateFacturationSchema.optional() }).strict();

/* ----- Factures et avoirs (FIN-07, FIN-15) ----- */

export const NATURES_FACTURE = ["facture", "avoir"] as const;
export type NatureFacture = (typeof NATURES_FACTURE)[number];

export const STATUTS_FACTURE = [
  "brouillon",
  "a_approuver",
  "approuvee",
  "emise",
  "annulee",
] as const;
export type StatutFacture = (typeof STATUTS_FACTURE)[number];

export const remiseSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("pourcentage"), valeur: pourcentageSchema }).strict(),
  z.object({ type: z.literal("montant"), valeur: montantSchema }).strict(),
]);
export type RemiseSaisie = z.infer<typeof remiseSchema>;

export const factureCreationSchema = z
  .object({
    echeance_ids: z.array(z.string().uuid()).max(50).default([]),
    debours_ids: z.array(z.string().uuid()).max(200).default([]),
    objet: texteOptionnel(300),
  })
  .strict()
  .refine(
    (f) => f.echeance_ids.length + f.debours_ids.length > 0,
    "Au moins une échéance à facturer ou un débours refacturable.",
  )
  .refine(
    (f) =>
      new Set(f.echeance_ids).size === f.echeance_ids.length &&
      new Set(f.debours_ids).size === f.debours_ids.length,
    "Un élément apparaît deux fois.",
  );

export const factureModificationSchema = z
  .object({
    objet: texteOptionnel(300),
    remise_globale: remiseSchema.nullable(),
    retenue_active: z.boolean(),
    delai_paiement_jours: z.number().int().min(0).max(365),
  })
  .partial()
  .strict()
  .refine(auMoinsUnChamp, MESSAGE_CORPS_VIDE);

export const factureLigneModificationSchema = z
  .object({
    libelle: texte(300),
    taux_tva: tauxTvaSchema,
    remise: remiseSchema.nullable(),
  })
  .partial()
  .strict()
  .refine(auMoinsUnChamp, MESSAGE_CORPS_VIDE);

export const factureRejetSchema = z.object({ motif: texte(500) }).strict();

export const avoirCreationSchema = z.object({ motif: texte(500) }).strict();

export const facturesListeQuerySchema = z
  .object({
    mission_id: z.string().uuid().optional(),
    client_id: z.string().uuid().optional(),
    nature: z.enum(NATURES_FACTURE).optional(),
    statut: z.enum(STATUTS_FACTURE).optional(),
    limite: limiteSchema,
    curseur: curseurSchema,
  })
  .strict();

export type ParametresFacturationSaisie = z.infer<typeof parametresFacturationSchema>;
export type DeboursCreation = z.infer<typeof deboursCreationSchema>;
export type EcheanceCreation = z.infer<typeof echeanceCreationSchema>;
export type FactureCreation = z.infer<typeof factureCreationSchema>;
