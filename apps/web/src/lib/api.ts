/**
 * Client d'API typé, utilisable côté navigateur et côté serveur.
 *
 * - Navigateur : chemins relatifs (`/api/...`), relayés vers l'API par les réécritures de
 *   `next.config.mjs` ; le cookie de session httpOnly part tout seul (`credentials`).
 * - Serveur : passer `baseUrl` et `cookie` (voir `api-serveur.ts`, qui le fait pour vous).
 *
 * Toute réponse non 2xx devient une `ErreurApi` construite depuis l'enveloppe
 * `{ erreur: { code, message, details? } }` de l'API.
 */

import type { Langue } from "@missionpilot/shared";
import { langueNavigateur } from "./langue-navigateur";

export { langueNavigateur };

export const MESSAGE_RESEAU =
  "Connexion au serveur impossible. Vérifiez votre réseau puis réessayez.";
export const MESSAGE_DELAI =
  "Le serveur met trop de temps à répondre. Vérifiez votre réseau puis réessayez.";
export const MESSAGE_SERVICE_INDISPONIBLE =
  "Le service CabinetPilot est momentanément indisponible. Réessayez dans quelques instants.";
export const MESSAGE_INATTENDU = "Une erreur inattendue est survenue. Réessayez dans un instant.";

/** Versions anglaises des messages ci-dessus (les constantes françaises restent la référence). */
export const MESSAGE_RESEAU_EN = "Cannot reach the server. Check your network and try again.";
export const MESSAGE_DELAI_EN =
  "The server is taking too long to respond. Check your network and try again.";
export const MESSAGE_SERVICE_INDISPONIBLE_EN =
  "The CabinetPilot service is temporarily unavailable. Try again in a few moments.";
export const MESSAGE_INATTENDU_EN = "An unexpected error occurred. Try again in a moment.";
export const MESSAGE_TFA_A_CONFIGURER_EN =
  'Two-factor authentication is required for your role: enable it from "Account security" to continue.';
export const MESSAGE_ORIGINE_REFUSEE_EN =
  "Request refused: open CabinetPilot at its usual address (the one given by your administrator) and try again.";

/** Message réseau (`messageReseau(langue)`) et ses semblables, dans la langue demandée. */
export const messageReseau = (langue: Langue = "fr") =>
  langue === "en" ? MESSAGE_RESEAU_EN : MESSAGE_RESEAU;
export const messageDelai = (langue: Langue = "fr") =>
  langue === "en" ? MESSAGE_DELAI_EN : MESSAGE_DELAI;
export const messageServiceIndisponible = (langue: Langue = "fr") =>
  langue === "en" ? MESSAGE_SERVICE_INDISPONIBLE_EN : MESSAGE_SERVICE_INDISPONIBLE;
export const messageInattendu = (langue: Langue = "fr") =>
  langue === "en" ? MESSAGE_INATTENDU_EN : MESSAGE_INATTENDU;

export class ErreurApi extends Error {
  readonly code: string;
  /** Statut HTTP ; 0 quand la requête n'a pas abouti (réseau, délai). */
  readonly statut: number;
  readonly details?: unknown;

  constructor(code: string, message: string, statut: number, details?: unknown) {
    super(message);
    this.name = "ErreurApi";
    this.code = code;
    this.statut = statut;
    this.details = details;
  }
}

function estObjet(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** Construit l'erreur à partir du statut et du corps JSON (déjà lu) d'une réponse en échec. */
export function erreurDepuisReponse(
  statut: number,
  corps: unknown,
  langue: Langue = langueNavigateur(),
): ErreurApi {
  const en = langue === "en";
  const enveloppe = estObjet(corps) ? corps.erreur : undefined;
  if (estObjet(enveloppe) && typeof enveloppe.code === "string") {
    const message =
      typeof enveloppe.message === "string" && enveloppe.message.trim() !== ""
        ? enveloppe.message
        : messageInattendu(langue);
    return new ErreurApi(enveloppe.code, message, statut, enveloppe.details);
  }
  if (statut === 401) {
    return new ErreurApi(
      "NON_AUTHENTIFIE",
      en ? "Your session has expired. Sign in again." : "Votre session a expiré. Reconnectez-vous.",
      statut,
    );
  }
  if (statut === 403) {
    return new ErreurApi(
      "ACCES_REFUSE",
      en ? "You do not have access to this resource." : "Vous n'avez pas accès à cette ressource.",
      statut,
    );
  }
  if (statut === 404) {
    return new ErreurApi(
      "INTROUVABLE",
      en ? "Resource not found." : "Ressource introuvable.",
      statut,
    );
  }
  if (statut >= 500) {
    // Réponse sans enveloppe : relais ou API injoignable (l'API répond toujours avec l'enveloppe).
    return new ErreurApi("SERVICE_INDISPONIBLE", messageServiceIndisponible(langue), statut);
  }
  return new ErreurApi("ERREUR_INATTENDUE", messageInattendu(langue), statut);
}

export interface OptionsAppel {
  methode?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Sérialisé en JSON. */
  corps?: unknown;
  /** Origine de l'API pour un appel serveur (ex. `http://localhost:4100`). Vide côté navigateur. */
  baseUrl?: string;
  /** En-tête `Cookie` à transmettre (appel serveur uniquement). */
  cookie?: string;
  /** Côté navigateur : aller sur /connexion si l'API répond 401. Vrai par défaut. */
  redirigerSi401?: boolean;
  /** Délai maximal avant abandon, en millisecondes (15 s par défaut, adapté à la 3G). */
  delaiMs?: number;
  /** En-têtes supplémentaires (ex. `Idempotency-Key` du rejeu hors ligne). */
  entetes?: Record<string, string>;
  signal?: AbortSignal;
}

const DELAI_DEFAUT_MS = 15_000;

async function lireJson(reponse: Response): Promise<unknown> {
  const texte = await reponse.text();
  if (texte === "") return undefined;
  try {
    return JSON.parse(texte) as unknown;
  } catch {
    return undefined;
  }
}

/** Navigateurs anciens (fréquents sur les téléphones d'entrée de gamme) : repli sans délai. */
function signalAvecDelai(delaiMs: number, signal?: AbortSignal): AbortSignal | undefined {
  if (typeof AbortSignal.timeout !== "function") return signal;
  const delai = AbortSignal.timeout(delaiMs);
  if (!signal) return delai;
  return typeof AbortSignal.any === "function" ? AbortSignal.any([signal, delai]) : signal;
}

function rendreErreurReseau(e: unknown): ErreurApi {
  const langue = langueNavigateur();
  if (e instanceof DOMException && e.name === "TimeoutError") {
    return new ErreurApi("DELAI_DEPASSE", messageDelai(langue), 0);
  }
  if (e instanceof DOMException && e.name === "AbortError") {
    return new ErreurApi("ANNULE", langue === "en" ? "Request cancelled." : "Requête annulée.", 0);
  }
  return new ErreurApi("RESEAU_INDISPONIBLE", messageReseau(langue), 0);
}

function redirigerVersConnexion(): void {
  if (typeof window === "undefined") return;
  if (window.location.pathname === "/connexion") return;
  const suite = window.location.pathname + window.location.search;
  window.location.assign(`/connexion?suite=${encodeURIComponent(suite)}`);
}

export async function appelerApi<T>(chemin: string, options: OptionsAppel = {}): Promise<T> {
  const { methode = "GET", corps, baseUrl = "", cookie, redirigerSi401 = true } = options;
  const entetes: Record<string, string> = { Accept: "application/json" };
  if (corps !== undefined) entetes["Content-Type"] = "application/json";
  if (cookie) entetes.Cookie = cookie;
  Object.assign(entetes, options.entetes);

  let reponse: Response;
  try {
    reponse = await fetch(`${baseUrl}${chemin}`, {
      method: methode,
      headers: entetes,
      body: corps === undefined ? undefined : JSON.stringify(corps),
      credentials: "same-origin",
      cache: "no-store",
      signal: signalAvecDelai(options.delaiMs ?? DELAI_DEFAUT_MS, options.signal),
    });
  } catch (e) {
    throw rendreErreurReseau(e);
  }

  const donnees = await lireJson(reponse);
  if (!reponse.ok) {
    const erreur = erreurDepuisReponse(reponse.status, donnees);
    if (reponse.status === 401 && redirigerSi401) redirigerVersConnexion();
    throw erreur;
  }
  return donnees as T;
}

export const api = {
  get: <T>(chemin: string, options?: Omit<OptionsAppel, "methode" | "corps">) =>
    appelerApi<T>(chemin, { ...options, methode: "GET" }),
  post: <T>(chemin: string, corps?: unknown, options?: Omit<OptionsAppel, "methode" | "corps">) =>
    appelerApi<T>(chemin, { ...options, methode: "POST", corps }),
  patch: <T>(chemin: string, corps: unknown, options?: Omit<OptionsAppel, "methode" | "corps">) =>
    appelerApi<T>(chemin, { ...options, methode: "PATCH", corps }),
  put: <T>(chemin: string, corps: unknown, options?: Omit<OptionsAppel, "methode" | "corps">) =>
    appelerApi<T>(chemin, { ...options, methode: "PUT", corps }),
  supprimer: (chemin: string, options?: Omit<OptionsAppel, "methode" | "corps">) =>
    appelerApi<void>(chemin, { ...options, methode: "DELETE" }),
};

/** Détails de validation renvoyés par l'API (`ZodError.flatten()`). */
interface DetailsValidation {
  fieldErrors?: Record<string, unknown>;
  formErrors?: unknown;
}

/**
 * Noms des champs refusés par l'API (erreur REQUETE_INVALIDE). Les messages bruts de la
 * validation serveur ne sont pas affichés : ils peuvent être en anglais.
 */
export function champsRefuses(e: unknown): string[] {
  if (!(e instanceof ErreurApi) || e.code !== "REQUETE_INVALIDE") return [];
  const details = e.details as DetailsValidation | undefined;
  if (!details || typeof details !== "object" || !details.fieldErrors) return [];
  return Object.keys(details.fieldErrors);
}

/** Code de l'API : la politique du cabinet exige la double authentification avant tout accès. */
export const CODE_TFA_A_CONFIGURER = "TFA_A_CONFIGURER";
export const MESSAGE_TFA_A_CONFIGURER =
  "La double authentification est obligatoire pour votre rôle : activez-la depuis « Sécurité du compte » pour continuer.";

/** Code de l'API : la requête vient d'une autre adresse que celle du web (garde d'origine). */
export const CODE_ORIGINE_REFUSEE = "ORIGINE_REFUSEE";
export const MESSAGE_ORIGINE_REFUSEE =
  "Requête refusée : ouvrez CabinetPilot à son adresse habituelle (celle indiquée par votre administrateur) puis réessayez.";

/**
 * Message d'erreur affichable pour une erreur d'appel : français par défaut, anglais si la
 * langue (par défaut celle du cookie du navigateur) est "en".
 */
export function messageErreur(e: unknown, langue: Langue = langueNavigateur()): string {
  const en = langue === "en";
  if (!(e instanceof ErreurApi)) return messageInattendu(langue);
  if (e.code === CODE_TFA_A_CONFIGURER) {
    return en ? MESSAGE_TFA_A_CONFIGURER_EN : MESSAGE_TFA_A_CONFIGURER;
  }
  if (e.code === CODE_ORIGINE_REFUSEE) {
    return en ? MESSAGE_ORIGINE_REFUSEE_EN : MESSAGE_ORIGINE_REFUSEE;
  }
  if (
    e.code === "REQUETE_INVALIDE" &&
    (e.message === "Données invalides." || e.message === "Invalid data.")
  ) {
    return en
      ? "Some values were rejected. Check the flagged fields and try again."
      : "Certaines valeurs ont été refusées. Vérifiez les champs signalés puis réessayez.";
  }
  if (e.statut === 403) {
    return en
      ? "Your role does not allow you to perform this action."
      : "Votre rôle ne vous permet pas d'effectuer cette action.";
  }
  return e.message;
}
