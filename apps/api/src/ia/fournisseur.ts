import { z } from "zod";
import type { TacheIa } from "@missionpilot/shared";
import { estLocal, type Config } from "../config.js";

/*
 * Fournisseur de modèles de langage (ADR-003). Ce module est le SEUL de
 * l'application à appeler un modèle (PRD, « Architecture ») : tout appel
 * passe par l'interface `LlmProvider`, utilisée par l'orchestrateur.
 *
 * Implémentation OpenRouter par `fetch` (API compatible OpenAI), sans
 * dépendance :
 * - URL : `OPENROUTER_BASE_URL` de la configuration seule (jamais d'une
 *   requête : pas de SSRF), HTTPS hors machine locale, redirections refusées ;
 * - en-têtes d'authentification et d'attribution (HTTP-Referer, X-Title) ;
 * - `provider.data_collection = "deny"` : OpenRouter n'achemine la requête
 *   que vers des hébergeurs qui ne conservent ni n'entraînent sur les données
 *   (la clause contractuelle reste à vérifier par modèle, ADR-003) ;
 * - délai par `AbortSignal.timeout` ; reprise limitée (429, 5xx, panne
 *   réseau) avec attente exponentielle, `Retry-After` respecté et plafonné ;
 *   pas de reprise après un délai dépassé (l'appel a pu coûter) ;
 * - réponse plafonnée en taille, lue en flux ;
 * - journal SANS prompt, SANS clé, SANS contenu : tâche, modèle, durée,
 *   jetons, code. Aucune erreur levée ne cite la clé ni le corps échangé.
 */

export interface MessageLlm {
  role: "system" | "user";
  content: string;
}

export interface RequeteLlm {
  tache: TacheIa;
  modele: string;
  messages: readonly MessageLlm[];
  maxTokens: number;
  /** Sortie JSON attendue (`response_format: json_object`). */
  formatJson?: boolean;
  /** Clé API (cabinet ou plateforme) : jamais journalisée ni renvoyée. */
  cleApi: string;
}

export interface ReponseLlm {
  texte: string;
  /** Modèle effectivement servi (annoncé par le fournisseur), sinon celui demandé. */
  modele: string;
  tokensEntree: number;
  tokensSortie: number;
  /** Jetons estimés (le fournisseur n'a pas renvoyé `usage`). */
  tokensEstimes: boolean;
  dureeMs: number;
}

export interface LlmProvider {
  readonly nom: "openrouter";
  completer(requete: RequeteLlm): Promise<ReponseLlm>;
}

export type CodeErreurLlm =
  | "CLE_REFUSEE"
  | "CREDIT_FOURNISSEUR_INSUFFISANT"
  | "FOURNISSEUR_INDISPONIBLE"
  | "DELAI_DEPASSE"
  | "REQUETE_REFUSEE"
  | "REPONSE_INVALIDE"
  | "REPONSE_TROP_GRANDE";

const MESSAGES: Record<CodeErreurLlm, string> = {
  CLE_REFUSEE: "Le fournisseur d'IA a refusé la clé API.",
  CREDIT_FOURNISSEUR_INSUFFISANT: "Crédit insuffisant chez le fournisseur d'IA.",
  FOURNISSEUR_INDISPONIBLE: "Le fournisseur d'IA est indisponible pour le moment.",
  DELAI_DEPASSE: "Le fournisseur d'IA n'a pas répondu dans le délai imparti.",
  REQUETE_REFUSEE: "Le fournisseur d'IA a refusé la requête.",
  REPONSE_INVALIDE: "Réponse du fournisseur d'IA illisible.",
  REPONSE_TROP_GRANDE: "Réponse du fournisseur d'IA trop volumineuse.",
};

/** Erreur de fournisseur : message fixe, sans clé, sans corps ni détail du fournisseur. */
export class ErreurLlm extends Error {
  constructor(
    readonly code: CodeErreurLlm,
    /** Une nouvelle tentative plus tard peut réussir (file de jobs). */
    readonly reessayable: boolean,
    readonly statutHttp: number | null = null,
  ) {
    super(MESSAGES[code]);
    this.name = "ErreurLlm";
  }
}

/** Entrée de journal d'un appel : jamais de prompt, de clé ni de contenu. */
export interface EntreeJournalLlm {
  tache: TacheIa;
  modele: string;
  duree_ms: number;
  tokens_entree: number | null;
  tokens_sortie: number | null;
  statut_http: number | null;
  code: "OK" | CodeErreurLlm;
  tentatives: number;
}

export interface OptionsOpenRouter {
  baseUrl: string;
  timeoutMs: number;
  /** Attribution OpenRouter : site appelant (HTTP-Referer) et nom de l'application (X-Title). */
  referer?: string;
  titre?: string;
  /** Nombre total de tentatives (défaut 3). */
  tentativesMax?: number;
  /** Attente avant la 2e tentative (doublée ensuite ; défaut 500 ms). */
  delaiBaseMs?: number;
  /** Attente maximale entre deux tentatives, `Retry-After` compris (défaut 10 s). */
  delaiMaxMs?: number;
  /** Taille maximale d'une réponse, en octets (défaut 2 Mo). */
  tailleMaxOctets?: number;
  journal?: (entree: EntreeJournalLlm) => void;
  /** Injectables en test. */
  fetch?: typeof fetch;
  attendre?: (ms: number) => Promise<void>;
  horloge?: () => number;
}

const reponseSchema = z
  .object({
    model: z.string().max(200).optional(),
    choices: z
      .array(
        z
          .object({
            message: z.object({ content: z.string().nullable().optional() }).passthrough(),
          })
          .passthrough(),
      )
      .min(1),
    usage: z
      .object({
        prompt_tokens: z.number().int().nonnegative(),
        completion_tokens: z.number().int().nonnegative(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

/** Division entière arrondie au-dessus, sur des entiers positifs (sans arrondi flottant). */
export function diviserAuDessus(a: number, b: number): number {
  const r = a % b;
  return (a - r) / b + (r === 0 ? 0 : 1);
}

/** Estimation prudente des jetons d'un texte (≈ 3 caractères par jeton). */
export function estimerTokens(caracteres: number): number {
  return diviserAuDessus(Math.max(0, caracteres), 3);
}

const attendreParDefaut = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Lit le corps en flux et refuse au-delà de `max` octets. */
async function lireBorne(reponse: Response, max: number): Promise<string> {
  const annoncee = Number(reponse.headers.get("content-length") ?? "0");
  if (annoncee > max) {
    await reponse.body?.cancel().catch(() => undefined);
    throw new ErreurLlm("REPONSE_TROP_GRANDE", false, reponse.status);
  }
  if (!reponse.body) return "";
  const lecteur = reponse.body.getReader();
  const morceaux: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await lecteur.cancel().catch(() => undefined);
      throw new ErreurLlm("REPONSE_TROP_GRANDE", false, reponse.status);
    }
    morceaux.push(value);
  }
  return Buffer.concat(morceaux).toString("utf8");
}

/** Délai demandé par `Retry-After` (secondes), ou null. */
function delaiRetryAfter(reponse: Response): number | null {
  const v = reponse.headers.get("retry-after");
  if (!v || !/^\d{1,6}$/.test(v.trim())) return null;
  return Number(v.trim()) * 1000;
}

export function creerFournisseurOpenRouter(options: OptionsOpenRouter): LlmProvider {
  const base = options.baseUrl.replace(/\/+$/, "");
  const url = `${base}/chat/completions`;
  const tentativesMax = options.tentativesMax ?? 3;
  const delaiBase = options.delaiBaseMs ?? 500;
  const delaiMax = options.delaiMaxMs ?? 10_000;
  const tailleMax = options.tailleMaxOctets ?? 2 * 1024 * 1024;
  const appeler = options.fetch ?? fetch;
  const attendre = options.attendre ?? attendreParDefaut;
  const horloge = options.horloge ?? Date.now;
  const journal = options.journal ?? (() => undefined);

  return {
    nom: "openrouter",
    async completer(requete) {
      const corps = JSON.stringify({
        model: requete.modele,
        messages: requete.messages,
        max_tokens: requete.maxTokens,
        temperature: 0.2,
        stream: false,
        ...(requete.formatJson ? { response_format: { type: "json_object" } } : {}),
        provider: { data_collection: "deny" },
      });
      const entetes: Record<string, string> = {
        authorization: `Bearer ${requete.cleApi}`,
        "content-type": "application/json",
        accept: "application/json",
        "x-title": options.titre ?? "MissionPilot",
      };
      if (options.referer) entetes["http-referer"] = options.referer;

      const debut = horloge();
      const tracer = (
        code: EntreeJournalLlm["code"],
        statut: number | null,
        tentatives: number,
        tokens?: { entree: number; sortie: number },
      ) =>
        journal({
          tache: requete.tache,
          modele: requete.modele,
          duree_ms: Math.max(0, horloge() - debut),
          tokens_entree: tokens?.entree ?? null,
          tokens_sortie: tokens?.sortie ?? null,
          statut_http: statut,
          code,
          tentatives,
        });

      let derniere: ErreurLlm = new ErreurLlm("FOURNISSEUR_INDISPONIBLE", true);
      for (let tentative = 1; tentative <= tentativesMax; tentative++) {
        let attente: number | null = null;
        try {
          const reponse = await appeler(url, {
            method: "POST",
            headers: entetes,
            body: corps,
            redirect: "error",
            signal: AbortSignal.timeout(options.timeoutMs),
          });
          if (reponse.status === 401 || reponse.status === 403) {
            await reponse.body?.cancel().catch(() => undefined);
            throw new ErreurLlm("CLE_REFUSEE", false, reponse.status);
          }
          if (reponse.status === 402) {
            await reponse.body?.cancel().catch(() => undefined);
            throw new ErreurLlm("CREDIT_FOURNISSEUR_INSUFFISANT", false, reponse.status);
          }
          if (reponse.status === 429 || reponse.status >= 500) {
            attente = delaiRetryAfter(reponse);
            await reponse.body?.cancel().catch(() => undefined);
            throw new ErreurLlm("FOURNISSEUR_INDISPONIBLE", true, reponse.status);
          }
          if (!reponse.ok) {
            await reponse.body?.cancel().catch(() => undefined);
            throw new ErreurLlm("REQUETE_REFUSEE", false, reponse.status);
          }
          const brut = await lireBorne(reponse, tailleMax);
          let json: unknown;
          try {
            json = JSON.parse(brut);
          } catch {
            throw new ErreurLlm("REPONSE_INVALIDE", false, reponse.status);
          }
          const lu = reponseSchema.safeParse(json);
          const contenu = lu.success ? lu.data.choices[0]?.message.content : undefined;
          if (!lu.success || typeof contenu !== "string" || contenu.trim() === "") {
            throw new ErreurLlm("REPONSE_INVALIDE", false, reponse.status);
          }
          const caracteresEntree = requete.messages.reduce((n, m) => n + m.content.length, 0);
          const tokensEntree = lu.data.usage?.prompt_tokens ?? estimerTokens(caracteresEntree);
          const tokensSortie = lu.data.usage?.completion_tokens ?? estimerTokens(contenu.length);
          tracer("OK", reponse.status, tentative, { entree: tokensEntree, sortie: tokensSortie });
          return {
            texte: contenu,
            modele: lu.data.model && lu.data.model.length > 0 ? lu.data.model : requete.modele,
            tokensEntree,
            tokensSortie,
            tokensEstimes: lu.data.usage === undefined,
            dureeMs: Math.max(0, horloge() - debut),
          };
        } catch (error) {
          if (error instanceof ErreurLlm) {
            derniere = error;
          } else if (
            error instanceof Error &&
            (error.name === "TimeoutError" || error.name === "AbortError")
          ) {
            // Pas de reprise : l'appel a pu être traité (et facturé) par le fournisseur.
            derniere = new ErreurLlm("DELAI_DEPASSE", true);
            tracer(derniere.code, null, tentative);
            throw derniere;
          } else {
            // Panne réseau (connexion refusée, coupure) : le message natif n'est pas repris.
            derniere = new ErreurLlm("FOURNISSEUR_INDISPONIBLE", true);
          }
          if (!derniere.reessayable || tentative === tentativesMax) {
            tracer(derniere.code, derniere.statutHttp, tentative);
            throw derniere;
          }
          const exponentiel = delaiBase * 2 ** (tentative - 1);
          await attendre(Math.min(delaiMax, attente ?? exponentiel));
        }
      }
      throw derniere;
    },
  };
}

/** L'URL du fournisseur : HTTPS hors développement et test (HTTP admis pour la machine locale en local). */
export function verifierUrlFournisseur(config: Pick<Config, "NODE_ENV" | "OPENROUTER_BASE_URL">) {
  const u = new URL(config.OPENROUTER_BASE_URL);
  if (u.protocol === "https:") return;
  if (u.protocol === "http:" && estLocal(config.NODE_ENV)) return;
  throw new Error("OPENROUTER_BASE_URL doit être en HTTPS hors développement.");
}

/** Fournisseur de l'application, d'après la configuration (URL, délai, attribution). */
export function fournisseurDepuisConfig(
  config: Config,
  journal?: (entree: EntreeJournalLlm) => void,
): LlmProvider {
  verifierUrlFournisseur(config);
  return creerFournisseurOpenRouter({
    baseUrl: config.OPENROUTER_BASE_URL,
    timeoutMs: config.IA_TIMEOUT_MS,
    referer: config.WEB_ORIGIN,
    titre: "MissionPilot",
    ...(journal ? { journal } : {}),
  });
}
