import { describe, expect, it } from "vitest";
import {
  chronologieCommerciale,
  dateClotureFictive,
} from "../src/db/tenant-demo/missions/chronologie.js";
import { CASTING } from "../src/db/tenant-demo/missions/donnees-casting.js";

/* Fonctions pures de datation du Tenant démo (sans base). */

describe("dateClotureFictive", () => {
  const plafond = "2026-10-23";

  it("sans écriture métier : fin de mission + 6 jours + 2 jours", () => {
    expect(dateClotureFictive("2025-11-14", null, plafond)).toBe("2025-11-22");
  });

  it("écriture métier avant la fin + 6 jours : elle ne change rien", () => {
    expect(dateClotureFictive("2025-11-14", "2025-11-16", plafond)).toBe("2025-11-22");
  });

  it("écriture métier tardive (avoir, rapport) : clôture deux jours après", () => {
    expect(dateClotureFictive("2025-11-14", "2025-11-28", plafond)).toBe("2025-11-30");
    expect(dateClotureFictive("2025-12-19", "2026-01-14", plafond)).toBe("2026-01-16");
  });

  it("jamais après le plafond", () => {
    expect(dateClotureFictive("2026-05-29", "2026-10-22", plafond)).toBe(plafond);
    expect(dateClotureFictive("2026-05-29", "2026-12-01", plafond)).toBe(plafond);
  });

  it("toujours postérieure à la dernière date métier tant que le plafond le permet", () => {
    for (const derniere of ["2025-12-01", "2026-02-10", "2026-10-01"]) {
      expect(dateClotureFictive("2025-11-14", derniere, plafond) > derniere).toBe(true);
    }
  });
});

describe("chronologieCommerciale", () => {
  it("dates strictement croissantes pour les 11 missions du casting", () => {
    for (const d of CASTING) {
      const c = chronologieCommerciale(d);
      const suite = [c.opportunite, c.proposition, c.validee, c.envoyee, c.repondue];
      expect(suite, d.nom).toEqual([...suite].sort());
      expect(new Set(suite).size, d.nom).toBe(5);
      expect(c.mission > c.repondue, d.nom).toBe(true);
    }
  });
});
