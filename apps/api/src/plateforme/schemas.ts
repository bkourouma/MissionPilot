import { z } from "zod";
import { MOT_DE_PASSE_MIN, roleSchema } from "@missionpilot/shared";

/* Entrées de l'API plateforme : toutes strictes (toute clé inconnue est refusée en 400). */

const email = z.string().trim().email().max(254);
/** Aucun caractère de contrôle (NUL compris), comme le CHECK SQL : refusé en 400, jamais en 500. */
const sansControle = (valeur: string): boolean =>
  ![...valeur].some((c) => c.charCodeAt(0) <= 0x1f || c.charCodeAt(0) === 0x7f);
const nom = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine(sansControle, "Caractères de contrôle interdits.");
const motDePasse = z.string().min(MOT_DE_PASSE_MIN).max(200);
const pays = z.string().regex(/^[A-Z]{2}$/, "Pays : code à 2 lettres majuscules.");

/** Au moins un champ à modifier (les PATCH vides sont refusés). */
const auMoinsUnChamp = (corps: Record<string, unknown>): boolean =>
  Object.values(corps).some((v) => v !== undefined);
const MESSAGE_VIDE = { message: "Au moins un champ à modifier est requis." };

/** 1 à 8 rôles du cabinet (jamais un rôle client), sans doublon. */
const roles = z
  .array(roleSchema)
  .min(1)
  .max(8)
  .refine((liste) => new Set(liste).size === liste.length, "Rôles en double.");

export const connexionSchema = z
  .object({ email: email.max(254), motDePasse: z.string().min(1).max(200) })
  .strict();

export const creerCabinetSchema = z
  .object({
    nom,
    pays: pays.default("CI"),
    associe: z.object({ nom, email, motDePasse: motDePasse.optional() }).strict(),
  })
  .strict();

export const modifierCabinetSchema = z
  .object({ nom: nom.optional(), actif: z.boolean().optional() })
  .strict()
  .refine(auMoinsUnChamp, MESSAGE_VIDE);

export const creerUtilisateurSchema = z
  .object({ nom, email, roles, motDePasse: motDePasse.optional() })
  .strict();

export const modifierUtilisateurSchema = z
  .object({ actif: z.boolean().optional(), roles: roles.optional() })
  .strict()
  .refine(auMoinsUnChamp, MESSAGE_VIDE);

/** Paramètres de chemin : UUID stricts, aucune autre clé. */
export const paramsCabinet = z.object({ id: z.string().uuid() }).strict();
export const paramsUtilisateur = z
  .object({ id: z.string().uuid(), uid: z.string().uuid() })
  .strict();

export type CreerCabinet = z.infer<typeof creerCabinetSchema>;
export type CreerUtilisateur = z.infer<typeof creerUtilisateurSchema>;
export type ModifierCabinet = z.infer<typeof modifierCabinetSchema>;
export type ModifierUtilisateur = z.infer<typeof modifierUtilisateurSchema>;
