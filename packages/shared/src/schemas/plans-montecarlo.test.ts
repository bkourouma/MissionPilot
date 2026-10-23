import { describe, expect, it } from "vitest";
import {
  loiMonteCarloSchema,
  planMonteCarloDefautsQuerySchema,
  planMonteCarloListeQuerySchema,
  planMonteCarloSimulationSchema,
} from "./plans-montecarlo";

const loi = { type: "triangulaire", min: -5, mode: 0, max: 5 } as const;
const corps = { version: 1, hypotheses: [{ cible: "tauxMargeBrute", loi }] };

describe("planMonteCarloSimulationSchema", () => {
  it("accepte une simulation minimale (1000 tirages, graine absente)", () => {
    const r = planMonteCarloSimulationSchema.parse(corps);
    expect(r.tirages).toBe(1000);
    expect(r.graine).toBeUndefined();
  });

  it("borne la graine et les tirages", () => {
    const ok = (extra: object) => planMonteCarloSimulationSchema.safeParse({ ...corps, ...extra });
    expect(ok({ graine: 0, tirages: 100 }).success).toBe(true);
    expect(ok({ graine: 4_294_967_295, tirages: 2000 }).success).toBe(true);
    expect(ok({ graine: -1 }).success).toBe(false);
    expect(ok({ graine: 4_294_967_296 }).success).toBe(false);
    expect(ok({ graine: 1.5 }).success).toBe(false);
    expect(ok({ tirages: 99 }).success).toBe(false);
    expect(ok({ tirages: 2001 }).success).toBe(false);
  });

  it("refuse plus de 5 hypothèses, aucune, un doublon, une cible inconnue", () => {
    const h = (cible: string) => ({ cible, loi });
    const cinq = [
      "croissanceChiffreAffaires",
      "tauxMargeBrute",
      "tauxChargesVariables",
      "chargesFixes",
      "delaiClientsJours",
    ].map(h);
    expect(planMonteCarloSimulationSchema.safeParse({ ...corps, hypotheses: cinq }).success).toBe(
      true,
    );
    expect(
      planMonteCarloSimulationSchema.safeParse({
        ...corps,
        hypotheses: [...cinq, h("tauxMargeBrute")],
      }).success,
    ).toBe(false);
    expect(planMonteCarloSimulationSchema.safeParse({ ...corps, hypotheses: [] }).success).toBe(
      false,
    );
    expect(
      planMonteCarloSimulationSchema.safeParse({
        ...corps,
        hypotheses: [h("tauxMargeBrute"), h("tauxMargeBrute")],
      }).success,
    ).toBe(false);
    expect(
      planMonteCarloSimulationSchema.safeParse({ ...corps, hypotheses: [h("autre")] }).success,
    ).toBe(false);
  });

  it("est strict : champ inconnu refusé, y compris dans une loi", () => {
    expect(planMonteCarloSimulationSchema.safeParse({ ...corps, plan: "x" }).success).toBe(false);
    expect(loiMonteCarloSchema.safeParse({ ...loi, extra: 1 }).success).toBe(false);
  });
});

describe("loiMonteCarloSchema", () => {
  it("valide comme le moteur", () => {
    expect(loiMonteCarloSchema.safeParse({ type: "uniforme", min: 0, max: 1 }).success).toBe(true);
    expect(loiMonteCarloSchema.safeParse({ type: "uniforme", min: 1, max: 1 }).success).toBe(false);
    expect(loiMonteCarloSchema.safeParse({ ...loi, mode: 6 }).success).toBe(false);
    expect(loiMonteCarloSchema.safeParse({ type: "uniforme", min: 0, max: 1001 }).success).toBe(
      false,
    );
    const normale = { type: "normale", moyenne: 0, ecartType: 2, min: -5, max: 5 };
    expect(loiMonteCarloSchema.safeParse(normale).success).toBe(true);
    expect(loiMonteCarloSchema.safeParse({ ...normale, ecartType: 0 }).success).toBe(false);
    expect(loiMonteCarloSchema.safeParse({ ...normale, moyenne: 9 }).success).toBe(false);
    expect(loiMonteCarloSchema.safeParse({ type: "gamma", min: 0, max: 1 }).success).toBe(false);
  });
});

describe("requêtes", () => {
  it("liste : limite par défaut ; défauts : version facultative", () => {
    expect(planMonteCarloListeQuerySchema.parse({}).limite).toBe(30);
    expect(planMonteCarloListeQuerySchema.safeParse({ limite: 101 }).success).toBe(false);
    expect(planMonteCarloDefautsQuerySchema.parse({}).version).toBeUndefined();
    expect(planMonteCarloDefautsQuerySchema.parse({ version: "2" }).version).toBe(2);
    expect(planMonteCarloDefautsQuerySchema.safeParse({ version: "0" }).success).toBe(false);
  });
});
