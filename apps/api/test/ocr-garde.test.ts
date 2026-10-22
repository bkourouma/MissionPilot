import { execFile } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  LIMITES_OCR_LOCAL,
  OcrLocal,
  diagnosticOcrLocal,
  ocrLocalDisponible,
  permissionNodeDisponible,
  statistiquesOcrLocal,
} from "../src/ingestion/ocr-local.js";
import { fabriquerPdfScanDepuisFixtures, lireManifesteOcr } from "./ocr-outils.js";

/*
 * Garde « aucun réseau » du sous-processus OCR (ocr-garde-reseau.cjs, ADR-009 décision 16), sans base de
 * données. Un petit programme Node est lancé sous les MÊMES options que le sous-processus de l'OCR
 * (`--max-old-space-size`, `--no-addons`, `--require <garde>`, et `--permission --allow-worker
 * --allow-fs-read=…` quand le modèle de permissions existe ; environnement vide) : il tente chaque sortie
 * dans le fil principal PUIS dans des workers créés avec des options qui, avant le correctif, retiraient
 * le garde (`execArgv: []`, `eval: true`, `execArgv: ["--no-warnings"]`, `--expose-internals`,
 * `Object.prototype.execArgv` pollué, worker imbriqué). Chaque tentative doit être REFUSÉE par le garde
 * (code ERR_OCR_RESEAU_INTERDIT) et COMPTÉE dans le total que le fil principal rapporte (mécanisme de
 * `tentatives_reseau` : `compterTentativesReseau()`, alimenté par le BroadcastChannel des workers).
 *
 * Aucune adresse extérieure n'est visée : 127.0.0.1 port 1 (fermé, vérifié avant et après), `localhost`
 * et un résolveur DNS pointé sur 127.0.0.1:1 ; un garde défaillant n'atteindrait donc rien hors du poste.
 */

const GARDE = fileURLToPath(new URL("../src/ingestion/ocr-garde-reseau.cjs", import.meta.url));
const EXIGE = process.env.OCR_LOCAL_EXIGE === "1";
const PERMISSION = permissionNodeDisponible();
const DISPONIBLE = ocrLocalDisponible();
const RAISON = diagnosticOcrLocal();

/** Options du sous-processus de l'OCR (ocr-local.ts, `argumentsProcessus`), lecture limitée au garde. */
function optionsSousProcessus(permission: boolean): string[] {
  const options = [
    `--max-old-space-size=${LIMITES_OCR_LOCAL.tasMaxMo}`,
    "--no-addons",
    "--require",
    GARDE,
  ];
  if (permission) {
    options.push("--permission", "--allow-worker", `--allow-fs-read=${path.dirname(GARDE)}`);
  }
  return options;
}

/*
 * Tentatives, exécutées telles quelles dans chaque fil (source JavaScript, aucune dépendance). Chacune
 * rend `bloque: true` seulement si le GARDE l'a refusée (code ERR_OCR_RESEAU_INTERDIT) ; tout autre échec
 * (ECONNREFUSED, ERR_ACCESS_DENIED du modèle de permissions…) signifie que le garde n'était pas là.
 */
const ESSAIS = `async function essais() {
  const r = [];
  const essayer = async (nom, f) => {
    try {
      await f();
      r.push({ nom, bloque: false, code: 'aucune erreur' });
    } catch (e) {
      r.push({ nom, bloque: !!e && e.code === 'ERR_OCR_RESEAU_INTERDIT', code: String(e && (e.code || e.message)) });
    }
  };
  const C = { host: '127.0.0.1', port: 1 };
  const parRappel = (f) => new Promise((ok, ko) => { try { f((e) => (e ? ko(e) : ok())); } catch (e) { ko(e); } });
  await essayer('net.connect', () => require('node:net').connect(C));
  await essayer('net.Socket.connect', () => new (require('node:net').Socket)().connect(C));
  await essayer('fetch', () => fetch('http://127.0.0.1:1/'));
  await essayer('dns.lookup', () => parRappel((cb) => require('node:dns').lookup('localhost', cb)));
  await essayer('dns.promises.lookup', () => require('node:dns').promises.lookup('localhost'));
  await essayer('dns.Resolver', () => {
    const res = new (require('node:dns').Resolver)();
    res.setServers(['127.0.0.1:1']);
    return parRappel((cb) => res.resolve4('localhost', cb));
  });
  await essayer('dgram.createSocket', () => require('node:dgram').createSocket('udp4'));
  await essayer('new dgram.Socket().send', () => new (require('node:dgram').Socket)('udp4').send(Buffer.from('x'), 1, '127.0.0.1'));
  await essayer('http.request', () => require('node:http').request('http://127.0.0.1:1/'));
  await essayer('http.Agent.createConnection', () => new (require('node:http').Agent)().createConnection(C));
  await essayer('new http.ClientRequest', () => new (require('node:http').ClientRequest)('http://127.0.0.1:1/'));
  await essayer('https.request', () => require('node:https').request('https://127.0.0.1:1/'));
  await essayer('http2.connect', () => require('node:http2').connect('http://127.0.0.1:1'));
  await essayer('tls.connect', () => require('node:tls').connect(C));
  await essayer('cluster.fork', () => {
    const cluster = require('node:cluster');
    cluster.setupPrimary({ execArgv: ['-e', 'process.exit(0)'], silent: true });
    return cluster.fork();
  });
  await essayer('child_process.spawn', () => require('node:child_process').spawn(process.execPath, ['-e', '0']));
  await essayer('WebSocket', () => new WebSocket('ws://127.0.0.1:1/'));
  await essayer('import(node:net).connect', async () => (await import('node:net')).connect(C));
  await essayer('import(node:dns/promises).lookup', async () => (await import('node:dns/promises')).lookup('localhost'));
  await essayer('process.binding(tcp_wrap)', () => process.binding('tcp_wrap'));
  await essayer('process.dlopen', () => process.dlopen({ exports: {} }, require('node:path').join(process.cwd(), 'absent.node')));
  await essayer('v8.setFlagsFromString', () => require('node:v8').setFlagsFromString('--allow-natives-syntax'));
  await essayer('inspector.Session.connect', () => new (require('node:inspector').Session)().connect());
  const etat = globalThis[Symbol.for('missionpilot.ocr.gardeReseau')];
  let permission = null;
  try {
    if (process.permission) permission = !process.permission.has('child') && !process.permission.has('fs.write');
  } catch (e) {
    permission = 'erreur';
  }
  return { essais: r, compte: etat ? etat.compter() : -1, permission, execArgv: process.execArgv };
}`;

/** Programme sonde (lancé par `node <options> -e <source> <garde>`), résultat sur une ligne RESULTAT:. */
const SONDE = `"use strict";
const GARDE = process.argv[1];
const garde = require(GARDE);
const ESSAIS = ${JSON.stringify(ESSAIS)};
const essais = (0, eval)("(" + ESSAIS + ")");
const AMORCE = "eval(require('node:worker_threads').workerData.source)";
const SOURCE_WORKER = ESSAIS + "\\n" +
  "(async () => {\\n" +
  "  const wt = require('node:worker_threads');\\n" +
  "  const res = await essais();\\n" +
  "  if (wt.workerData.imbrique) {\\n" +
  "    res.imbrique = await new Promise((ok) => {\\n" +
  "      const w = new wt.Worker(" + JSON.stringify(AMORCE) + ", { eval: true, execArgv: [], workerData: { source: wt.workerData.source, imbrique: false } });\\n" +
  "      w.once('message', ok);\\n" +
  "      w.once('error', (e) => ok({ erreur: String(e && e.message) }));\\n" +
  "    });\\n" +
  "  }\\n" +
  "  wt.parentPort.postMessage(res);\\n" +
  "})();";
const { Worker } = require("node:worker_threads");
function lancer(nom, options, imbrique) {
  return new Promise((ok) => {
    let w;
    try {
      w = new Worker(AMORCE, Object.assign({ eval: true }, options, { workerData: { source: SOURCE_WORKER, imbrique: !!imbrique } }));
    } catch (e) {
      ok({ nom, erreur: String(e && (e.code || e.message)) });
      return;
    }
    w.once("message", (m) => ok(Object.assign({ nom }, m)));
    w.once("error", (e) => ok({ nom, erreur: String(e && e.message) }));
  });
}
(async () => {
  const principal = await essais();
  const comptePrincipal = garde.compterTentativesReseau();
  const workers = [];
  workers.push(await lancer("execArgv: []", { execArgv: [] }));
  workers.push(await lancer("eval: true + execArgv: []", { eval: true, execArgv: [] }));
  workers.push(await lancer("execArgv: ['--no-warnings']", { execArgv: ["--no-warnings"] }));
  workers.push(await lancer("execArgv: ['--expose-internals']", { execArgv: ["--expose-internals"] }));
  workers.push(await lancer("env vide + execArgv: []", { env: {}, execArgv: [] }));
  workers.push(await lancer("options normales", {}));
  workers.push(await lancer("worker imbriqué (execArgv: [])", { execArgv: [] }, true));
  Object.prototype.execArgv = [];
  workers.push(await lancer("Object.prototype.execArgv = []", {}));
  delete Object.prototype.execArgv;
  // Laisse aux derniers messages du BroadcastChannel le temps d'arriver (comme ocr-processus.mjs).
  await new Promise((ok) => setTimeout(ok, 100));
  const EventEmitter = require("node:events");
  process.stdout.write("RESULTAT:" + JSON.stringify({
    principal,
    comptePrincipal,
    workers,
    total: garde.compterTentativesReseau(),
    constructeurOrigineCache: Worker.prototype.constructor === Worker && Object.getPrototypeOf(Worker) === EventEmitter,
  }) + "\\n");
})();
`;

/** Garde chargé par `require` seulement (pas par `--require`) : il ne serait pas hérité. */
const SONDE_SANS_PRECHARGEMENT = `"use strict";
const garde = require(process.argv[1]);
const { Worker } = require("node:worker_threads");
let code = "aucune erreur";
try {
  const w = new Worker("require('node:net')", { eval: true });
  w.terminate();
} catch (e) {
  code = String(e && e.code);
}
process.stdout.write("RESULTAT:" + JSON.stringify({ code, total: garde.compterTentativesReseau() }) + "\\n");
`;

interface Essai {
  nom: string;
  bloque: boolean;
  code: string;
}
interface ResultatFil {
  nom?: string;
  erreur?: string;
  essais?: Essai[];
  compte?: number;
  permission?: boolean | null | "erreur";
  execArgv?: string[];
  imbrique?: ResultatFil;
}
interface ResultatSonde {
  principal: ResultatFil;
  comptePrincipal: number;
  workers: ResultatFil[];
  total: number;
  constructeurOrigineCache: boolean;
}

function executerSonde<T>(source: string, options: string[]): Promise<T> {
  return new Promise((resoudre, rejeter) => {
    execFile(
      process.execPath,
      [...options, "-e", source, GARDE],
      // Environnement VIDE, comme le sous-processus de l'OCR.
      { env: {}, windowsHide: true, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 },
      (erreur, stdout, stderr) => {
        const ligne = String(stdout)
          .split(/\r?\n/)
          .find((l) => l.startsWith("RESULTAT:"));
        if (!ligne) {
          rejeter(
            new Error(
              `sonde sans résultat (${erreur?.message ?? "?"}) : ${String(stderr).slice(0, 2000)}`,
            ),
          );
          return;
        }
        resoudre(JSON.parse(ligne.slice("RESULTAT:".length)) as T);
      },
    );
  });
}

/** 127.0.0.1:1 est fermé (connexion refusée) : rien n'y écoute, aucun échange possible. */
function portFerme(): Promise<boolean> {
  return new Promise((ok) => {
    const s = net.connect({ host: "127.0.0.1", port: 1 });
    s.setTimeout(10_000, () => {
      s.destroy();
      ok(false);
    });
    s.once("connect", () => {
      s.destroy();
      ok(false);
    });
    s.once("error", (e: NodeJS.ErrnoException) => {
      s.destroy();
      ok(e.code === "ECONNREFUSED");
    });
  });
}

const nonBloques = (f: ResultatFil) =>
  (f.essais ?? []).filter((e) => !e.bloque).map((e) => `${e.nom} -> ${e.code}`);

/** Vérifications communes : chaque fil a tout refusé et compté, le total du fil principal inclut tout. */
function verifier(r: ResultatSonde, permission: boolean): void {
  const nbEssais = r.principal.essais?.length ?? 0;
  expect(nbEssais).toBe(23);
  expect(nonBloques(r.principal), "fil principal").toEqual([]);
  expect(r.comptePrincipal).toBe(nbEssais);
  expect(r.constructeurOrigineCache).toBe(true);
  const fils: ResultatFil[] = [];
  for (const w of r.workers) {
    expect(w.erreur, `${w.nom} : création ou exécution du worker`).toBeUndefined();
    fils.push(w);
    if (w.imbrique) fils.push({ ...w.imbrique, nom: `${w.nom} > imbriqué` });
  }
  expect(fils.length).toBe(9);
  for (const f of fils) {
    expect(f.erreur, f.nom).toBeUndefined();
    expect(f.essais?.length, f.nom).toBe(nbEssais);
    expect(nonBloques(f), f.nom).toEqual([]);
    // Une tentative = un refus compté dans le fil.
    expect(f.compte, f.nom).toBe(nbEssais);
    // Le worker a hérité des options du sous-processus : garde préchargé et, s'il existe, modèle de
    // permissions actif (avant le correctif, `execArgv: []` les retirait tous les deux).
    expect(f.execArgv, f.nom).toContain(GARDE);
    expect(f.execArgv, f.nom).not.toContain("--expose-internals");
    expect(f.permission, f.nom).toBe(permission ? true : null);
  }
  // Le total remonté par le fil principal (bilan.tentatives_reseau) inclut CHAQUE refus des workers.
  const sommeWorkers = fils.reduce((s, f) => s + (f.compte ?? 0), 0);
  expect(r.total).toBe(r.comptePrincipal + sommeWorkers);
  expect(r.total).toBe(nbEssais * 10);
}

describe("Garde réseau de l'OCR : fil principal et workers, quelles que soient les options", () => {
  it("127.0.0.1:1 est fermé avant les sondes (rien n'écoute)", async () => {
    expect(await portFerme()).toBe(true);
  });

  it("modèle de permissions exigé en CI (OCR_LOCAL_EXIGE=1)", () => {
    if (EXIGE) {
      expect(PERMISSION, "le modèle de permissions de Node doit exister (Node >= 22.13)").toBe(
        true,
      );
    }
  });

  it.skipIf(!PERMISSION)(
    `options du sous-processus AVEC modèle de permissions : tout est bloqué et compté${PERMISSION ? "" : " (SAUTÉ : modèle de permissions absent, Node < 22.13)"}`,
    async () => {
      const r = await executerSonde<ResultatSonde>(SONDE, optionsSousProcessus(true));
      verifier(r, true);
    },
    60_000,
  );

  it('options du sous-processus SANS modèle de permissions (Node 22 ancien, `permission: "non"`) : tout est bloqué et compté', async () => {
    const r = await executerSonde<ResultatSonde>(SONDE, optionsSousProcessus(false));
    verifier(r, false);
  }, 60_000);

  it("garde chargé sans --require (non hérité) : toute création de worker est refusée et comptée", async () => {
    const r = await executerSonde<{ code: string; total: number }>(SONDE_SANS_PRECHARGEMENT, [
      "--no-addons",
    ]);
    expect(r.code).toBe("ERR_OCR_RESEAU_INTERDIT");
    expect(r.total).toBe(1);
  }, 30_000);

  it("127.0.0.1:1 est toujours fermé après les sondes", async () => {
    expect(await portFerme()).toBe(true);
  });
});

describe("OCR réel (tesseract.js) sous le garde renforcé", () => {
  it("moteur exigé en CI (OCR_LOCAL_EXIGE=1)", () => {
    if (EXIGE) {
      expect(RAISON, "le moteur OCR local doit être disponible (OCR_LOCAL_EXIGE=1)").toBeNull();
    }
  });

  it.skipIf(!DISPONIBLE)(
    `scan net : les workers de tesseract.js fonctionnent, aucune tentative réseau${DISPONIBLE ? "" : ` (SAUTÉ : moteur indisponible, ${RAISON})`}`,
    async () => {
      const f = lireManifesteOcr().fichiers.find((x) => x.nom === "etat-net.jpg");
      if (!f) throw new Error("fixture absente : etat-net.jpg");
      const [page] = await new OcrLocal().reconnaitre({
        pdf: fabriquerPdfScanDepuisFixtures([f.nom], f.dpi),
        pages: [1],
      });
      const bilan = statistiquesOcrLocal.derniere;
      expect(bilan?.issue).toBe("ok");
      expect(bilan?.tentatives_reseau).toBe(0);
      expect(bilan?.cibles_reseau).toEqual([]);
      expect(bilan?.permission?.actif).toBe(PERMISSION);
      expect(page?.numero).toBe(1);
      expect(page?.texte).toMatch(/Capital {2,}10 000 000/);
      expect(page?.confiance_pm).toBeGreaterThanOrEqual(850);
    },
    90_000,
  );
});
