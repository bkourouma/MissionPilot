/**
 * Stockages de la file hors ligne, du plus sûr au moins sûr : IndexedDB, puis `localStorage`
 * (navigateur sans IndexedDB ou qui le refuse : certains modes privés), puis la mémoire de
 * l'onglet (la saisie survit à une coupure, pas à la fermeture de l'onglet ; l'interface le dit).
 *
 * Testé dans `magasins.test.ts` avec un IndexedDB simulé (`test/idb-simule.ts`).
 */
import { estSaisie, type Magasin, type SaisieEnAttente } from "./file-temps";

export const NOM_BASE = "missionpilot-hors-ligne";
export const VERSION_BASE = 1;
export const TABLE = "saisies-temps";
export const CLE_LOCALE = "mp-hors-ligne:saisies-temps";
/** Ancienne file (une clé par feuille) de `lib/file-sauvegarde.ts`. */
export const PREFIXE_ANCIEN = "mp-temps-attente:";

export function magasinMemoire(): Magasin {
  const entrees = new Map<string, SaisieEnAttente>();
  return {
    persistant: false,
    tout: async () => [...entrees.values()].map((e) => structuredClone(e)),
    mettre: async (e) => void entrees.set(e.cle, structuredClone(e)),
    retirer: async (cle) => void entrees.delete(cle),
    vider: async () => entrees.clear(),
  };
}

/** Sous-ensemble de `Storage`, injectable pour les tests. */
export interface StockageCles {
  getItem(cle: string): string | null;
  setItem(cle: string, valeur: string): void;
  removeItem(cle: string): void;
}

export function magasinLocal(s: StockageCles): Magasin {
  const lire = (): SaisieEnAttente[] => {
    try {
      const v = JSON.parse(s.getItem(CLE_LOCALE) ?? "[]") as unknown;
      return Array.isArray(v) ? v.filter(estSaisie) : [];
    } catch {
      return [];
    }
  };
  const ecrire = (liste: SaisieEnAttente[]) => {
    if (liste.length === 0) s.removeItem(CLE_LOCALE);
    else s.setItem(CLE_LOCALE, JSON.stringify(liste));
  };
  return {
    persistant: true,
    tout: async () => lire(),
    mettre: async (e) => ecrire([...lire().filter((x) => x.cle !== e.cle), e]),
    retirer: async (cle) => ecrire(lire().filter((x) => x.cle !== cle)),
    vider: async () => s.removeItem(CLE_LOCALE),
  };
}

function enPromesse<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((ok, ko) => {
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error ?? new Error("IndexedDB"));
  });
}

export function ouvrirBase(idb: IDBFactory): Promise<IDBDatabase> {
  return new Promise((ok, ko) => {
    const r = idb.open(NOM_BASE, VERSION_BASE);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains(TABLE)) db.createObjectStore(TABLE, { keyPath: "cle" });
    };
    r.onsuccess = () => {
      const db = r.result;
      // Purge par le service worker (déconnexion) : libérer la base pour sa suppression.
      db.onversionchange = () => db.close();
      ok(db);
    };
    r.onerror = () => ko(r.error ?? new Error("IndexedDB"));
    r.onblocked = () => ko(new Error("IndexedDB bloquée"));
  });
}

/** Magasin IndexedDB ; la base est rouverte si elle a été fermée (purge par un autre contexte). */
export function magasinIndexedDb(idb: IDBFactory): Magasin {
  let base: Promise<IDBDatabase> | null = null;
  const db = () => {
    base ??= ouvrirBase(idb).then((d) => {
      d.addEventListener?.("close", () => (base = null));
      return d;
    });
    return base;
  };
  async function transaction<T>(
    mode: IDBTransactionMode,
    action: (t: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    let d: IDBDatabase;
    let tx: IDBTransaction;
    try {
      d = await db();
      tx = d.transaction(TABLE, mode);
    } catch {
      // Base fermée par `onversionchange` : on la rouvre une fois.
      base = null;
      d = await db();
      tx = d.transaction(TABLE, mode);
    }
    const resultat = enPromesse(action(tx.objectStore(TABLE)));
    // L'échec d'une requête fait aussi échouer la transaction : il est remonté ci-dessous.
    resultat.catch(() => undefined);
    await new Promise<void>((ok, ko) => {
      tx.oncomplete = () => ok();
      tx.onerror = () => ko(tx.error ?? new Error("IndexedDB"));
      tx.onabort = () => ko(tx.error ?? new Error("IndexedDB : transaction annulée"));
    });
    return resultat;
  }
  return {
    persistant: true,
    tout: async () => {
      const brut = await transaction("readonly", (t) => t.getAll() as IDBRequest<unknown[]>);
      return brut.filter(estSaisie);
    },
    mettre: async (e) => void (await transaction("readwrite", (t) => t.put(e))),
    retirer: async (cle) => void (await transaction("readwrite", (t) => t.delete(cle))),
    vider: async () => void (await transaction("readwrite", (t) => t.clear())),
  };
}

export interface Environnement {
  indexedDB?: IDBFactory | null;
  localStorage?: StockageCles | null;
}

function environnementNavigateur(): Environnement {
  if (typeof window === "undefined") return {};
  const env: Environnement = {};
  try {
    env.indexedDB = window.indexedDB ?? null;
  } catch {
    env.indexedDB = null;
  }
  try {
    const s = window.localStorage;
    s.setItem("mp-test", "1");
    s.removeItem("mp-test");
    env.localStorage = s;
  } catch {
    env.localStorage = null;
  }
  return env;
}

/** Choisit le meilleur magasin disponible (IndexedDB vérifiée par une lecture réelle). */
export async function choisirMagasin(env: Environnement): Promise<Magasin> {
  if (env.indexedDB) {
    try {
      const m = magasinIndexedDb(env.indexedDB);
      await m.tout();
      return m;
    } catch {
      // IndexedDB refusée (mode privé, quota) : repli.
    }
  }
  if (env.localStorage) return magasinLocal(env.localStorage);
  return magasinMemoire();
}

type Ecouteur = () => void;
const ecouteurs = new Set<Ecouteur>();
let canal: BroadcastChannel | null = null;

function canalOnglets(): BroadcastChannel | null {
  if (canal || typeof BroadcastChannel === "undefined") return canal;
  canal = new BroadcastChannel("missionpilot-hors-ligne");
  canal.onmessage = () => ecouteurs.forEach((f) => f());
  return canal;
}

/** Prévient les composants (cet onglet et les autres) qu'une entrée a changé. */
export function notifier() {
  ecouteurs.forEach((f) => f());
  try {
    canalOnglets()?.postMessage("change");
  } catch {
    // Canal fermé : les autres onglets se mettront à jour au prochain rejeu.
  }
}

export function abonner(f: Ecouteur): () => void {
  ecouteurs.add(f);
  canalOnglets();
  return () => void ecouteurs.delete(f);
}

/** Enveloppe qui notifie après chaque écriture. */
export function avecNotification(m: Magasin, prevenir: () => void = notifier): Magasin {
  const apres =
    <A extends unknown[]>(f: (...a: A) => Promise<void>) =>
    async (...a: A) => {
      await f(...a);
      prevenir();
    };
  return {
    get persistant() {
      return m.persistant;
    },
    tout: () => m.tout(),
    mettre: apres((e) => m.mettre(e)),
    retirer: apres((c) => m.retirer(c)),
    vider: apres(() => m.vider()),
  };
}

/**
 * Une écriture refusée par le stockage (quota plein, base supprimée) n'est pas perdue : elle est
 * gardée en mémoire de l'onglet, et `persistant` passe à faux pour que l'interface le dise.
 */
export function avecRepliMemoire(m: Magasin): Magasin {
  const secours = magasinMemoire();
  let degrade = false;
  return {
    get persistant() {
      return m.persistant && !degrade;
    },
    async tout() {
      const principales = await m.tout().catch(() => [] as SaisieEnAttente[]);
      const deSecours = await secours.tout();
      const cles = new Set(deSecours.map((e) => e.cle));
      return [...principales.filter((e) => !cles.has(e.cle)), ...deSecours];
    },
    async mettre(e) {
      try {
        await m.mettre(e);
        await secours.retirer(e.cle);
      } catch {
        degrade = true;
        await secours.mettre(e);
      }
    },
    async retirer(cle) {
      await secours.retirer(cle);
      await m.retirer(cle).catch(() => undefined);
    },
    async vider() {
      await secours.vider();
      await m.vider().catch(() => undefined);
    },
  };
}

let magasin: Promise<Magasin> | null = null;

/** Magasin partagé de l'onglet. */
export function obtenirMagasin(): Promise<Magasin> {
  magasin ??= choisirMagasin(environnementNavigateur()).then((m) =>
    avecNotification(avecRepliMemoire(m)),
  );
  return magasin;
}

/**
 * Efface tout ce que la file hors ligne garde sur l'appareil : IndexedDB, `localStorage` (repli
 * et ancienne file). À appeler à la déconnexion ; le service worker le fait aussi.
 */
export async function purgerDonneesHorsLigne(env: Environnement = environnementNavigateur()) {
  try {
    await (await obtenirMagasin()).vider();
  } catch {
    // Magasin inaccessible : la suppression ci-dessous suffit.
  }
  const s = env.localStorage;
  if (s) {
    try {
      s.removeItem(CLE_LOCALE);
      const cles: string[] = [];
      const parcourable = s as Partial<Storage>;
      for (let i = 0; i < (parcourable.length ?? 0); i++) {
        const k = parcourable.key?.(i);
        if (k?.startsWith(PREFIXE_ANCIEN)) cles.push(k);
      }
      cles.forEach((k) => s.removeItem(k));
    } catch {
      // Stockage indisponible.
    }
  }
  notifier();
}
