/** IA : clé API, plafond mensuel (micro-dollars US) et reconfirmation d'identité. */
import { cleApiIaSchema, PLAFOND_IA_MAX_MICRO_USD } from "@missionpilot/shared";
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

/** Clé saisie (copier-coller : espaces de bord retirés). */
export function validerCleApi(saisie: string): Resultat<{ cle_api: string }, "cle_api"> {
  const cle = saisie.trim();
  if (cle === "") return { ok: false, erreurs: { cle_api: ERREUR_CLE_VIDE } };
  const r = cleApiIaSchema.safeParse(cle);
  if (!r.success) return { ok: false, erreurs: { cle_api: ERREUR_CLE_FORMAT } };
  return { ok: true, charge: { cle_api: r.data } };
}

// --- Plafond mensuel (micro-dollars US) ------------------------------------------------------

const MICRO_PAR_USD = 1_000_000;
const NBSP = "\u00a0";

/** 8100 µUSD → « 0,0081 $US » ; 50 000 000 → « 50,00 $US ». Mise en forme seulement. */
export function formaterMicroUsd(micro: number | null | undefined): string {
  if (typeof micro !== "number" || !Number.isFinite(micro)) return "—";
  const usd = micro / MICRO_PAR_USD;
  const petit = usd !== 0 && Math.abs(usd) < 0.01;
  const nombre = new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: petit ? 6 : 2,
  }).format(usd);
  return `${nombre}${NBSP}$US`;
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

/** Plafond saisi en dollars US → micro-dollars entiers attendus par l'API. */
export function lirePlafond(
  saisie: string,
): Resultat<{ plafond_mensuel_micro_usd: number }, "plafond"> {
  const n = lireNombre(saisie);
  if (n === null) return { ok: false, erreurs: { plafond: ERREUR_PLAFOND_VIDE } };
  if (Number.isNaN(n) || n < 0) return { ok: false, erreurs: { plafond: ERREUR_PLAFOND_FORMAT } };
  const centimes = Math.round(n * 100);
  if (Math.abs(n * 100 - centimes) > 1e-6) {
    return { ok: false, erreurs: { plafond: ERREUR_PLAFOND_FORMAT } };
  }
  const micro = centimes * (MICRO_PAR_USD / 100);
  if (!Number.isSafeInteger(micro) || micro > PLAFOND_IA_MAX_MICRO_USD) {
    return { ok: false, erreurs: { plafond: ERREUR_PLAFOND_MAX } };
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
): string | null {
  if (p.source_cle !== "plateforme" || typeof p.plafond_plateforme_micro_usd !== "number") {
    return null;
  }
  const limite = `Avec la clé de la plateforme, l'opérateur limite le plafond à ${formaterMicroUsd(p.plafond_plateforme_micro_usd)} par mois`;
  return plafondBorne(p)
    ? `${limite} : le plafond appliqué est donc de ${formaterMicroUsd(p.plafond_effectif_micro_usd)}, quel que soit celui du cabinet.`
    : `${limite} ; le plafond du cabinet reste en deçà et s'applique.`;
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
