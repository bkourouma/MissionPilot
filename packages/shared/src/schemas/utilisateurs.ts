import { z } from "zod";
import { roleSchema, ROLES } from "../roles";
import { auMoinsUnChamp, emailSchema, MESSAGE_CORPS_VIDE, texte } from "./commun";

export const rolesSchema = z
  .array(roleSchema)
  .min(1)
  .max(ROLES.length)
  .transform((roles) => [...new Set(roles)]);

/** Longueur minimale d'un mot de passe choisi par un utilisateur. */
export const MOT_DE_PASSE_MIN = 12;

export const invitationCreationSchema = z
  .object({ email: emailSchema, roles: rolesSchema })
  .strict();

export const invitationAcceptationSchema = z
  .object({
    jeton: z.string().min(20).max(200),
    nom: texte(120),
    mot_de_passe: z.string().min(MOT_DE_PASSE_MIN).max(200),
  })
  .strict();

export const utilisateurModificationSchema = z
  .object({
    nom: texte(120).optional(),
    roles: rolesSchema.optional(),
    actif: z.boolean().optional(),
  })
  .strict()
  .refine(auMoinsUnChamp, MESSAGE_CORPS_VIDE);

export type InvitationCreation = z.infer<typeof invitationCreationSchema>;
export type UtilisateurModification = z.infer<typeof utilisateurModificationSchema>;
