import type { FastifyInstance } from "fastify";
import { buildApp } from "../../../app.js";
import { trousseauDepuisConfig, type Trousseau } from "../../../auth/chiffrement.js";
import type { DependancesDestinataires } from "../../../canaux/destinataires.js";
import { creerHandlerCanalEnvoi } from "../../../canaux/envois.js";
import { creerCanaux } from "../../../canaux/fabrique.js";
import type { Canaux } from "../../../canaux/ports.js";
import { creerHandlerCanalTranscription } from "../../../canaux/transcriptions.js";
import { dossierStockage, type Config } from "../../../config.js";
import type { HandlerJob } from "../../../jobs/registre.js";
import type { CleCompte } from "../cles.js";
import { attendre, type ContexteTenantDemo, type SessionDemo } from "../contexte.js";

/*
 * Contexte du module « canaux » : une application PROPRE au module, montée avec les ports SIMULÉS
 * ou LOCAUX seulement (WhatsApp simulé, SMS « aucun », transcription simulée, signature locale).
 * Les sessions de `ctx` ne portent qu'un cookie : elles servent telles quelles sur cette
 * application. Aucune sortie réseau : les « envois » ne vont que dans la boîte en mémoire du
 * simulateur, perdue à la fin du processus.
 */

export const MARQUE = "DÉMONSTRATION";

export type ReponseHttp = Awaited<ReturnType<SessionDemo["get"]>>;

export interface ContexteCanaux {
  ctx: ContexteTenantDemo;
  app: FastifyInstance;
  cfg: Config;
  canaux: Canaux;
  deps: DependancesDestinataires;
  trousseau: Trousseau;
  /** Requête sur l'application du module avec le cookie d'un compte de `ctx`. */
  appel(
    cle: CleCompte,
    method: "GET" | "POST" | "PUT" | "PATCH",
    url: string,
    payload?: unknown,
    entetes?: Record<string, string>,
  ): Promise<ReponseHttp>;
  /** Idem avec un cookie brut (compte créé par le module). */
  appelCookie(
    cookie: string,
    method: "GET" | "POST" | "PUT" | "PATCH",
    url: string,
    payload?: unknown,
  ): Promise<ReponseHttp>;
}

export async function ouvrirContexteCanaux(
  ctx: ContexteTenantDemo,
): Promise<{ cc: ContexteCanaux; fermer(): Promise<void> }> {
  const cfg: Config = {
    ...ctx.config,
    NODE_ENV: "test",
    TOTP_REQUIS: "non",
    STORAGE_DIR: dossierStockage({
      NODE_ENV: ctx.config.NODE_ENV,
      STORAGE_DIR: ctx.config.STORAGE_DIR,
    }),
    WHATSAPP_FOURNISSEUR: "simule",
    SMS_FOURNISSEUR: "aucun",
    TRANSCRIPTION_FOURNISSEUR: "simule",
    SIGNATURE_FOURNISSEUR: "local",
  };
  const canaux = creerCanaux(cfg);
  const app = await buildApp(cfg, ctx.database, { canaux });
  const trousseau = trousseauDepuisConfig(cfg);
  const brut =
    (cookie: string) =>
    (method: string, url: string, payload?: unknown, h = {}) =>
      app.inject({
        method: method as "GET",
        url,
        headers: { cookie, ...h },
        ...(payload === undefined ? {} : { payload: payload as object }),
      });
  const cc: ContexteCanaux = {
    ctx,
    app,
    cfg,
    canaux,
    trousseau,
    deps: { trousseau, canaux },
    appel: (cle, method, url, payload, entetes) =>
      brut(ctx.session(cle).cookie)(method, url, payload, entetes),
    appelCookie: (cookie, method, url, payload) => brut(cookie)(method, url, payload),
  };
  return { cc, fermer: () => app.close() };
}

/** Réponse attendue (statut) ou erreur claire ; renvoie le corps JSON. */
export function corps<T = Record<string, unknown>>(
  statut: number,
  r: ReponseHttp,
  quoi: string,
): T {
  attendre(statut, r, quoi);
  return r.json() as T;
}

/** Multipart d'un fichier (champ `fichier`), graine déterministe. */
function multipart(nom: string, contenu: Buffer, type: string) {
  const frontiere = `----mptdcanaux${nom.replace(/[^a-z0-9]/gi, "").slice(0, 16)}`;
  const entete =
    `--${frontiere}\r\nContent-Disposition: form-data; name="fichier"; filename="${nom}"\r\n` +
    `Content-Type: ${type}\r\n\r\n`;
  return {
    payload: Buffer.concat([
      Buffer.from(entete, "utf8"),
      contenu,
      Buffer.from(`\r\n--${frontiere}--\r\n`, "utf8"),
    ]),
    headers: { "content-type": `multipart/form-data; boundary=${frontiere}` },
  };
}

/** Téléverse un fichier par une vraie route (201) sur l'application du module ; renvoie son id. */
export async function televerserCanaux(
  cc: ContexteCanaux,
  cle: CleCompte,
  url: string,
  nom: string,
  contenu: Buffer,
  type: string,
): Promise<string> {
  const m = multipart(nom, contenu, type);
  const r = await cc.app.inject({
    method: "POST",
    url,
    headers: { cookie: cc.ctx.session(cle).cookie, ...m.headers },
    payload: m.payload,
  });
  attendre(201, r, `téléversement ${nom}`);
  return (r.json() as { id: string }).id;
}

/**
 * Exécute ici, sans le worker, les tâches EN ATTENTE d'envoi et de transcription (les ports sont
 * les simulateurs de ce processus). L'horloge du handler est la date d'exécution prévue de la
 * tâche (`execute_a`) : un envoi mis en file à une date passée est mené à son terme à cette date.
 */
export async function executerTaches(cc: ContexteCanaux): Promise<number> {
  const handlers: Record<string, HandlerJob> = {
    canal_envoi: creerHandlerCanalEnvoi(() => ({ config: cc.cfg, canaux: cc.canaux })),
    canal_transcription: creerHandlerCanalTranscription(() => ({
      config: cc.cfg,
      canaux: cc.canaux,
    })),
  };
  const types = Object.keys(handlers);
  const cabinetId = cc.ctx.cabinetId;
  let n = 0;
  for (;;) {
    const tache = await cc.ctx.database.withTenant(cabinetId, async (db) => {
      const r = await db.query(
        `SELECT id, type, charge, execute_a FROM jobs
         WHERE type = ANY($1::text[]) AND statut = 'en_attente' ORDER BY execute_a, id LIMIT 1`,
        [types],
      );
      return r.rows[0] as
        { id: string; type: string; charge: Record<string, unknown>; execute_a: Date } | undefined;
    });
    if (!tache) return n;
    await cc.ctx.database.withTenant(cabinetId, async (db) => {
      await (handlers[tache.type] as HandlerJob)({
        db,
        cabinetId,
        jobId: tache.id,
        charge: tache.charge ?? {},
        maintenant: tache.execute_a < new Date() ? tache.execute_a : new Date(),
        database: cc.ctx.database,
      });
      await db.query("UPDATE jobs SET statut = 'termine', progression = 100 WHERE id = $1", [
        tache.id,
      ]);
    });
    n += 1;
  }
}
