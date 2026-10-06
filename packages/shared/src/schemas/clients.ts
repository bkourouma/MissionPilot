import { z } from "zod";
import {
  auMoinsUnChamp,
  emailOptionnel,
  MESSAGE_CORPS_VIDE,
  paysSchema,
  texte,
  texteOptionnel,
} from "./commun";

export const TAILLES_CLIENT = ["tpe", "pme", "eti", "grande_entreprise"] as const;
export type TailleClient = (typeof TAILLES_CLIENT)[number];

const champsClient = {
  raison_sociale: texte(200),
  forme_juridique: texteOptionnel(60),
  rccm: texteOptionnel(60),
  compte_contribuable: texteOptionnel(60),
  secteur: texteOptionnel(120),
  pays: paysSchema,
  taille: z.enum(TAILLES_CLIENT).nullable().optional(),
  adresse: texteOptionnel(500),
  actif: z.boolean(),
};

export const clientCreationSchema = z
  .object({
    ...champsClient,
    pays: champsClient.pays.default("CI"),
    actif: champsClient.actif.default(true),
  })
  .strict();

export const clientModificationSchema = z
  .object(champsClient)
  .partial()
  .strict()
  .refine(auMoinsUnChamp, MESSAGE_CORPS_VIDE);

const champsContact = {
  nom: texte(160),
  fonction: texteOptionnel(120),
  email: emailOptionnel,
  telephone: texteOptionnel(40),
  principal: z.boolean(),
};

export const contactCreationSchema = z
  .object({ ...champsContact, principal: champsContact.principal.default(false) })
  .strict();

export const contactModificationSchema = z
  .object(champsContact)
  .partial()
  .strict()
  .refine(auMoinsUnChamp, MESSAGE_CORPS_VIDE);

/** Paramètres de liste paginée par curseur (chaînes de requête). */
export const listeQuerySchema = z
  .object({
    q: z.string().trim().max(100).optional(),
    actif: z.enum(["true", "false"]).optional(),
    limite: z.coerce.number().int().min(1).max(100).default(25),
    curseur: z.string().max(500).optional(),
  })
  .strict();

export type ClientCreation = z.infer<typeof clientCreationSchema>;
export type ClientModification = z.infer<typeof clientModificationSchema>;
export type ContactCreation = z.infer<typeof contactCreationSchema>;
