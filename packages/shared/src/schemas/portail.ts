import { z } from "zod";
import { roleClientSchema, ROLES_CLIENT } from "../roles";
import { emailSchema, texteOptionnel } from "./commun";
import { codeSecoursSchema, codeTotpSchema } from "./double-authentification";
import { invitationAcceptationSchema } from "./utilisateurs";

/*
 * Portail client (SOC-09) : contrat des routes /api/portail/**.
 *
 * Côté cabinet (permission « portail.gerer ») : invitations des personnes de
 * l'entreprise cliente (rôles client SEULEMENT), partages explicites (par
 * défaut, RIEN n'est partagé), liste et désactivation des utilisateurs du
 * portail d'un client. Côté client : lecture de SON entreprise, limitée aux
 * partages, et validation d'un jalon par le dirigeant client.
 */

const uuid = z.string().uuid();

/** Types de documents de mission partageables comme livrables (jamais une proposition). */
export const TYPES_DOCUMENT_PARTAGEABLES = ["livrable", "lettre_de_mission"] as const;

export const rolesClientSchema = z
  .array(roleClientSchema)
  .min(1)
  .max(ROLES_CLIENT.length)
  .transform((roles) => [...new Set(roles)]);

export const portailInvitationCreationSchema = z
  .object({ email: emailSchema, client_id: uuid, roles: rolesClientSchema })
  .strict();

/** Acceptation d'une invitation du portail : même contrat que l'invitation interne. */
export const portailInvitationAcceptationSchema = invitationAcceptationSchema;

/** Paramètre de requête des routes de gestion propres à un client. */
export const portailClientQuerySchema = z.object({ client_id: uuid }).strict();

export const portailPartageMissionSchema = z
  .object({
    mission_id: uuid,
    /** Jalons visibles (et validables par le dirigeant client). */
    jalons: z.boolean().default(false),
    /** Factures émises de la mission visibles. */
    factures: z.boolean().default(false),
  })
  .strict();

/**
 * Remplacement COMPLET des partages d'un client : ce qui n'est pas listé
 * n'est plus partagé. Un document n'est partageable que si sa mission l'est.
 */
export const portailPartagesSchema = z
  .object({
    missions: z.array(portailPartageMissionSchema).max(500),
    documents: z
      .array(uuid)
      .max(2000)
      .transform((ids) => [...new Set(ids)]),
    /** Contact principal du cabinet affiché au client (seul nom interne exposé), ou null. */
    contact_principal_id: uuid.nullable().optional(),
  })
  .strict()
  .refine(
    (v) => new Set(v.missions.map((m) => m.mission_id)).size === v.missions.length,
    "Une mission n'est listée qu'une fois.",
  );

export const portailListeQuerySchema = z
  .object({
    limite: z.coerce.number().int().min(1).max(100).default(50),
    curseur: z.string().max(500).optional(),
  })
  .strict();

export const portailValidationJalonSchema = z
  .object({ commentaire: texteOptionnel(1000) })
  .strict();

/** Téléchargement d'un livrable partagé. */
export const portailTelechargementQuerySchema = z
  .object({ affichage: z.enum(["inline", "attachment"]).optional() })
  .strict();

const auPlusUnFacteur = (v: { code?: string; code_secours?: string }) =>
  v.code === undefined || v.code_secours === undefined;

/**
 * Politique du portail du cabinet : 2FA obligatoire pour les utilisateurs du
 * portail. Action à fort impact : mot de passe et second facteur de l'auteur.
 */
export const portailParametresModificationSchema = z
  .object({
    tfa_obligatoire: z.boolean(),
    mot_de_passe: z.string().min(1).max(200).optional(),
    code: codeTotpSchema.optional(),
    code_secours: codeSecoursSchema.optional(),
  })
  .strict()
  .refine(auPlusUnFacteur, "Fournir soit un code, soit un code de secours.");

export type PortailInvitationCreation = z.infer<typeof portailInvitationCreationSchema>;
export type PortailPartages = z.infer<typeof portailPartagesSchema>;
export type PortailPartageMission = z.infer<typeof portailPartageMissionSchema>;
