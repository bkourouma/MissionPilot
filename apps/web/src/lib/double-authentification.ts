/**
 * Double authentification (SOC-02) : logique pure de la connexion en deux temps et de la
 * gestion de sa propre 2FA, testée dans `double-authentification.test.ts`.
 *
 * Le défi renvoyé par l'API après le mot de passe vit UNIQUEMENT dans l'état mémoire du
 * composant de connexion : jamais dans l'URL, l'historique, le stockage du navigateur ni un
 * journal.
 */
import {
  creerTraduire,
  libelleRole,
  ROLE_LIBELLES,
  ROLES_TFA_SENSIBLES,
  type Langue,
  type RoleTfaSensible,
} from "@missionpilot/shared";
import { ErreurApi, messageErreur } from "./api";
import type { Resultat } from "./saisie";

// --- Machine d'états de la connexion -------------------------------------------------------

export type FacteurSaisi = "totp" | "secours";

export type EtatConnexion =
  | { etape: "identifiants"; message: string | null }
  | { etape: "code"; defi: string; facteur: FacteurSaisi; message: string | null }
  | { etape: "connecte" };

export type EvenementConnexion =
  | { type: "reponse_identifiants"; corps: unknown }
  | { type: "reponse_code" }
  | { type: "erreur_code"; erreur: unknown }
  | { type: "changer_facteur" }
  | { type: "abandonner" };

export const ETAT_INITIAL: EtatConnexion = { etape: "identifiants", message: null };

export const MESSAGE_DEFI_EXPIRE =
  "La vérification a expiré ou a déjà servi. Saisissez à nouveau votre e-mail et votre mot de passe.";
export const MESSAGE_CODE_INVALIDE =
  "Code incorrect. Vérifiez l'heure de votre téléphone et saisissez le code affiché maintenant.";
export const MESSAGE_SECOURS_INVALIDE =
  "Code de secours incorrect ou déjà utilisé. Chaque code ne sert qu'une fois.";
export const MESSAGE_TROP_DE_TENTATIVES =
  "Trop de tentatives. Patientez quelques minutes avant de réessayer.";
const MESSAGE_REPONSE_INATTENDUE =
  "Réponse inattendue du serveur. Réessayez de vous connecter dans un instant.";

const MESSAGE_DEFI_EXPIRE_EN =
  "The verification has expired or was already used. Enter your email and password again.";
const MESSAGE_CODE_INVALIDE_EN =
  "Incorrect code. Check the time on your phone and enter the code currently displayed.";
const MESSAGE_SECOURS_INVALIDE_EN =
  "Backup code incorrect or already used. Each code can only be used once.";
const MESSAGE_TROP_DE_TENTATIVES_EN = "Too many attempts. Wait a few minutes before trying again.";
const MESSAGE_REPONSE_INATTENDUE_EN =
  "Unexpected response from the server. Try signing in again in a moment.";

/** Message d'erreur d'appel dans la langue de l'interface (l'API traduit ses propres messages). */
export function messageErreurLangue(e: unknown, langue: Langue = "fr"): string {
  return messageErreur(e, langue);
}

const estObjet = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/**
 * Pour `useFormulaire` (hors de ce territoire) : en anglais, remplace le message de repli français
 * par sa version anglaise ; en français, laisse le repli d'origine (`null`).
 */
export function messageSpecifiqueLangue(langue: Langue): (e: unknown) => string | null {
  return (e) => (langue === "en" ? messageErreurLangue(e, langue) : null);
}

/** Réponse de POST /api/auth/connexion, vérifiée avant usage. */
export type ReponseIdentifiants = { etape: "connecte" } | { etape: "2fa"; defi: string } | null;

export function lireReponseIdentifiants(corps: unknown): ReponseIdentifiants {
  if (!estObjet(corps)) return null;
  if (corps.ok === true && corps.etape === "connecte") return { etape: "connecte" };
  if (
    corps.ok === false &&
    corps.etape === "2fa_requise" &&
    typeof corps.defi === "string" &&
    corps.defi.length >= 20 &&
    corps.defi.length <= 200
  ) {
    return { etape: "2fa", defi: corps.defi };
  }
  return null;
}

/** Message affiché pour une erreur du second temps de la connexion. */
export function messageErreurCode(
  e: unknown,
  facteur: FacteurSaisi,
  langue: Langue = "fr",
): string {
  const t = creerTraduire(langue);
  if (e instanceof ErreurApi) {
    if (e.code === "CODE_2FA_INVALIDE")
      return facteur === "secours"
        ? t(MESSAGE_SECOURS_INVALIDE, MESSAGE_SECOURS_INVALIDE_EN)
        : t(MESSAGE_CODE_INVALIDE, MESSAGE_CODE_INVALIDE_EN);
    if (e.code === "TROP_DE_TENTATIVES" || e.statut === 429)
      return t(MESSAGE_TROP_DE_TENTATIVES, MESSAGE_TROP_DE_TENTATIVES_EN);
    if (e.code === "DEFI_2FA_INVALIDE") return t(MESSAGE_DEFI_EXPIRE, MESSAGE_DEFI_EXPIRE_EN);
    if (e.code === "REQUETE_INVALIDE")
      return facteur === "secours"
        ? t(
            "Code de secours invalide : 10 lettres ou chiffres, par exemple abcde-12345.",
            "Invalid backup code: 10 letters or digits, for example abcde-12345.",
          )
        : t(
            "Code invalide : saisissez les 6 chiffres affichés par votre application.",
            "Invalid code: enter the 6 digits shown by your app.",
          );
  }
  return messageErreurLangue(e, langue);
}

/** Transition pure de la connexion. Le défi n'est conservé que dans l'état renvoyé. */
export function transitionConnexion(
  etat: EtatConnexion,
  ev: EvenementConnexion,
  langue: Langue = "fr",
): EtatConnexion {
  const t = creerTraduire(langue);
  switch (ev.type) {
    case "reponse_identifiants": {
      const r = lireReponseIdentifiants(ev.corps);
      if (r === null)
        return {
          etape: "identifiants",
          message: t(MESSAGE_REPONSE_INATTENDUE, MESSAGE_REPONSE_INATTENDUE_EN),
        };
      if (r.etape === "connecte") return { etape: "connecte" };
      return { etape: "code", defi: r.defi, facteur: "totp", message: null };
    }
    case "reponse_code":
      return etat.etape === "code" ? { etape: "connecte" } : etat;
    case "erreur_code": {
      if (etat.etape !== "code") return etat;
      const e = ev.erreur;
      // Défi expiré, consommé ou plafonné : retour au formulaire, le défi est oublié.
      if (e instanceof ErreurApi && e.code === "DEFI_2FA_INVALIDE") {
        return { etape: "identifiants", message: t(MESSAGE_DEFI_EXPIRE, MESSAGE_DEFI_EXPIRE_EN) };
      }
      return { ...etat, message: messageErreurCode(e, etat.facteur, langue) };
    }
    case "changer_facteur":
      return etat.etape === "code"
        ? { ...etat, facteur: etat.facteur === "totp" ? "secours" : "totp", message: null }
        : etat;
    case "abandonner":
      return ETAT_INITIAL;
  }
}

// --- Saisie des codes ----------------------------------------------------------------------

/** Code TOTP saisi → 6 chiffres (espaces tolérés), comme l'API. */
export function normaliserCodeTotp(v: string): string | null {
  const c = v.replace(/\s/g, "");
  return /^\d{6}$/.test(c) ? c : null;
}

/** Code de secours « abcde-12345 » (tirets, espaces et casse tolérés). */
export function normaliserCodeSecours(v: string): string | null {
  const c = v.replace(/[\s-]/g, "").toLowerCase();
  return /^[a-z0-9]{10}$/.test(c) ? c : null;
}

export const ERREUR_CODE_TOTP_VIDE = "Saisissez le code à 6 chiffres de votre application.";
export const ERREUR_CODE_TOTP = "Le code comporte exactement 6 chiffres.";
export const ERREUR_SECOURS_VIDE = "Saisissez l'un de vos codes de secours.";
export const ERREUR_SECOURS = "Un code de secours comporte 10 lettres ou chiffres (abcde-12345).";
const ERREUR_CODE_TOTP_VIDE_EN = "Enter the 6-digit code from your app.";
const ERREUR_CODE_TOTP_EN = "The code has exactly 6 digits.";
const ERREUR_SECOURS_VIDE_EN = "Enter one of your backup codes.";
const ERREUR_SECOURS_EN = "A backup code has 10 letters or digits (abcde-12345).";

export type ChargeFacteur = { code: string } | { code_secours: string };

/** Valide le code saisi selon le facteur choisi : exactement l'un des deux champs. */
export function validerFacteur(
  saisie: string,
  facteur: FacteurSaisi,
  langue: Langue = "fr",
): Resultat<ChargeFacteur, "code"> {
  const t = creerTraduire(langue);
  if (saisie.trim() === "") {
    return {
      ok: false,
      erreurs: {
        code:
          facteur === "totp"
            ? t(ERREUR_CODE_TOTP_VIDE, ERREUR_CODE_TOTP_VIDE_EN)
            : t(ERREUR_SECOURS_VIDE, ERREUR_SECOURS_VIDE_EN),
      },
    };
  }
  if (facteur === "totp") {
    const code = normaliserCodeTotp(saisie);
    return code
      ? { ok: true, charge: { code } }
      : { ok: false, erreurs: { code: t(ERREUR_CODE_TOTP, ERREUR_CODE_TOTP_EN) } };
  }
  const code = normaliserCodeSecours(saisie);
  return code
    ? { ok: true, charge: { code_secours: code } }
    : { ok: false, erreurs: { code: t(ERREUR_SECOURS, ERREUR_SECOURS_EN) } };
}

/** Corps de POST /api/auth/connexion/2fa. */
export function chargeConnexion2fa(defi: string, facteur: ChargeFacteur) {
  return { defi, ...facteur };
}

export type ChampConfirmation = "mot_de_passe" | "code";

/** Désactivation et régénération : mot de passe ET second facteur. */
export function validerConfirmation(
  s: {
    motDePasse: string;
    code: string;
    facteur: FacteurSaisi;
  },
  langue: Langue = "fr",
): Resultat<{ mot_de_passe: string } & ChargeFacteur, ChampConfirmation> {
  const t = creerTraduire(langue);
  const erreurs: Partial<Record<ChampConfirmation, string>> = {};
  if (s.motDePasse === "")
    erreurs.mot_de_passe = t("Saisissez votre mot de passe.", "Enter your password.");
  else if (s.motDePasse.length > 200)
    erreurs.mot_de_passe = t(
      "Le mot de passe ne doit pas dépasser 200 caractères.",
      "The password must not exceed 200 characters.",
    );
  const f = validerFacteur(s.code, s.facteur, langue);
  if (!f.ok) erreurs.code = f.erreurs.code;
  if (Object.keys(erreurs).length > 0 || !f.ok) return { ok: false, erreurs };
  return { ok: true, charge: { mot_de_passe: s.motDePasse, ...f.charge } };
}

export function validerMotDePasse(
  v: string,
  langue: Langue = "fr",
): Resultat<{ mot_de_passe: string }, "mot_de_passe"> {
  const t = creerTraduire(langue);
  if (v === "")
    return {
      ok: false,
      erreurs: { mot_de_passe: t("Saisissez votre mot de passe.", "Enter your password.") },
    };
  if (v.length > 200)
    return {
      ok: false,
      erreurs: {
        mot_de_passe: t(
          "Le mot de passe ne doit pas dépasser 200 caractères.",
          "The password must not exceed 200 characters.",
        ),
      },
    };
  return { ok: true, charge: { mot_de_passe: v } };
}

/** Message d'une erreur de gestion de sa 2FA, avec repli traduit pour `useFormulaire`. */
export function messageSpecifiqueGestion(
  facteur: FacteurSaisi,
  langue: Langue,
): (e: unknown) => string | null {
  return (e) => messageErreurGestion(e, facteur, langue) ?? messageSpecifiqueLangue(langue)(e);
}

/** Message d'une erreur de gestion de sa 2FA (mot de passe, code, état). */
export function messageErreurGestion(
  e: unknown,
  facteur: FacteurSaisi = "totp",
  langue: Langue = "fr",
): string | null {
  if (!(e instanceof ErreurApi)) return null;
  const t = creerTraduire(langue);
  switch (e.code) {
    case "MOT_DE_PASSE_INVALIDE":
      return t("Mot de passe incorrect.", "Incorrect password.");
    case "CODE_2FA_INVALIDE":
      return facteur === "secours"
        ? t(MESSAGE_SECOURS_INVALIDE, MESSAGE_SECOURS_INVALIDE_EN)
        : t(MESSAGE_CODE_INVALIDE, MESSAGE_CODE_INVALIDE_EN);
    case "TROP_DE_TENTATIVES":
      return t(MESSAGE_TROP_DE_TENTATIVES, MESSAGE_TROP_DE_TENTATIVES_EN);
    case "TFA_NON_INITIALISEE":
      return t(
        "La configuration a expiré. Recommencez l'activation depuis le début.",
        "The setup has expired. Start the activation again from the beginning.",
      );
    case "TFA_INACTIVE":
      return t(
        "La double authentification n'est pas active sur votre compte.",
        "Two-factor authentication is not active on your account.",
      );
    case "TFA_OBLIGATOIRE":
      return t(
        "La double authentification est obligatoire pour votre rôle : elle ne peut pas être désactivée.",
        "Two-factor authentication is required for your role: it cannot be turned off.",
      );
    case "CONFIRMATION_REQUISE":
      return t(
        "Confirmez votre identité : mot de passe et code de vérification.",
        "Confirm your identity: password and verification code.",
      );
    case "CONFLIT":
      return e.message;
    default:
      return null;
  }
}

// --- Reconfirmation d'identité (actions à fort impact) --------------------------------------

/**
 * L'API demande une reconfirmation (403 CONFIRMATION_REQUISE) avant une action à fort impact
 * (politique 2FA, réinitialisation d'une 2FA, coordonnées bancaires) : l'interface affiche
 * alors les champs de confirmation et renvoie la même demande avec eux.
 */
export const confirmationDemandee = (e: unknown) =>
  e instanceof ErreurApi && e.code === "CONFIRMATION_REQUISE";

export interface SaisieConfirmation {
  motDePasse: string;
  code: string;
  facteur: FacteurSaisi;
}

export const SAISIE_CONFIRMATION_VIDE: SaisieConfirmation = {
  motDePasse: "",
  code: "",
  facteur: "totp",
};

/**
 * Champs de reconfirmation joints au corps : mot de passe obligatoire ; code facultatif (sans
 * 2FA active, l'API se contente du mot de passe là où elle le permet, sinon elle refuse).
 */
export function validerReconfirmation(
  s: SaisieConfirmation,
  langue: Langue = "fr",
): Resultat<{ mot_de_passe: string } & Partial<ChargeFacteur>, ChampConfirmation> {
  const mdp = validerMotDePasse(s.motDePasse, langue);
  const erreurs: Partial<Record<ChampConfirmation, string>> = mdp.ok ? {} : { ...mdp.erreurs };
  const f = s.code.trim() === "" ? null : validerFacteur(s.code, s.facteur, langue);
  if (f && !f.ok) erreurs.code = f.erreurs.code;
  if (!mdp.ok || (f && !f.ok)) return { ok: false, erreurs };
  return { ok: true, charge: { mot_de_passe: s.motDePasse, ...(f?.ok ? f.charge : {}) } };
}

/** Message d'un refus d'action à fort impact (reconfirmation, 2FA de l'auteur inactive). */
export function messageReconfirmation(
  e: unknown,
  facteur: FacteurSaisi,
  langue: Langue = "fr",
): string | null {
  if (e instanceof ErreurApi && e.code === "TFA_INACTIVE")
    return creerTraduire(langue)(
      "Activez d'abord votre propre double authentification (Sécurité du compte) : cette action l'exige.",
      "First turn on your own two-factor authentication (Account security): this action requires it.",
    );
  return messageErreurGestion(e, facteur, langue);
}

// --- État et affichage ---------------------------------------------------------------------

/** Réponse de GET /api/auth/2fa. */
export interface EtatTfa {
  active: boolean;
  activee_le: string | null;
  codes_secours_restants: number;
  obligatoire: boolean;
  a_configurer: boolean;
}

/** Réponse de GET/PUT /api/auth/2fa/politique. */
export interface PolitiqueTfa {
  roles_obligatoires: RoleTfaSensible[];
  roles_sensibles: RoleTfaSensible[];
  roles_obligatoires_effectifs: RoleTfaSensible[];
  plancher_plateforme: boolean;
}

export const OPTIONS_ROLES_SENSIBLES = ROLES_TFA_SENSIBLES.map((r) => ({
  valeur: r,
  libelle: ROLE_LIBELLES[r],
}));

/** Options des rôles sensibles, libellées dans la langue de l'interface. */
export function optionsRolesSensibles(langue: Langue = "fr") {
  return ROLES_TFA_SENSIBLES.map((r) => ({ valeur: r, libelle: libelleRole(r, langue) }));
}

/** Ne garde que des rôles sensibles connus, sans doublon, dans l'ordre de la table. */
export function rolesPolitique(roles: readonly string[]): RoleTfaSensible[] {
  return ROLES_TFA_SENSIBLES.filter((r) => roles.includes(r));
}

/** Clé du secret présentée par groupes de 4 pour une saisie manuelle. */
export function grouperSecret(secret: string): string {
  return (secret.replace(/\s/g, "").match(/.{1,4}/g) ?? []).join(" ");
}

/** Contenu du fichier texte des codes de secours (téléchargement). */
export function texteCodesSecours(
  codes: readonly string[],
  email: string,
  date: string,
  langue: Langue = "fr",
): string {
  const t = creerTraduire(langue);
  return [
    t(
      "CabinetPilot — codes de secours de la double authentification",
      "CabinetPilot — two-factor authentication backup codes",
    ),
    t(`Compte : ${email}`, `Account: ${email}`),
    t(`Générés le : ${date}`, `Generated on: ${date}`),
    "",
    t(
      "Chaque code ne sert qu'une fois. Conservez-les dans un endroit sûr, hors de votre téléphone.",
      "Each code can only be used once. Keep them in a safe place, away from your phone.",
    ),
    "",
    ...codes.map((c, i) => `${String(i + 1).padStart(2, " ")}. ${c}`),
    "",
  ].join("\n");
}

/** Une réinitialisation de la 2FA ne s'applique jamais à soi-même (désactiver depuis son compte). */
export const peutReinitialiserTfa = (cibleId: string, moiId: string, tfaActive: boolean) =>
  cibleId !== moiId && tfaActive;

/** Joint la reconfirmation (si demandée) à une charge validée ; erreurs des deux réunies. */
export function avecReconfirmation<C extends object, K extends string>(
  v: Resultat<C, K>,
  confirmation: SaisieConfirmation | null,
  langue: Langue = "fr",
): Resultat<C & Partial<{ mot_de_passe: string } & ChargeFacteur>, K | ChampConfirmation> {
  if (confirmation === null)
    return v as Resultat<
      C & Partial<{ mot_de_passe: string } & ChargeFacteur>,
      K | ChampConfirmation
    >;
  const c = validerReconfirmation(confirmation, langue);
  if (v.ok && c.ok) return { ok: true, charge: { ...v.charge, ...c.charge } };
  return {
    ok: false,
    erreurs: { ...(v.ok ? {} : v.erreurs), ...(c.ok ? {} : c.erreurs) } as Partial<
      Record<K | ChampConfirmation, string>
    >,
  };
}
