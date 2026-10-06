import { z } from "zod";
import { auMoinsUnChamp, deviseSchema, MESSAGE_CORPS_VIDE, texte, texteOptionnel } from "./commun";
import { dateFacturationSchema } from "./facturation";
import { ecartJours } from "./planification";

/*
 * Fin de la finance V1 (FIN-09, FIN-11, FIN-12, FIN-13, indicateurs du
 * cabinet, bilan de clôture). Montants en entiers d'unités mineures ; tous les
 * calculs (soldes, marges, taux, encours, écritures) sont faits par
 * @missionpilot/engines côté API.
 */

const curseurSchema = z.string().max(500).optional();
const limiteSchema = z.coerce.number().int().min(1).max(100).default(30);

/** Montant strictement positif en unités mineures. */
const montantPositif = z
  .number()
  .int()
  .min(1, "Montant strictement positif.")
  .max(Number.MAX_SAFE_INTEGER);

/** Une seule ligne de texte (référence, libellé d'export…). */
const ligne = (max: number) =>
  texteOptionnel(max).refine(
    (v) => v === null || v === undefined || !/[\r\n]/.test(v),
    "Une seule ligne attendue.",
  );

const periodeCoherente = (q: { du?: string; au?: string }) => !q.du || !q.au || q.au >= q.du;
const MESSAGE_PERIODE = "La fin de la période précède son début.";

/* ----- Encaissements (FIN-09) ----- */

export const MODES_ENCAISSEMENT = ["virement", "cheque", "especes", "mobile_money"] as const;
export type ModeEncaissement = (typeof MODES_ENCAISSEMENT)[number];

/**
 * Opérateurs Mobile Money : la référence d'opération est saisie à la main
 * (aucune intégration d'API de paiement en V1 ; paiement en ligne : V2, FIN-10).
 */
export const OPERATEURS_MOBILE_MONEY = [
  "orange_money",
  "mtn_momo",
  "wave",
  "moov_money",
  "autre",
] as const;
export type OperateurMobileMoney = (typeof OPERATEURS_MOBILE_MONEY)[number];

/** Statut de paiement d'une facture : DÉRIVÉ des imputations, jamais stocké. */
export const STATUTS_PAIEMENT = [
  "non_payee",
  "partiellement_payee",
  "soldee",
  "en_retard",
  "annulee",
] as const;
export type StatutPaiement = (typeof STATUTS_PAIEMENT)[number];

export const imputationSaisieSchema = z
  .object({ facture_id: z.string().uuid(), montant: montantPositif })
  .strict();

const imputationsListe = z
  .array(imputationSaisieSchema)
  .max(50)
  .refine(
    (l) => new Set(l.map((i) => i.facture_id)).size === l.length,
    "Une facture apparaît deux fois.",
  );

export const encaissementCreationSchema = z
  .object({
    client_id: z.string().uuid(),
    date: dateFacturationSchema,
    montant: montantPositif,
    devise: deviseSchema.default("XOF"),
    mode: z.enum(MODES_ENCAISSEMENT),
    operateur: z.enum(OPERATEURS_MOBILE_MONEY).nullable().default(null),
    /** Référence de virement, numéro de chèque, référence d'opération Mobile Money. */
    reference: ligne(120),
    commentaire: texteOptionnel(500),
    imputations: imputationsListe.default([]),
    /**
     * Part non imputée : refusée, sauf avance (trop-perçu) explicitement
     * acceptée ; elle reste alors imputable plus tard.
     */
    avance: z.boolean().default(false),
  })
  .strict()
  .refine((e) => (e.mode === "mobile_money") === (e.operateur !== null), {
    message: "Mobile Money : préciser l'opérateur (et seulement pour ce mode).",
    path: ["operateur"],
  })
  .refine((e) => !["mobile_money", "cheque"].includes(e.mode) || Boolean(e.reference), {
    message: "Chèque et Mobile Money : la référence (numéro, opération) est obligatoire.",
    path: ["reference"],
  });

export const imputationsAjoutSchema = z
  .object({ imputations: imputationsListe.refine((l) => l.length > 0, "Au moins une facture.") })
  .strict();

export const contrePassationDemandeSchema = z.object({ motif: texte(500) }).strict();
export const contrePassationRejetSchema = z.object({ motif: texte(500) }).strict();

export const encaissementsListeQuerySchema = z
  .object({
    client_id: z.string().uuid().optional(),
    du: dateFacturationSchema.optional(),
    au: dateFacturationSchema.optional(),
    limite: limiteSchema,
    curseur: curseurSchema,
  })
  .strict()
  .refine(periodeCoherente, MESSAGE_PERIODE);

export const STATUTS_CONTRE_PASSATION = ["demandee", "validee", "rejetee"] as const;

export const contrePassationsListeQuerySchema = z
  .object({
    statut: z.enum(STATUTS_CONTRE_PASSATION).optional(),
    limite: limiteSchema,
    curseur: curseurSchema,
  })
  .strict();

export const creancesQuerySchema = z
  .object({
    client_id: z.string().uuid().optional(),
    date: dateFacturationSchema.optional(),
  })
  .strict();

/* ----- Relances (FIN-09) ----- */

/**
 * Délais de relance en jours après l'échéance, un par niveau (1 à 3).
 * VALEURS DE DÉPART à faire valider par le métier : J+7, J+15, J+30.
 */
export const DELAIS_RELANCE_DEPART = [7, 15, 30] as const;
export const NIVEAUX_RELANCE = [1, 2, 3] as const;

export const parametresRelanceSchema = z
  .object({
    delais_relance: z
      .array(z.number().int().min(1).max(365))
      .min(1)
      .max(3)
      .refine(
        (d) => d.every((v, i) => i === 0 || v > (d[i - 1] as number)),
        "Délais strictement croissants.",
      ),
    relances_actives: z.boolean(),
    /** Envoi automatique de l'e-mail au contact du client (sinon : préparé seulement). */
    envoi_email_client: z.boolean(),
    valeurs_validees: z.boolean(),
  })
  .partial()
  .strict()
  .refine(auMoinsUnChamp, MESSAGE_CORPS_VIDE);

export const relanceManuelleSchema = z
  .object({
    niveau: z.number().int().min(1).max(3).optional(),
    envoyer_email: z.boolean().default(true),
    message: texteOptionnel(1000),
  })
  .strict();

/* ----- Balance âgée, encours, rentabilité ----- */

export const balanceAgeeQuerySchema = z
  .object({
    date: dateFacturationSchema.optional(),
    base: z.enum(["echeance", "emission"]).default("echeance"),
  })
  .strict();

export const encoursQuerySchema = z.object({ date: dateFacturationSchema.optional() }).strict();

export const NIVEAUX_RENTABILITE = ["mission", "client", "type", "associe"] as const;

export const rentabiliteQuerySchema = z
  .object({
    niveau: z.enum(NIVEAUX_RENTABILITE).default("mission"),
    du: dateFacturationSchema,
    au: dateFacturationSchema,
  })
  .strict()
  .refine(periodeCoherente, MESSAGE_PERIODE);

/* ----- Indicateurs du cabinet ----- */

export const NIVEAUX_INDICATEURS = [
  "cabinet",
  "associe",
  "grade",
  "collaborateur",
  "mission",
  "client",
] as const;
export type NiveauIndicateurs = (typeof NIVEAUX_INDICATEURS)[number];

/** Période des indicateurs : un an au plus (366 jours). */
export const INDICATEURS_MAX_JOURS = 366;

export const indicateursQuerySchema = z
  .object({
    du: dateFacturationSchema,
    au: dateFacturationSchema,
    niveau: z.enum(NIVEAUX_INDICATEURS).default("cabinet"),
    /** Date d'évaluation des jalons et des feuilles (par défaut : fin de période). */
    date_reference: dateFacturationSchema.optional(),
  })
  .strict()
  .refine(periodeCoherente, MESSAGE_PERIODE)
  .refine(
    (q) => ecartJours(q.du, q.au) < INDICATEURS_MAX_JOURS,
    `Période de ${INDICATEURS_MAX_JOURS} jours au plus.`,
  );

/* ----- Bilan de clôture ----- */

/** Délai pendant lequel le directeur de mission complète le retour d'expérience. */
export const DELAI_RETOUR_EXPERIENCE_JOURS = 30;

export const retourExperienceSchema = z.object({ texte: texte(10_000) }).strict();

/* ----- Export comptable (FIN-13) ----- */

/** Comptes du plan comptable du cabinet (SYSCOHADA), par rôle dans les écritures. */
export const CLES_COMPTES = [
  "clients",
  "avances_clients",
  "produits_prestations",
  "produits_debours",
  "tva_collectee",
  "retenues_subies",
  "banque",
  "cheques",
  "caisse",
  "mobile_money",
] as const;
export type CleCompte = (typeof CLES_COMPTES)[number];

export const CLES_JOURNAUX = [
  "ventes",
  "banque",
  "caisse",
  "mobile_money",
  "operations_diverses",
] as const;
export type CleJournal = (typeof CLES_JOURNAUX)[number];

const compteSchema = z
  .string()
  .trim()
  .regex(/^[0-9A-Z]{2,12}$/, "Numéro de compte : 2 à 12 chiffres ou majuscules.");
const journalSchema = z
  .string()
  .trim()
  .regex(/^[0-9A-Z]{1,6}$/, "Code journal : 1 à 6 chiffres ou majuscules.");

export const planComptableSchema = z
  .object({
    comptes: z
      .object(
        Object.fromEntries(CLES_COMPTES.map((c) => [c, compteSchema])) as Record<
          CleCompte,
          typeof compteSchema
        >,
      )
      .partial()
      .strict()
      .optional(),
    journaux: z
      .object(
        Object.fromEntries(CLES_JOURNAUX.map((c) => [c, journalSchema])) as Record<
          CleJournal,
          typeof journalSchema
        >,
      )
      .partial()
      .strict()
      .optional(),
    /** L'expert-comptable confirme le plan de départ. */
    valeurs_validees: z.boolean().optional(),
  })
  .strict()
  .refine(auMoinsUnChamp, MESSAGE_CORPS_VIDE);

export const SEPARATEURS_CSV = ["point_virgule", "virgule", "tabulation"] as const;
export const FORMATS_DATE_EXPORT = ["jj/mm/aaaa", "aaaa-mm-jj", "jjmmaaaa"] as const;

/** Période d'un export : deux ans au plus. */
export const EXPORT_MAX_JOURS = 731;

export const exportComptableQuerySchema = z
  .object({
    du: dateFacturationSchema,
    au: dateFacturationSchema,
    format: z.enum(["csv"]).default("csv"),
    separateur: z.enum(SEPARATEURS_CSV).default("point_virgule"),
    decimale: z.enum(["virgule", "point"]).default("virgule"),
    /** UTF-8 avec BOM (ouverture directe dans Excel). */
    bom: z.enum(["oui", "non"]).default("non"),
    format_date: z.enum(FORMATS_DATE_EXPORT).default("jj/mm/aaaa"),
  })
  .strict()
  .refine(periodeCoherente, MESSAGE_PERIODE)
  .refine(
    (q) => ecartJours(q.du, q.au) < EXPORT_MAX_JOURS,
    `Période de ${EXPORT_MAX_JOURS} jours au plus.`,
  )
  .refine(
    (q) => !(q.separateur === "virgule" && q.decimale === "virgule"),
    "Séparateur virgule : la décimale doit être le point.",
  );

export type EncaissementCreation = z.infer<typeof encaissementCreationSchema>;
export type ImputationSaisie = z.infer<typeof imputationSaisieSchema>;
export type ExportComptableQuery = z.infer<typeof exportComptableQuerySchema>;
export type PlanComptableSaisie = z.infer<typeof planComptableSchema>;
