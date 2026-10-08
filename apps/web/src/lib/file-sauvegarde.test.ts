import { describe, expect, it } from "vitest";
import { ErreurApi } from "./api";
import {
  abandonner,
  aReprendre,
  cleFile,
  confirmerEnvoi,
  delaiReprise,
  estReessayable,
  lireFile,
  mettreEnFile,
  type Instantane,
  type Stockage,
} from "./file-sauvegarde";

function memoire(): Stockage & { donnees: Map<string, string> } {
  const donnees = new Map<string, string>();
  return {
    donnees,
    getItem: (c) => donnees.get(c) ?? null,
    setItem: (c, v) => void donnees.set(c, v),
    removeItem: (c) => void donnees.delete(c),
  };
}

const instantane = (modifieLe: number, valeur = "1"): Instantane => ({
  feuilleId: "f1",
  rangees: ["t:a"],
  valeurs: { "t:a|2026-10-05": valeur },
  modifieLe,
});

describe("file locale de la feuille de temps", () => {
  it("garde le dernier instantané de chaque feuille et le relit", () => {
    const s = memoire();
    expect(mettreEnFile(s, instantane(1, "1"))).toBe(true);
    expect(mettreEnFile(s, instantane(2, "1,5"))).toBe(true);
    expect(s.donnees.size).toBe(1);
    expect(lireFile(s, "f1")?.valeurs).toEqual({ "t:a|2026-10-05": "1,5" });
    expect(lireFile(s, "autre")).toBeNull();
  });

  it("ne retire que l'instantané confirmé, jamais une saisie plus récente", () => {
    const s = memoire();
    mettreEnFile(s, instantane(5));
    confirmerEnvoi(s, "f1", 3);
    expect(lireFile(s, "f1")).not.toBeNull();
    confirmerEnvoi(s, "f1", 5);
    expect(lireFile(s, "f1")).toBeNull();
  });

  it("ignore une entrée corrompue ou d'une autre feuille", () => {
    const s = memoire();
    s.setItem(cleFile("f1"), "{pas du json");
    expect(lireFile(s, "f1")).toBeNull();
    s.setItem(cleFile("f1"), JSON.stringify({ ...instantane(1), feuilleId: "f2" }));
    expect(lireFile(s, "f1")).toBeNull();
    s.setItem(cleFile("f1"), JSON.stringify({ ...instantane(1), valeurs: { x: 3 } }));
    expect(lireFile(s, "f1")).toBeNull();
  });

  it("supporte un stockage absent ou qui refuse l'écriture (navigation privée, quota)", () => {
    expect(mettreEnFile(null, instantane(1))).toBe(false);
    expect(lireFile(null, "f1")).toBeNull();
    const plein: Stockage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => undefined,
    };
    expect(mettreEnFile(plein, instantane(1))).toBe(false);
    expect(() => confirmerEnvoi(null, "f1", 1)).not.toThrow();
    expect(() => abandonner(null, "f1")).not.toThrow();
  });

  it("reprend une saisie postérieure au serveur sur une feuille encore modifiable", () => {
    const i = instantane(Date.parse("2026-10-06T10:00:00Z"));
    expect(aReprendre(i, { modifiable: true, modifieLe: "2026-10-06T09:00:00Z" })).toBe(i);
    expect(aReprendre(i, { modifiable: true, modifieLe: "2026-10-06T11:00:00Z" })).toBeNull();
    expect(aReprendre(i, { modifiable: false, modifieLe: "2026-10-06T09:00:00Z" })).toBeNull();
    expect(aReprendre(null, { modifiable: true, modifieLe: "" })).toBeNull();
  });

  it("ne retente que les erreurs de réseau, de délai ou d'indisponibilité", () => {
    expect(estReessayable(new ErreurApi("RESEAU_INDISPONIBLE", "x", 0))).toBe(true);
    expect(estReessayable(new ErreurApi("SERVICE_INDISPONIBLE", "x", 503))).toBe(true);
    expect(estReessayable(new ErreurApi("REQUETE_INVALIDE", "x", 400))).toBe(false);
    expect(estReessayable(new ErreurApi("CONFLIT", "x", 409))).toBe(false);
    expect(estReessayable(new Error("x"))).toBe(false);
  });

  it("espace les tentatives de 2 s à 30 s", () => {
    expect([0, 1, 2, 3, 4, 10].map(delaiReprise)).toEqual([2000, 4000, 8000, 16000, 30000, 30000]);
  });
});
