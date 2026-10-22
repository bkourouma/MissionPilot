"use strict";
/* global require, module, process, __filename */
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS exigé : préchargé par --require. */
// Garde « aucun réseau » du sous-processus OCR (ADR-009, décision 16). Préchargé par `--require` dans le
// sous-processus (ocr-processus.mjs) : un worker_thread créé SANS `execArgv` hérite des options du fil
// parent, `--require` compris (vérifié sous Node 24, contrairement à `--import`), donc le garde s'exécute
// aussi dans le fil de tesseract.js qui charge le moteur et les données de langue. CommonJS volontairement,
// pour cette raison.
//
// Toute tentative de sortie (connexion TCP/TLS, résolution DNS, UDP, requête HTTP(S), fetch, WebSocket,
// EventSource, XMLHttpRequest, lancement d'un autre programme, liaison native) est REFUSÉE (erreur levée) et
// COMPTÉE. Chaque fil a son propre compteur (les modules intégrés et `globalThis` sont propres à chaque
// fil) ; un worker qui tente une sortie le signale aussi au fil principal par un `BroadcastChannel`
// (messagerie interne au processus, pas un accès réseau) : le fil principal connaît donc le total sans
// coopération de tesseract.js et le renvoie au parent (`tentatives_reseau`), qui traite toute tentative
// comme une anomalie (OCR_ECHEC).
//
// HÉRITAGE IMPOSÉ AUX WORKERS. Un worker créé avec un `execArgv` explicite (même `[]`, avec ou sans
// `eval: true`) ne reçoit QUE ces options : ni le `--require` du garde, ni le modèle de permissions
// (`--permission` : mesuré sous Node 24.12, un tel worker lit n'importe quel fichier et appelle
// `process.binding`), ni `--no-addons`. Le garde remplace donc `worker_threads.Worker` (même objet pour
// `require("worker_threads")`, `require("node:worker_threads")`, `process.getBuiltinModule` et, par
// `syncBuiltinESMExports`, pour `import { Worker }` et `import("node:worker_threads")`) par un
// constructeur qui IGNORE l'`execArgv` de l'appelant : le worker hérite toujours de toutes les options du
// fil parent, donc du garde, du modèle de permissions et de `--no-addons`, quoi que passent `execArgv`,
// `eval` ou `env`. Choix plutôt que d'ajouter `--require` à la liste de l'appelant : celle-ci pourrait
// porter des options dangereuses (`--expose-internals` y est accepté et ouvre les liaisons internes) et
// n'hériterait toujours pas du modèle de permissions. Aucun code du sous-processus ne passe d'`execArgv`
// (tesseract.js : `new Worker(chemin)` ; veille : `workerData` seulement). Le constructeur d'origine reste
// injoignable : `Worker.prototype.constructor` désigne le remplaçant, qui n'en hérite pas (prototype
// d'EventEmitter), et l'inspecteur (qui pourrait lire les portées) est bloqué. Si le garde n'a pas été
// chargé par `--require` (donc ne serait pas hérité), toute création de worker est refusée et comptée. Le
// fil des crochets de `module.register` hérite aussi des options (vérifié) ; `vm` ne crée pas de fil et
// ses contextes n'ont ni `require` ni `process`.
//
// Liaisons de bas niveau : `process.binding` (donne `tcp_wrap`, `udp_wrap`, `cares_wrap`, `pipe_wrap`,
// `process_wrap`… sans le modèle de permissions), `process._linkedBinding`, `process.dlopen` (module natif),
// `process.execve`, les fabriques de poignées de `net` et `dgram`, `dgram.Socket` construit directement,
// l'inspecteur et `v8.setFlagsFromString` sont aussi refusés et comptés. Les méthodes `postMessage` qui
// portent le compte d'un worker sont figées pour qu'un code du worker ne puisse pas l'étouffer, et le
// compteur n'est lisible que par des fonctions (aucun champ modifiable).
//
// Ce garde est une défense en profondeur : le processus n'a de toute façon aucune adresse à joindre
// (`langPath` local, aucune URL), et le modèle de permissions de Node (s'il est disponible) interdit les
// sous-processus. Il ne remplace pas un pare-feu sortant au niveau du serveur.

const workerThreads = require("node:worker_threads");
const moduleNode = require("node:module");
const cheminNode = require("node:path");

const { BroadcastChannel, MessagePort, isMainThread } = workerThreads;
const CANAL = "missionpilot-ocr-garde-reseau";
const ETAT = Symbol.for("missionpilot.ocr.gardeReseau");
// Primitives capturées avant tout code applicatif (un code ultérieur pourrait les remplacer).
const construire = Reflect.construct;
const definir = Object.defineProperty;
const protoDe = Object.getPrototypeOf;
const changerProto = Object.setPrototypeOf;

/** `--require <garde>` (ou `-r`, ou `--require=<garde>`) figure-t-il dans ces options ? */
function gardeDansArguments(args) {
  if (!Array.isArray(args)) return false;
  const cible = cheminNode.resolve(__filename);
  const memeFichier = (valeur) => {
    if (typeof valeur !== "string" || valeur === "") return false;
    const chemin = cheminNode.resolve(valeur);
    return process.platform === "win32"
      ? chemin.toLowerCase() === cible.toLowerCase()
      : chemin === cible;
  };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if ((a === "--require" || a === "-r") && memeFichier(args[i + 1])) return true;
    if (typeof a === "string" && a.startsWith("--require=") && memeFichier(a.slice(10))) {
      return true;
    }
  }
  return false;
}

if (!globalThis[ETAT]) {
  let local = 0;
  let recus = 0;
  const details = [];
  definir(globalThis, ETAT, {
    value: Object.freeze({
      compter: () => local + recus,
      details: () => details.slice(),
    }),
    writable: false,
    configurable: false,
    enumerable: false,
  });

  // Les méthodes qui portent le compte d'un worker vers le fil principal sont figées AVANT tout code
  // applicatif : un code du worker ne peut plus les remplacer par une fonction muette.
  for (const proto of [
    BroadcastChannel && BroadcastChannel.prototype,
    MessagePort && MessagePort.prototype,
  ]) {
    try {
      if (proto && typeof proto.postMessage === "function") {
        definir(proto, "postMessage", { writable: false, configurable: false });
      }
    } catch {
      // Déjà figée ou non configurable : rien à faire.
    }
  }
  const canal = new BroadcastChannel(CANAL);
  // Le canal ne doit jamais retenir la boucle d'événements d'un fil.
  if (typeof canal.unref === "function") canal.unref();
  if (isMainThread) {
    canal.onmessage = (evenement) => {
      const donnees = evenement && evenement.data;
      if (donnees && typeof donnees.cible === "string") {
        recus += 1;
        if (details.length < 50) details.push(`worker:${donnees.cible.slice(0, 80)}`);
      }
    };
  }

  const refuser = (cible) => {
    local += 1;
    if (details.length < 50) details.push(cible);
    if (!isMainThread) {
      try {
        canal.postMessage({ cible });
      } catch {
        // Le compteur local reste incrémenté.
      }
    }
    const erreur = new Error(`Accès réseau interdit dans le sous-processus OCR (${cible}).`);
    erreur.code = "ERR_OCR_RESEAU_INTERDIT";
    return erreur;
  };
  const bloquer = (cible) =>
    function bloque() {
      throw refuser(cible);
    };
  const remplacer = (objet, nom, cible) => {
    if (!objet) return;
    try {
      definir(objet, nom, {
        value: bloquer(cible),
        writable: false,
        configurable: false,
        enumerable: true,
      });
    } catch {
      try {
        objet[nom] = bloquer(cible);
      } catch {
        // Propriété non remplaçable : les autres verrous restent.
      }
    }
  };
  const exiger = (nom) => {
    try {
      return require(nom);
    } catch {
      // Module absent de ce Node (ou interdit par le modèle de permissions) : rien à bloquer.
      return null;
    }
  };

  // Tous les modules visés sont chargés AVANT le premier remplacement : une méthode figée sur un prototype
  // empêcherait un module chargé plus tard de la redéfinir sur une sous-classe (https.Agent hérite
  // d'http.Agent et y assigne `createConnection`).
  const net = require("node:net");
  const tls = require("node:tls");
  const dns = require("node:dns");
  const dgram = require("node:dgram");
  const http = require("node:http");
  const https = require("node:https");
  const http2 = require("node:http2");
  const childProcess = require("node:child_process");
  const v8 = require("node:v8");
  const inspecteur = exiger("node:inspector");
  exiger("node:inspector/promises");

  // TCP et TLS : la connexion de tout socket passe par Socket.prototype.connect.
  remplacer(net.Socket && net.Socket.prototype, "connect", "net.Socket.connect");
  remplacer(net, "connect", "net.connect");
  remplacer(net, "createConnection", "net.createConnection");
  remplacer(net, "createServer", "net.createServer");
  remplacer(net, "_createServerHandle", "net._createServerHandle");
  remplacer(net.Server && net.Server.prototype, "listen", "net.Server.listen");
  remplacer(tls, "connect", "tls.connect");
  remplacer(tls, "createServer", "tls.createServer");
  // DNS : fonctions de rappel, promesses et résolveurs.
  const fonctionsDns = [
    "lookup",
    "lookupService",
    "resolve",
    "resolve4",
    "resolve6",
    "resolveAny",
    "resolveCaa",
    "resolveCname",
    "resolveMx",
    "resolveNaptr",
    "resolveNs",
    "resolvePtr",
    "resolveSoa",
    "resolveSrv",
    "resolveTlsa",
    "resolveTxt",
    "reverse",
  ];
  for (const nom of fonctionsDns) {
    remplacer(dns, nom, `dns.${nom}`);
    if (dns.promises) remplacer(dns.promises, nom, `dns.promises.${nom}`);
    if (dns.Resolver) remplacer(dns.Resolver.prototype, nom, `dns.Resolver.${nom}`);
    if (dns.promises && dns.promises.Resolver) {
      remplacer(dns.promises.Resolver.prototype, nom, `dns.promises.Resolver.${nom}`);
    }
  }
  // UDP (fabrique, constructeur direct `new dgram.Socket()` et poignée brute).
  remplacer(dgram, "createSocket", "dgram.createSocket");
  remplacer(dgram, "_createSocketHandle", "dgram._createSocketHandle");
  for (const nom of ["bind", "connect", "send", "sendto"]) {
    remplacer(dgram.Socket && dgram.Socket.prototype, nom, `dgram.Socket.${nom}`);
  }
  // HTTP, HTTPS, HTTP/2 (y compris `new http.ClientRequest()` / `new http.Agent()` qui passent par
  // `Agent.prototype.createConnection`).
  for (const [nomModule, m] of [
    ["node:http", http],
    ["node:https", https],
  ]) {
    remplacer(m, "request", `${nomModule}.request`);
    remplacer(m, "get", `${nomModule}.get`);
    remplacer(m, "createServer", `${nomModule}.createServer`);
    remplacer(
      m.Agent && m.Agent.prototype,
      "createConnection",
      `${nomModule}.Agent.createConnection`,
    );
  }
  remplacer(http2, "connect", "http2.connect");
  remplacer(http2, "createServer", "http2.createServer");
  remplacer(http2, "createSecureServer", "http2.createSecureServer");
  // Lancement d'autres programmes (le modèle de permissions l'interdit aussi quand il est actif).
  for (const nom of [
    "spawn",
    "spawnSync",
    "exec",
    "execSync",
    "execFile",
    "execFileSync",
    "fork",
  ]) {
    remplacer(childProcess, nom, `child_process.${nom}`);
  }
  // Liaisons de bas niveau et remplacement du programme (contournements du garde et du modèle de
  // permissions ; aucune bibliothèque du sous-processus ne s'en sert, vérifié pour tesseract.js et unpdf).
  remplacer(process, "binding", "process.binding");
  remplacer(process, "_linkedBinding", "process._linkedBinding");
  remplacer(process, "dlopen", "process.dlopen");
  if (typeof process.execve === "function") remplacer(process, "execve", "process.execve");
  // Inspecteur : ouvrirait un port, et une session dans le processus lirait les portées des fonctions
  // (dont le constructeur de worker d'origine).
  if (inspecteur) {
    remplacer(inspecteur, "open", "inspector.open");
    if (inspecteur.Session) {
      remplacer(inspecteur.Session.prototype, "connect", "inspector.Session.connect");
      remplacer(
        inspecteur.Session.prototype,
        "connectToMainThread",
        "inspector.Session.connectToMainThread",
      );
    }
  }
  // Options de V8 au vol (`--allow-natives-syntax`, `--expose-*`…).
  remplacer(v8, "setFlagsFromString", "v8.setFlagsFromString");
  // API web globales de sortie.
  for (const nom of ["fetch", "WebSocket", "EventSource", "XMLHttpRequest"]) {
    remplacer(globalThis, nom, nom);
  }

  // Workers : héritage imposé des options du fil parent (voir l'en-tête).
  const gardeHerite = gardeDansArguments(process.execArgv);
  const WorkerOrigine = workerThreads.Worker;
  if (typeof WorkerOrigine === "function") {
    const WorkerGarde = function Worker(fichier, options) {
      if (new.target === undefined) {
        throw new TypeError("Class constructor Worker cannot be invoked without 'new'");
      }
      if (!gardeHerite) throw refuser("worker_threads.Worker (garde non hérité)");
      // Copie unique des options (chaque accesseur n'est lu qu'une fois) ; `execArgv` PROPRE et indéfini
      // (masque aussi un `execArgv` ajouté à Object.prototype) : le worker hérite des options du fil.
      const sures = { ...options, execArgv: undefined };
      return construire(WorkerOrigine, [fichier, sures], new.target);
    };
    definir(WorkerGarde, "prototype", { value: WorkerOrigine.prototype, writable: false });
    changerProto(WorkerGarde, protoDe(WorkerOrigine));
    definir(WorkerOrigine.prototype, "constructor", {
      value: WorkerGarde,
      writable: false,
      configurable: false,
      enumerable: false,
    });
    definir(workerThreads, "Worker", {
      value: WorkerGarde,
      writable: false,
      configurable: false,
      enumerable: true,
    });
  }

  // Les liaisons ESM des modules intégrés (import { connect } from "node:net") suivent les objets CJS.
  if (typeof moduleNode.syncBuiltinESMExports === "function") moduleNode.syncBuiltinESMExports();
}

/** Total des tentatives refusées dans ce processus (fil courant + workers, vu du fil principal). */
function compterTentativesReseau() {
  const etat = globalThis[ETAT];
  return etat ? etat.compter() : 0;
}

/** Cibles des tentatives (noms d'API seulement, jamais d'adresse ni de contenu). */
function detailsTentativesReseau() {
  const etat = globalThis[ETAT];
  return etat ? etat.details() : [];
}

module.exports = { compterTentativesReseau, detailsTentativesReseau };
