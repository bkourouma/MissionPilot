import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app.js";
import type { Auth } from "../src/auth/contexte.js";
import type { Config } from "../src/config.js";
import { createDatabase } from "../src/db/pool.js";
import { configTest, type Contexte } from "./helpers.js";

/*
 * Outils des tests du socle IA : serveur OpenRouter FACTICE sur la machine
 * locale (aucun appel réseau externe, aucune vraie clé) et application de
 * test pointée vers lui.
 */

/** Clés factices : ne valent rien en dehors des tests. */
export const CLE_PLATEFORME_FACTICE = "cle-plateforme-factice-0000000000";
export const CLE_CABINET_FACTICE = "cle-cabinet-factice-1111111111111";

export interface RequeteRecue {
  corps: Record<string, unknown> & {
    model?: string;
    messages?: { role: string; content: string }[];
  };
  entetes: IncomingHttpHeaders;
  chemin: string;
  methode: string;
}

export interface ReponseFactice {
  statut?: number;
  /** Contenu de la réponse du modèle (choices[0].message.content). */
  contenu?: string;
  /** Corps brut (remplace la réponse construite). */
  brut?: string;
  entetes?: Record<string, string>;
  usage?: { prompt_tokens: number; completion_tokens: number } | null;
  /** Ne jamais répondre (test du délai). */
  silence?: boolean;
  /** Retenir la réponse jusqu'à la résolution de cette promesse (appels simultanés). */
  retenue?: Promise<void>;
}

export interface ServeurFactice {
  url: string;
  requetes: RequeteRecue[];
  /** Règle la réponse suivante (n = numéro de la requête, à partir de 1). */
  repondre(fn: (r: RequeteRecue, n: number) => ReponseFactice): void;
  fermer(): Promise<void>;
}

export async function serveurFactice(): Promise<ServeurFactice> {
  const requetes: RequeteRecue[] = [];
  let reponse: (r: RequeteRecue, n: number) => ReponseFactice = () => ({ contenu: "OK" });
  const ouvertes = new Set<import("node:http").ServerResponse>();
  const serveur: Server = createServer((req, res) => {
    const morceaux: Buffer[] = [];
    req.on("data", (m: Buffer) => morceaux.push(m));
    req.on("end", () => {
      let corps: RequeteRecue["corps"] = {};
      try {
        corps = JSON.parse(Buffer.concat(morceaux).toString("utf8"));
      } catch {
        corps = {};
      }
      const recue = {
        corps,
        entetes: req.headers,
        chemin: req.url ?? "",
        methode: req.method ?? "",
      };
      requetes.push(recue);
      const r = reponse(recue, requetes.length);
      if (r.silence) {
        ouvertes.add(res);
        return;
      }
      const brut =
        r.brut ??
        JSON.stringify({
          id: `gen-${requetes.length}`,
          model: corps.model,
          choices: [{ message: { role: "assistant", content: r.contenu ?? "OK" } }],
          ...(r.usage === null
            ? {}
            : { usage: r.usage ?? { prompt_tokens: 1200, completion_tokens: 300 } }),
        });
      const envoyer = () => {
        res.writeHead(r.statut ?? 200, {
          "content-type": "application/json",
          ...(r.entetes ?? {}),
        });
        res.end(brut);
      };
      if (r.retenue) void r.retenue.then(envoyer);
      else envoyer();
    });
  });
  await new Promise<void>((ok) => serveur.listen(0, "127.0.0.1", ok));
  const port = (serveur.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/api/v1`,
    requetes,
    repondre: (fn) => {
      reponse = fn;
    },
    fermer: async () => {
      for (const res of ouvertes) res.destroy();
      serveur.closeAllConnections();
      await new Promise<void>((ok) => serveur.close(() => ok()));
    },
  };
}

/** Contexte d'authentification d'un utilisateur (appel direct de l'orchestrateur par un « service »). */
export async function authDe(
  ctx: Contexte,
  cabinetId: string,
  utilisateurId: string,
): Promise<Auth> {
  return ctx.db.withTenant(cabinetId, async (db) => {
    const u = (
      await db.query("SELECT id, email, nom, roles FROM utilisateurs WHERE id = $1", [
        utilisateurId,
      ])
    ).rows[0];
    return { utilisateurId: u.id, cabinetId, email: u.email, nom: u.nom, roles: u.roles };
  });
}

/** Promesse résolue à la demande (retenir un appel du fournisseur). */
export function verrou(): { promesse: Promise<void>; liberer: () => void } {
  let liberer: () => void = () => undefined;
  const promesse = new Promise<void>((ok) => (liberer = ok));
  return { promesse, liberer };
}

/** Attend qu'une condition devienne vraie (au plus `ms`). */
export async function attendreQue(condition: () => boolean | Promise<boolean>, ms = 10_000) {
  const fin = Date.now() + ms;
  while (!(await condition())) {
    if (Date.now() > fin) throw new Error("Condition non atteinte à temps.");
    await new Promise((ok) => setTimeout(ok, 20));
  }
}

/** Application de test dont le fournisseur IA est le serveur factice. */
export async function demarrerIa(
  urlFournisseur: string,
  surcharge: Partial<Config> = {},
): Promise<Contexte> {
  const config: Config = {
    ...configTest(),
    OPENROUTER_BASE_URL: urlFournisseur,
    OPENROUTER_API_KEY: CLE_PLATEFORME_FACTICE,
    IA_TIMEOUT_MS: 3000,
    ...surcharge,
  };
  const db = createDatabase(config);
  const app = await buildApp(config, db);
  return {
    config,
    db,
    app,
    fermer: async () => {
      await app.close();
      await db.close();
    },
  };
}
