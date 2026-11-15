/** IA : clé API, plafond mensuel (micro-dollars US) et reconfirmation d'identité. */
import {
  cleApiIaSchema,
  creerTraduire,
  LOCALES_INTL,
  PLAFOND_IA_MAX_MICRO_USD,
  type Langue,
} from "@missionpilot/shared";
import {
  validerReconfirmation,
  type ChampConfirmation,
  type ChargeFacteur,
  type SaisieConfirmation,
} from "./double-authentification";
import type { ParametresIa } from "./ia-parametres";
import { lireNombre, type Resultat } from "./saisie";

// --- Clé API ---------------------------------------------------------------------------------

export const ERREUR_CLE_VIDE = "Saisissez la clé API fournie par OpenRouter.";
export const ERREUR_CLE_FORMAT =
  "Clé API : 20 à 200 lettres, chiffres, tirets ou tirets bas, sans espace.";
export const ERREUR_CLE_VIDE_EN = "Enter the API key provided by OpenRouter.";
export const ERREUR_CLE_FORMAT_EN =
  "API key: 20 to 200 letters, digits, hyphens or underscores, no spaces.";

/** Clé saisie (copier-coller : espaces de bord retirés). */
export function validerCleApi(
  saisie: string,
  langue: Langue = "fr",
): Resultat<{ cle_api: string }, "cle_api"> {
  const en = langue === "en";
  const cle = saisie.trim();
  if (cle === "") {
    return { ok: false, erreurs: { cle_api: en ? ERREUR_CLE_VIDE_EN : ERREUR_CLE_VIDE } };
  }
  const r = cleApiIaSchema.safeParse(cle);
  if (!r.success) {
    return { ok: false, erreurs: { cle_api: en ? ERREUR_CLE_FORMAT_EN : ERREUR_CLE_FORMAT } };
  }
  return { ok: true, charge: { cle_api: r.data } };
}

// --- Plafond mensuel (micro-dollars US) ------------------------------------------------------

const MICRO_PAR_USD = 1_000_000;
const NBSP = "\u00a0";

/** 8100 µUSD → « 0,0081 $US » ; 50 000 000 → « 50,00 $US ». Mise en forme seulement. */
export function formaterMicroUsd(micro: number | null | undefined, langue: Langue = "fr"): string {
  if (typeof micro !== "number" || !Number.isFinite(micro)) return "—";
  const usd = micro / MICRO_PAR_USD;
  const petit = usd !== 0 && Math.abs(usd) < 0.01;
  const nombre = new Intl.NumberFormat(LOCALES_INTL[langue], {
    minimumFractionDigits: 2,
    maximumFractionDigits: petit ? 6 : 2,
  }).format(usd);
  return `${nombre}${NBSP}${langue === "en" ? "USD" : "$US"}`;
}

/** Plafond de l'API → texte modifiable (« 50 », « 49,9 »). */
export function plafondVersSaisie(micro: number | null | undefined): string {
  if (typeof micro !== "number" || !Number.isFinite(micro)) return "";
  return String(micro / MICRO_PAR_USD).replace(".", ",");
}

export const ERREUR_PLAFOND_VIDE =
  "Saisissez un plafond en dollars US (0 bloque tout appel facturé).";
export const ERREUR_PLAFOND_FORMAT =
  "Plafond invalide : nombre positif, deux décimales au plus (ex. 50 ou 49,90).";
export const ERREUR_PLAFOND_MAX = "Le plafond mensuel est limité à 100 000 $US.";
export const ERREUR_PLAFOND_VIDE_EN = "Enter a ceiling in US dollars (0 blocks any billed call).";
export const ERREUR_PLAFOND_FORMAT_EN =
  "Invalid ceiling: positive number, two decimals at most (e.g. 50 or 49.90).";
export const ERREUR_PLAFOND_MAX_EN = "The monthly ceiling is limited to 100,000 USD.";

/** Plafond saisi en dollars US → micro-dollars entiers attendus par l'API. */
export function lirePlafond(
  saisie: string,
  langue: Langue = "fr",
): Resultat<{ plafond_mensuel_micro_usd: number }, "plafond"> {
  const en = langue === "en";
  const n = lireNombre(saisie);
  if (n === null) {
    return { ok: false, erreurs: { plafond: en ? ERREUR_PLAFOND_VIDE_EN : ERREUR_PLAFOND_VIDE } };
  }
  const format = en ? ERREUR_PLAFOND_FORMAT_EN : ERREUR_PLAFOND_FORMAT;
  if (Number.isNaN(n) || n < 0) return { ok: false, erreurs: { plafond: format } };
  const centimes = Math.round(n * 100);
  if (Math.abs(n * 100 - centimes) > 1e-6) {
    return { ok: false, erreurs: { plafond: format } };
  }
  const micro = centimes * (MICRO_PAR_USD / 100);
  if (!Number.isSafeInteger(micro) || micro > PLAFOND_IA_MAX_MICRO_USD) {
    return { ok: false, erreurs: { plafond: en ? ERREUR_PLAFOND_MAX_EN : ERREUR_PLAFOND_MAX } };
  }
  return { ok: true, charge: { plafond_mensuel_micro_usd: micro } };
}

/** Le plafond appliqué diffère de celui du cabinet (borné par l'opérateur de la plateforme). */
export function plafondBorne(
  p: Pick<ParametresIa, "plafond_mensuel_micro_usd" | "plafond_effectif_micro_usd">,
): boolean {
  return (
    typeof p.plafond_effectif_micro_usd === "number" &&
    typeof p.plafond_mensuel_micro_usd === "number" &&
    p.plafond_effectif_micro_usd !== p.plafond_mensuel_micro_usd
  );
}

/**
 * Limite de l'opérateur, affichée quand les appels passent par la clé de la plateforme (null
 * sinon, ou si l'API ne la publie pas).
 */
export function textePlafondPlateforme(
  p: Pick<
    ParametresIa,
    | "source_cle"
    | "plafond_mensuel_micro_usd"
    | "plafond_plateforme_micro_usd"
    | "plafond_effectif_micro_usd"
  >,
  langue: Langue = "fr",
): string | null {
  if (p.source_cle !== "plateforme" || typeof p.plafond_plateforme_micro_usd !== "number") {
    return null;
  }
  const t = creerTraduire(langue);
  const limite = t(
    `Avec la clé de la plateforme, l'opérateur limite le plafond à ${formaterMicroUsd(p.plafond_plateforme_micro_usd)} par mois`,
    `With the platform key, the operator limits the ceiling to ${formaterMicroUsd(p.plafond_plateforme_micro_usd, langue)} per month`,
  );
  return plafondBorne(p)
    ? t(
        `${limite} : le plafond appliqué est donc de ${formaterMicroUsd(p.plafond_effectif_micro_usd)}, quel que soit celui du cabinet.`,
        `${limite}: the ceiling applied is therefore ${formaterMicroUsd(p.plafond_effectif_micro_usd, langue)}, whatever the firm's ceiling.`,
      )
    : t(
        `${limite} ; le plafond du cabinet reste en deçà et s'applique.`,
        `${limite}; the firm's ceiling stays below it and applies.`,
      );
}

/** Une hausse du plafond engage une dépense : l'API redemande l'identité de l'auteur. */
export const hausseDePlafond = (nouveau: number, actuel: number | null | undefined) =>
  nouveau > (actuel ?? 0);

// --- Reconfirmation d'identité (clé API, hausse du plafond) ----------------------------------

/** Bloc `confirmation` de PUT /api/ia/parametres : mot de passe et, si la 2FA est active, code. */
export type ConfirmationIa = { mot_de_passe: string } & Partial<ChargeFacteur>;

/**
 * Joint la reconfirmation saisie à une modification validée ; erreurs des deux réunies.
 * `saisie` null : aucune reconfirmation demandée pour ce changement.
 */
export function avecConfirmationIa<C extends object, K extends string>(
  v: Resultat<C, K>,
  saisie: SaisieConfirmation | null,
): Resultat<C & { confirmation?: ConfirmationIa }, K | ChampConfirmation> {
  if (saisie === null) {
    return v as Resultat<C & { confirmation?: ConfirmationIa }, K | ChampConfirmation>;
  }
  const c = validerReconfirmation(saisie);
  if (v.ok && c.ok) return { ok: true, charge: { ...v.charge, confirmation: c.charge } };
  return {
    ok: false,
    erreurs: { ...(v.ok ? {} : v.erreurs), ...(c.ok ? {} : c.erreurs) } as Partial<
      Record<K | ChampConfirmation, string>
    >,
  };
}
