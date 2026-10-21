import { z } from "zod";
import {
  auMoinsUnChamp,
  dateIsoSchema,
  deviseSchema,
  listeLibelles,
  MESSAGE_CORPS_VIDE,
  texte,
  texteOptionnel,
} from "./commun";

/*
 * Services candidats : diagnostic flash, business plan bancable et recherche de financement,
 * veille des guichets de financement. Objets stricts ; le même schéma sert l'API et le web.
 *
 * Les vocabulaires de guichets sont les MÊMES que ceux de `packages/engines/src/services-candidats`
 * (le moteur n'importe pas ce paquet). Aucune donnée de cabinet n'est fournie par défaut : la liste
 * des guichets est vide tant que le cabinet ne la renseigne pas.
 */

export const CODES_SERVICES_CANDIDATS = ["diagnostic_flash", "business_plan_bancable"] as const;
export type CodeServiceCandidat = (typeof CODES_SERVICES_CANDIDATS)[number];
export const serviceCandidatCodeSchema = z.enum(CODES_SERVICES_CANDIDATS);

export const SERVICES_CANDIDATS_LIBELLES: Record<CodeServiceCandidat, string> = {
  diagnostic_flash: "Diagnostic flash",
  business_plan_bancable: "Business plan bancable et recherche de financement",
};

/**
 * Services dont le type de mission ne s'active qu'une fois le PRIX FIXE saisi par le cabinet :
 * aucun prix par défaut n'est fourni (décision de l'utilisateur), le diagnostic flash est vendu
 * à prix fixe. Le business plan bancable reste « sur devis » (montant null admis).
 */
export const SERVICES_PRIX_REQUIS: Record<CodeServiceCandidat, boolean> = {
  diagnostic_flash: true,
  business_plan_bancable: false,
};

/** Prix fixe du service : entier en unité de la devise ; `montant` null = à fixer / sur devis. */
export const prixFixeSchema = z
  .object({
    montant: z.number().int().min(0).max(1_000_000_000_000).nullable(),
    devise: deviseSchema,
    /** Mention libre du cabinet (ex. « DÉMONSTRATION »). */
    commentaire: z.string().trim().max(200).nullable().optional(),
  })
  .strict();
export type PrixFixe = z.infer<typeof prixFixeSchema>;

/** Activation du type de mission d'un service (le prix doit être fixé si le service l'exige). */
export const activationServiceSchema = z.object({ service: serviceCandidatCodeSchema }).strict();
export type ActivationService = z.infer<typeof activationServiceSchema>;

/* ----- Guichets de financement ----- */

export const TYPES_GUICHET = [
  "banque",
  "bailleur",
  "fonds_investissement",
  "programme_public",
  "autre",
] as const;
export type TypeGuichet = (typeof TYPES_GUICHET)[number];
export const typeGuichetSchema = z.enum(TYPES_GUICHET);

export const OBJETS_FINANCEMENT = [
  "creation",
  "investissement",
  "bfr",
  "croissance",
  "restructuration",
  "export",
] as const;
export type ObjetFinancement = (typeof OBJETS_FINANCEMENT)[number];
export const objetFinancementSchema = z.enum(OBJETS_FINANCEMENT);

/**
 * Liste de libellés courts sans doublon, bornée comme les CHECK de 0563 : nombre d'entrées et
 * longueur totale (valeurs jointes par une virgule, comme `array_to_string(col, ',')`).
 */
const listeBornee = (maxEntrees: number, maxCaracteres: number) =>
  listeLibelles(maxEntrees, 80).refine((l) => l.join(",").length <= maxCaracteres, {
    message: `Au plus ${maxCaracteres} caractères en tout.`,
  });
const listeTextes = () => listeLibelles(50, 80);
const listeEnum = <T extends z.ZodTypeAny>(schema: T, max: number) =>
  z
    .array(schema)
    .max(max)
    .transform((liste) => [...new Set(liste)]);
/** Caractère de contrôle (C0 et C1) : refusé dans le nom, comme le CHECK de 0563. */
const avecCaractereDeControle = (v: string): boolean =>
  [...v].some((c) => {
    const n = c.charCodeAt(0);
    return n < 32 || (n >= 127 && n <= 159);
  });
const montantBorne = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable();

/** Lien http ou https seulement, avec « :// » et sans espace (comme le CHECK de 0563). */
const urlHttpSchema = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : v),
  z
    .string()
    .trim()
    .max(500)
    .refine((v) => {
      if (!/^https?:\/\/[^\s]+$/i.test(v)) return false;
      try {
        const { protocol } = new URL(v);
        return protocol === "http:" || protocol === "https:";
      } catch {
        return false;
      }
    }, "Adresse http ou https attendue.")
    .nullable()
    .optional(),
);

const guichetBase = z
  .object({
    nom: texte(200).refine((v) => !avecCaractereDeControle(v), {
      message: "Le nom ne contient pas de caractère de contrôle.",
    }),
    type: typeGuichetSchema,
    pays: listeBornee(60, 600).default([]),
    secteurs: listeBornee(50, 2000).default([]),
    filieres: listeBornee(50, 2000).default([]),
    tailles: listeBornee(10, 200).default([]),
    objets: listeEnum(objetFinancementSchema, 10).default([]),
    devises: listeEnum(deviseSchema, 4).default([]),
    montant_min: montantBorne.default(null),
    montant_max: montantBorne.default(null),
    devise_montant: deviseSchema.nullable().default(null),
    date_limite: dateIsoSchema.nullable().default(null),
    description: texteOptionnel(2000),
    url: urlHttpSchema,
    actif: z.boolean().default(true),
  })
  .strict();

type BornesGuichet = {
  montant_min?: number | null;
  montant_max?: number | null;
  devise_montant?: string | null;
};

function verifierBornes(v: BornesGuichet, ctx: z.RefinementCtx, devisePresente: boolean) {
  const { montant_min: min, montant_max: max } = v;
  if (typeof min === "number" && typeof max === "number" && min > max) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["montant_min"],
      message: "Le montant minimum ne peut pas dépasser le maximum.",
    });
  }
  const borne = (typeof min === "number" ? 1 : 0) + (typeof max === "number" ? 1 : 0) > 0;
  if (borne && devisePresente && !v.devise_montant) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["devise_montant"],
      message: "La devise du montant est obligatoire quand une borne est donnée.",
    });
  }
}

export const guichetCreationSchema = guichetBase.superRefine((v, ctx) =>
  verifierBornes(v, ctx, true),
);
export type GuichetCreation = z.infer<typeof guichetCreationSchema>;

/**
 * Modification partielle : au moins un champ. La devise n'est exigée que si le corps la
 * fournit (explicitement nulle) avec une borne ; le serveur contrôle la cohérence finale.
 */
export const guichetModificationSchema = guichetBase
  .partial()
  .refine(auMoinsUnChamp, { message: MESSAGE_CORPS_VIDE })
  .superRefine((v, ctx) => verifierBornes(v, ctx, v.devise_montant !== undefined));
export type GuichetModification = z.infer<typeof guichetModificationSchema>;

export const guichetsQuerySchema = z
  .object({
    actif: z
      .enum(["true", "false"])
      .transform((v) => v === "true")
      .optional(),
    limite: z.coerce.number().int().min(1).max(200).default(100),
  })
  .strict();

/** Surcharges du profil de financement du client (tous champs facultatifs). */
export const profilFinancementSchema = z
  .object({
    pays: texte(80).nullable(),
    secteur: texte(80).nullable(),
    filieres: listeTextes(),
    taille: texte(80).nullable(),
    objet: objetFinancementSchema.nullable(),
    montant: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),
    devise: deviseSchema.nullable(),
  })
  .partial()
  .strict();

export const guichetsRapprochementSchema = z
  .object({
    client_id: z.string().uuid().optional(),
    profil: profilFinancementSchema.optional(),
  })
  .strict()
  .refine((v) => v.client_id !== undefined || v.profil !== undefined, {
    message: "Un client ou un profil est attendu.",
  });
export type GuichetsRapprochement = z.infer<typeof guichetsRapprochementSchema>;
