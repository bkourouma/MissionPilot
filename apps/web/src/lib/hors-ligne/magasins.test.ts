import { describe, expect, it } from "vitest";
import { mettreEnFile, type SaisieEnAttente } from "./file-temps";
import {
  avecNotification,
  avecRepliMemoire,
  choisirMagasin,
  CLE_LOCALE,
  magasinIndexedDb,
  magasinLocal,
  NOM_BASE,
  PREFIXE_ANCIEN,
  purgerDonneesHorsLigne,
  TABLE,
  type StockageCles,
} from "./magasins";
import { IdbSimule } from "./test/idb-simule";

function stockage(): StockageCles & {
  donnees: Map<string, string>;
  length: number;
  key(i: number): string | null;
} {
  const donnees = new Map<string, string>();
  return {
    donnees,
    get length() {
      return donnees.size;
    },
    key: (i) => [...donnees.keys()][i] ?? null,
    getItem: (k) => donnees.get(k) ?? null,
    setItem: (k, v) => void donnees.set(k, v),
    removeItem: (k) => void donnees.delete(k),
  };
}

const entree = (cle: string): Omit<SaisieEnAttente, "sequence" | "etat" | "tentatives"> => ({
  cle,
  utilisateurId: "u1",
  feuilleId: `f-${cle}`,
  semaine: "2026-10-05",
  unite: "heure",
  creeLe: 1,
  rangees: [],
  valeurs: {},
  charge: { lignes: [] },
});

describe("choix du magasin", () => {
  it("IndexedDB quand il fonctionne", async () => {
    const idb = new IdbSimule();
    const m = await choisirMagasin({ indexedDB: idb.fabrique, localStorage: stockage() });
    await mettreEnFile(m, entree("a"));
    expect(idb.lignes(NOM_BASE, TABLE)).toHaveLength(1);
  });

  it("repli sur localStorage si IndexedDB est refusé", async () => {
    const idb = new IdbSimule();
    idb.echouerOuverture = true;
    const s = stockage();
    const m = await choisirMagasin({ indexedDB: idb.fabrique, localStorage: s });
    expect(m.persistant).toBe(true);
    await mettreEnFile(m, entree("a"));
    expect(JSON.parse(s.getItem(CLE_LOCALE) ?? "[]")).toHaveLength(1);
  });

  it("repli en mémoire (non persistant) sans aucun stockage", async () => {
    const m = await choisirMagasin({ indexedDB: null, localStorage: null });
    expect(m.persistant).toBe(false);
    await mettreEnFile(m, entree("a"));
    expect(await m.tout()).toHaveLength(1);
  });
});

describe("magasin localStorage", () => {
  it("ignore un contenu corrompu ou mal formé", async () => {
    const s = stockage();
    s.setItem(CLE_LOCALE, "{pas du json");
    expect(await magasinLocal(s).tout()).toEqual([]);
    s.setItem(CLE_LOCALE, JSON.stringify([{ cle: "x" }]));
    expect(await magasinLocal(s).tout()).toEqual([]);
  });

  it("retire la clé quand la file est vide", async () => {
    const s = stockage();
    const m = magasinLocal(s);
    await mettreEnFile(m, entree("a"));
    await m.retirer("a");
    expect(s.getItem(CLE_LOCALE)).toBeNull();
  });
});

describe("magasin IndexedDB", () => {
  it("rouvre la base fermée par une purge (versionchange) et reste utilisable", async () => {
    const idb = new IdbSimule();
    const m = magasinIndexedDb(idb.fabrique);
    await mettreEnFile(m, entree("a"));
    await new Promise<void>((ok, ko) => {
      const r = idb.deleteDatabase(NOM_BASE);
      r.onsuccess = () => ok();
      r.onblocked = () => ko(new Error("bloquée"));
    });
    expect(await m.tout()).toEqual([]);
    await mettreEnFile(m, entree("b"));
    expect((await m.tout()).map((e) => e.cle)).toEqual(["b"]);
  });

  it("ignore les lignes mal formées", async () => {
    const idb = new IdbSimule();
    const m = magasinIndexedDb(idb.fabrique);
    await m.tout();
    idb.bases.get(NOM_BASE)?.tables.get(TABLE)?.lignes.set("x", { cle: "x" });
    expect(await m.tout()).toEqual([]);
  });
});

describe("repli en mémoire sur écriture refusée", () => {
  it("garde la saisie quand le quota est plein et le signale", async () => {
    const idb = new IdbSimule();
    const m = avecRepliMemoire(magasinIndexedDb(idb.fabrique));
    await mettreEnFile(m, entree("a"));
    expect(m.persistant).toBe(true);
    idb.echouerEcritures = true;
    await mettreEnFile(m, entree("b"));
    expect(m.persistant).toBe(false);
    expect((await m.tout()).map((e) => e.cle).sort()).toEqual(["a", "b"]);
    await m.retirer("b");
    expect((await m.tout()).map((e) => e.cle)).toEqual(["a"]);
    idb.echouerEcritures = false;
    await m.vider();
    expect(await m.tout()).toHaveLength(0);
  });
});

describe("notification et purge", () => {
  it("prévient après chaque écriture", async () => {
    let n = 0;
    const s = stockage();
    const m = avecNotification(magasinLocal(s), () => n++);
    await mettreEnFile(m, entree("a"));
    await m.retirer("a");
    await m.vider();
    expect(n).toBe(3);
  });

  it("efface le repli localStorage et l'ancienne file", async () => {
    const s = stockage();
    s.setItem(CLE_LOCALE, "[]");
    s.setItem(`${PREFIXE_ANCIEN}f1`, "{}");
    s.setItem("autre-cle", "garde");
    await purgerDonneesHorsLigne({ localStorage: s });
    expect([...s.donnees.keys()]).toEqual(["autre-cle"]);
  });
});
