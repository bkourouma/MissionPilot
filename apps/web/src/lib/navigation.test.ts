import { describe, expect, it } from "vitest";
import { ROLES, type Role } from "@missionpilot/shared";
import {
  entreesAutorisees,
  estActive,
  NAVIGATION,
  sousPageActive,
  sousPagesAutorisees,
} from "./navigation";

const ids = (roles: Role[]) => entreesAutorisees(roles).map((e) => e.id);

describe("table de navigation", () => {
  it("a des identifiants et des chemins uniques", () => {
    expect(new Set(NAVIGATION.map((e) => e.id)).size).toBe(NAVIGATION.length);
    expect(new Set(NAVIGATION.map((e) => e.href)).size).toBe(NAVIGATION.length);
  });

  it("contient les onze rubriques prévues, dans l'ordre", () => {
    expect(NAVIGATION.map((e) => e.libelle)).toEqual([
      "Tableau de bord",
      "Mon planning",
      "Feuille de temps",
      "Missions",
      "Clients",
      "Collaborateurs",
      "Catalogue",
      "Plan de charge",
      "Facturation",
      "Indicateurs",
      "Paramètres",
    ]);
  });

  it("ne marque disponibles que les écrans livrés (référentiels de la V1)", () => {
    expect(NAVIGATION.filter((e) => e.disponible).map((e) => e.id)).toEqual([
      "tableau-de-bord",
      "clients",
      "collaborateurs",
      "catalogue",
      "parametres",
    ]);
  });

  it("donne des sous-pages aux chemins uniques, rattachées à leur rubrique", () => {
    for (const e of NAVIGATION) {
      const pages = e.sousPages ?? [];
      expect(new Set(pages.map((p) => p.href)).size).toBe(pages.length);
      for (const p of pages) expect(estActive(e, p.href)).toBe(true);
    }
  });
});

describe("entreesAutorisees", () => {
  it("donne tout à l'associé", () => {
    expect(ids(["associe"])).toEqual(NAVIGATION.map((e) => e.id));
  });

  it("donne au consultant son planning, ses temps et la lecture des missions", () => {
    expect(ids(["consultant"])).toEqual([
      "tableau-de-bord",
      "mon-planning",
      "feuille-de-temps",
      "missions",
      "clients",
      "catalogue",
    ]);
  });

  it("ouvre les collaborateurs aux ressources et au gestionnaire, pas au consultant", () => {
    expect(ids(["ressources"])).toContain("collaborateurs");
    expect(ids(["gestionnaire"])).toContain("collaborateurs");
    expect(ids(["consultant"])).not.toContain("collaborateurs");
    expect(ids(["expert_metier"])).not.toContain("collaborateurs");
  });

  it("limite l'expert externe au tableau de bord et à ses temps", () => {
    expect(ids(["expert_externe"])).toEqual([
      "tableau-de-bord",
      "mon-planning",
      "feuille-de-temps",
    ]);
  });

  it("réserve les paramètres du cabinet à l'associé", () => {
    for (const role of ROLES) {
      expect(ids([role]).includes("parametres")).toBe(role === "associe");
    }
  });

  it("ouvre la facturation au gestionnaire, pas au consultant", () => {
    expect(ids(["gestionnaire"])).toContain("facturation");
    expect(ids(["consultant"])).not.toContain("facturation");
  });

  it("ouvre le plan de charge au responsable des ressources", () => {
    expect(ids(["ressources"])).toContain("plan-de-charge");
    expect(ids(["ressources"])).not.toContain("indicateurs");
  });

  it("cumule les droits de plusieurs rôles sans doublon, dans l'ordre de la table", () => {
    const cumul = ids(["expert_metier", "gestionnaire"]);
    expect(new Set(cumul).size).toBe(cumul.length);
    expect(cumul).toContain("catalogue");
    expect(cumul).toContain("facturation");
    const ordre = NAVIGATION.map((e) => e.id).filter((id) => cumul.includes(id));
    expect(cumul).toEqual(ordre);
  });

  it("garde le tableau de bord même sans rôle", () => {
    expect(ids([])).toEqual(["tableau-de-bord"]);
  });
});

describe("estActive", () => {
  it("ne marque l'accueil actif que sur « / »", () => {
    expect(estActive({ href: "/" }, "/")).toBe(true);
    expect(estActive({ href: "/" }, "/missions")).toBe(false);
  });

  it("marque une rubrique active sur ses sous-pages, pas sur un préfixe trompeur", () => {
    expect(estActive({ href: "/missions" }, "/missions")).toBe(true);
    expect(estActive({ href: "/missions" }, "/missions/42")).toBe(true);
    expect(estActive({ href: "/missions" }, "/missions-archivees")).toBe(false);
  });
});

describe("sous-pages", () => {
  it("réserve le journal d'audit à qui a audit.lire", () => {
    expect(sousPagesAutorisees("parametres", ["associe"]).map((p) => p.id)).toEqual([
      "cabinet",
      "utilisateurs",
      "journal",
    ]);
    expect(sousPagesAutorisees("parametres", ["gestionnaire"])).toEqual([]);
  });

  it("donne les types et les grades à tout lecteur du catalogue", () => {
    expect(sousPagesAutorisees("catalogue", ["consultant"]).map((p) => p.id)).toEqual([
      "types",
      "grades",
    ]);
    expect(sousPagesAutorisees("inconnue", ["associe"])).toEqual([]);
  });

  it("active la sous-page la plus précise", () => {
    const pages = sousPagesAutorisees("catalogue", ["associe"]);
    expect(sousPageActive(pages, "/catalogue")).toBe("types");
    expect(sousPageActive(pages, "/catalogue/0b6c2d1e-0000-4000-8000-000000000000")).toBe("types");
    expect(sousPageActive(pages, "/catalogue/grades")).toBe("grades");
    expect(sousPageActive(pages, "/clients")).toBeNull();
  });
});
