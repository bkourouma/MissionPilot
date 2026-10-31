import { describe, expect, it } from "vitest";
import { ajouterJours } from "@missionpilot/engines";
import { AUJOURDHUI } from "../src/db/tenant-demo/constantes.js";
import {
  ENVOIS,
  limiteFinale,
  limiteInitiale,
  limitePendantSaisie,
} from "../src/db/tenant-demo/notation-plans/questionnaires-envois.js";

/*
 * Envois de questionnaires du Tenant démo face à l'horloge RÉELLE (régression du 2026-10-31 :
 * « Saisie de baobab.dg (baobab-preliminaire) : HTTP 409 DATE_LIMITE_DEPASSEE » dès que le semis
 * tourne après la date limite fictive). Fonctions pures, indépendantes du jour d'exécution : le
 * jour réel est un paramètre. Le circuit complet par les routes est couvert par
 * seed-tenant-demo-notation-plans.test.ts (envois à date limite fictive déjà dépassée).
 */

const jour = (offset: number): string => ajouterJours(AUJOURDHUI, offset);

describe("date limite des envois du Tenant démo et horloge réelle", () => {
  it("lève une date limite dépassée ou atteinte au jour réel le temps des saisies", () => {
    expect(limitePendantSaisie("2026-10-30", "2026-10-31")).toBeNull();
    expect(limitePendantSaisie("2026-10-31", "2026-10-31")).toBeNull();
    expect(limitePendantSaisie("2024-11-22", "2031-01-01")).toBeNull();
  });

  it("garde une date limite encore à venir, ou l'absence de date limite", () => {
    expect(limitePendantSaisie("2026-11-01", "2026-10-31")).toBe("2026-11-01");
    expect(limitePendantSaisie(null, "2026-10-31")).toBeNull();
  });

  it("pose la date fictive à la création et dans l'état final, quel que soit le jour réel", () => {
    expect(limiteInitiale({ limiteDans: 6 }, jour)).toBe("2026-10-30");
    expect(limiteInitiale({}, jour)).toBeNull();
    expect(limiteFinale({ limiteDans: 9 }, jour)).toBe("2026-11-02");
    expect(limiteFinale({ limitePassee: "2025-03-14" }, jour)).toBe("2025-03-14");
  });

  it("ne demande, à aucun jour réel, une saisie du portail sur une date limite dépassée", () => {
    // Pour chaque jour réel de la fenêtre (avant, pendant et longtemps après l'horloge fictive),
    // la date en place pendant les saisies est nulle ou postérieure au jour réel.
    const jours = [-3, 0, 1, 6, 7, 30, 400].map((n) => ajouterJours(AUJOURDHUI, n));
    for (const reel of jours) {
      for (const def of ENVOIS) {
        const pendant = limitePendantSaisie(limiteInitiale(def, jour), reel);
        expect(pendant === null || pendant > reel, `${def.cle} au ${reel}`).toBe(true);
      }
    }
  });

  it("ne relance que des envois sans date passée imposée (la relance garde la date initiale)", () => {
    for (const def of ENVOIS.filter((d) => d.relancer)) {
      expect(def.limitePassee, def.cle).toBeUndefined();
      expect(limiteFinale(def, jour)).toBe(limiteInitiale(def, jour));
    }
  });
});
