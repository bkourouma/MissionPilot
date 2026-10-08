/*
 * Service worker de MissionPilot (PWA). Testé dans src/lib/hors-ligne/sw.test.ts.
 *
 * Stratégie explicite, par type de requête (même origine, GET seulement) :
 * - /_next/static/* : « cache d'abord », seulement pour les réponses marquées `immutable`
 *   (fichiers à empreinte du build de production ; en développement Next répond `no-store`,
 *   rien n'est donc gardé). C'est l'enveloppe applicative : JS, CSS, polices du build.
 * - icônes, manifeste : « réseau d'abord », cache en repli.
 * - navigations (pages) : réseau seulement ; en cas d'échec, page « hors ligne » générée ici.
 * - tout le reste, et en particulier /api/*, les données des composants serveur (RSC,
 *   `?_rsc=`), les requêtes non GET ou d'une autre origine : jamais lu ni écrit dans un cache.
 *   Aucune page authentifiée ni réponse contenant des données de cabinet n'est gardée.
 *
 * Caches versionnés (VERSION) : à l'activation, tout cache « mp-… » d'une autre version est
 * supprimé. Augmenter VERSION à chaque changement de ce fichier.
 *
 * Déconnexion : quand POST /api/auth/deconnexion réussit, la file hors ligne des saisies de
 * temps (IndexedDB) est supprimée et les onglets sont prévenus (ils vident leur repli local).
 */
/* global self, caches, indexedDB, fetch, URL, Response */
"use strict";

const VERSION = "2026-10-06.1";
const PREFIXE = "mp-";
const CACHE_STATIQUE = PREFIXE + "statique-" + VERSION;
const CACHE_PUBLIC = PREFIXE + "public-" + VERSION;
const CACHES_ACTUELS = [CACHE_STATIQUE, CACHE_PUBLIC];
const RESSOURCES_PUBLIQUES = [
  "/manifest.webmanifest",
  "/icones/icone.svg",
  "/icones/icone-masquable.svg",
];
const MAX_STATIQUES = 200;
const BASE_HORS_LIGNE = "missionpilot-hors-ligne";

/** Décide du traitement d'une requête : "statique", "public", "navigation" ou "ignorer". */
function classerRequete(requete, origine) {
  if (requete.method !== "GET") return "ignorer";
  const url = new URL(requete.url);
  if (url.origin !== origine) return "ignorer";
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return "ignorer";
  const entetes = requete.headers;
  if (entetes.get("RSC") || entetes.get("Next-Router-State-Tree") || url.searchParams.has("_rsc")) {
    return "ignorer";
  }
  if (entetes.get("Range")) return "ignorer";
  if (requete.mode === "navigate") return "navigation";
  if (url.pathname.startsWith("/_next/static/")) return "statique";
  if (RESSOURCES_PUBLIQUES.includes(url.pathname) && url.search === "") return "public";
  return "ignorer";
}

/** Une réponse ne va en cache que si elle est complète, publique et sans interdiction. */
function peutGarder(reponse, exigerImmutable) {
  if (!reponse || !reponse.ok || reponse.status !== 200 || reponse.type !== "basic") return false;
  if (reponse.redirected) return false;
  const controle = (reponse.headers.get("Cache-Control") || "").toLowerCase();
  if (/no-store|private|no-cache/.test(controle)) return false;
  if (exigerImmutable && !controle.includes("immutable")) return false;
  if ((reponse.headers.get("Vary") || "").includes("*")) return false;
  return true;
}

async function limiter(cache, max) {
  const cles = await cache.keys();
  for (let i = 0; i < cles.length - max; i++) await cache.delete(cles[i]);
}

async function cacheDabord(requete) {
  const cache = await caches.open(CACHE_STATIQUE);
  const trouve = await cache.match(requete);
  if (trouve) return trouve;
  const reponse = await fetch(requete);
  if (peutGarder(reponse, true)) {
    await cache.put(requete, reponse.clone());
    await limiter(cache, MAX_STATIQUES);
  }
  return reponse;
}

async function reseauDabord(requete) {
  const cache = await caches.open(CACHE_PUBLIC);
  try {
    const reponse = await fetch(requete);
    if (peutGarder(reponse, false)) await cache.put(requete, reponse.clone());
    return reponse;
  } catch (e) {
    const trouve = await cache.match(requete);
    if (trouve) return trouve;
    throw e;
  }
}

function echapper(texte) {
  return String(texte).replace(/[&<>"']/g, (c) => "&#" + c.charCodeAt(0) + ";");
}

/** Page « hors ligne », générée (aucune donnée de cabinet, aucune page mise en cache). */
function pageHorsLigne(url) {
  const chemin = new URL(url).pathname;
  const html =
    '<!doctype html><html lang="fr"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="color-scheme" content="light dark"><title>Hors connexion — MissionPilot</title>' +
    "<style>" +
    ":root{--fond:#f5f6f8;--surface:#fff;--texte:#16202a;--doux:#4a5663;--primaire:#1b4f7a;--sur:#fff}" +
    "@media (prefers-color-scheme:dark){:root{--fond:#0e141b;--surface:#16202a;--texte:#e8edf2;--doux:#b4c0cc;--primaire:#8cc0ec;--sur:#0e141b}}" +
    "body{margin:0;font:1rem/1.5 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;background:var(--fond);color:var(--texte)}" +
    "main{max-width:32rem;margin:0 auto;padding:2rem 1rem}" +
    "section{background:var(--surface);border-radius:10px;padding:1.5rem}" +
    "h1{font-size:1.5rem;margin:0 0 .75rem}p{margin:0 0 1rem}.doux{color:var(--doux)}" +
    "a{display:inline-flex;align-items:center;min-height:44px;padding:0 1rem;border-radius:6px;" +
    "background:var(--primaire);color:var(--sur);font-weight:600;text-decoration:none}" +
    "a:focus-visible{outline:3px solid var(--primaire);outline-offset:3px}" +
    "</style></head><body><main><section>" +
    "<h1>Vous êtes hors connexion</h1>" +
    "<p>Cette page n'a pas pu être chargée : le réseau ne répond pas. MissionPilot ne garde " +
    "aucune page de votre cabinet sur l'appareil.</p>" +
    '<p class="doux">Les saisies de temps faites avant la coupure restent sur cet appareil ' +
    "et seront envoyées au retour du réseau, depuis la feuille de temps.</p>" +
    '<p><a href="' +
    echapper(chemin) +
    '">Réessayer</a></p>' +
    "</section></main></body></html>";
  return new Response(html, {
    status: 503,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
    },
  });
}

async function navigation(requete) {
  try {
    return await fetch(requete);
  } catch {
    return pageHorsLigne(requete.url);
  }
}

function supprimerBase() {
  return new Promise((ok) => {
    if (typeof indexedDB === "undefined") return ok();
    const r = indexedDB.deleteDatabase(BASE_HORS_LIGNE);
    r.onsuccess = r.onerror = r.onblocked = () => ok();
  });
}

async function purgerApresDeconnexion() {
  await supprimerBase();
  const onglets = await self.clients.matchAll({ includeUncontrolled: true, type: "window" });
  for (const o of onglets) o.postMessage({ type: "mp-purger-hors-ligne" });
}

function deconnexion(evenement) {
  evenement.respondWith(
    fetch(evenement.request).then((reponse) => {
      if (reponse.ok) evenement.waitUntil(purgerApresDeconnexion());
      return reponse;
    }),
  );
}

async function nettoyerAnciensCaches() {
  for (const nom of await caches.keys()) {
    if (nom.startsWith(PREFIXE) && !CACHES_ACTUELS.includes(nom)) await caches.delete(nom);
  }
}

/** Pré-cache des ressources publiques ; une redirection (vers /connexion) n'est jamais gardée. */
async function preCharger() {
  const cache = await caches.open(CACHE_PUBLIC);
  for (const chemin of RESSOURCES_PUBLIQUES) {
    try {
      const reponse = await fetch(chemin, { redirect: "error", cache: "no-cache" });
      if (peutGarder(reponse, false)) await cache.put(chemin, reponse);
    } catch {
      // Ressource indisponible : elle sera mise en cache à sa prochaine lecture.
    }
  }
}

self.addEventListener("install", (evenement) => {
  evenement.waitUntil(preCharger().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (evenement) => {
  evenement.waitUntil(nettoyerAnciensCaches().then(() => self.clients.claim()));
});

self.addEventListener("fetch", (evenement) => {
  const requete = evenement.request;
  const url = new URL(requete.url);
  if (
    requete.method === "POST" &&
    url.origin === self.location.origin &&
    url.pathname === "/api/auth/deconnexion"
  ) {
    deconnexion(evenement);
    return;
  }
  const type = classerRequete(requete, self.location.origin);
  if (type === "statique") evenement.respondWith(cacheDabord(requete));
  else if (type === "public") evenement.respondWith(reseauDabord(requete));
  else if (type === "navigation") evenement.respondWith(navigation(requete));
  // "ignorer" : le navigateur traite la requête normalement, sans cache du service worker.
});
