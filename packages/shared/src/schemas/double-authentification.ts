import { z } from "zod";

/*
 * Double authentification TOTP (SOC-02). Contrat des routes /api/auth/2fa/*
 * et du second temps de la connexion (/api/auth/connexion/2fa).
 */

/** Rôles sensibles pour lesquels un cabinet peut rendre la 2FA obligatoire. */
export const ROLES_TFA_SENSIBLES = ["associe", "directeur_mission", "gestionnaire"] as const;
export type RoleTfaSensible = (typeof ROLES_TFA_SENSIBLES)[number];

/** Nombre de codes de secours remis à l'activation ou à la régénération. */
export const NOMBRE_CODES_SECOURS = 10;

/** Code à 6 chiffres de l'application d'authentification (espaces tolérés). */
export const codeTotpSchema = z
  .string()
  .max(20)
  .transform((v) => v.replace(/\s/g, ""))
  .pipe(z.string().regex(/^\d{6}$/, "Code à 6 chiffres attendu."));

/** Code de secours « xxxxx-xxxxx » (tirets, espaces et casse tolérés). */
export const codeSecoursSchema = z
  .string()
  .max(40)
  .transform((v) => v.replace(/[\s-]/g, "").toLowerCase())
  .pipe(z.string().regex(/^[a-z0-9]{10}$/, "Code de secours invalide."));

const motDePasse = z.string().min(1).max(200);

const unSeulFacteur = (v: { code?: string; code_secours?: string }) =>
  (v.code === undefined) !== (v.code_secours === undefined);
const MESSAGE_FACTEUR = "Fournir soit un code, soit un code de secours.";

export const tfaInitialisationSchema = z.object({ mot_de_passe: motDePasse }).strict();

export const tfaActivationSchema = z.object({ code: codeTotpSchema }).strict();

/** Désactivation et régénération des codes de secours : mot de passe ET second facteur. */
export const tfaConfirmationSchema = z
  .object({
    mot_de_passe: motDePasse,
    code: codeTotpSchema.optional(),
    code_secours: codeSecoursSchema.optional(),
  })
  .strict()
  .refine(unSeulFacteur, MESSAGE_FACTEUR);

export const connexion2faSchema = z
  .object({
    defi: z.string().min(20).max(200),
    code: codeTotpSchema.optional(),
    code_secours: codeSecoursSchema.optional(),
  })
  .strict()
  .refine(unSeulFacteur, MESSAGE_FACTEUR);

export const politiqueTfaSchema = z
  .object({
    roles_obligatoires: z
      .array(z.enum(ROLES_TFA_SENSIBLES))
      .max(ROLES_TFA_SENSIBLES.length)
      .transform((r) => [...new Set(r)]),
  })
  .strict();

export type Connexion2fa = z.infer<typeof connexion2faSchema>;
export type TfaConfirmation = z.infer<typeof tfaConfirmationSchema>;
export type PolitiqueTfa = z.infer<typeof politiqueTfaSchema>;

/** Réponse de POST /api/auth/connexion et POST /api/auth/connexion/2fa. */
export type ReponseConnexion =
  { ok: true; etape: "connecte" } | { ok: false; etape: "2fa_requise"; defi: string };
