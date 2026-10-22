import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api } from "./api.js";
import { demarrer, type Contexte } from "./helpers.js";
import { INCONNU, preparerDd, type ScenarioDd } from "./dd-outils.js";
import { inviterClient, type UtilisateurPortail } from "./portail-outils.js";

/*
 * Accès au service #2 sur TOUTES ses routes : inventaire (53 routes R01 à R53), 401 sans session,
 * portail fermé (403 PORTAIL_ROUTE_INTERDITE avant tout accès), matrice des rôles de la
 * spécification §7 (dd.lire, dd.ecrire, dd.valider, dd.referentiel.gerer), et chaque gestionnaire
 * appelle `exiger` (recherche mécanique n° 10 de la check-list).
 */

let ctx: Contexte;
let s: ScenarioDd;
let portail: UtilisateurPortail;

beforeAll(async () => {
  ctx = await demarrer();
  s = await preparerDd(ctx, "DD acces");
  portail = await inviterClient(ctx, s.a.associe, s.a.clientId, ["client_contributeur"]);
}, 240_000);
afterAll(() => ctx.fermer());

const routesDd = () =>
  ctx.app.routesInventoriees.filter(
    (r) =>
      (r.motif.startsWith("/api/dd/") || r.motif.includes("/dd/")) &&
      r.methode !== "OPTIONS" &&
      r.methode !== "HEAD",
  );

const concret = (motif: string) => motif.replace(/:[A-Za-z_]+/g, INCONNU);

describe("inventaire", () => {
  it("74 routes (R01 à R53, 6 des modèles sectoriels DD-07, 8 du portail investisseur, 7 de l'ingestion de documents du lot 6), aucune en PUT ou DELETE ; un seul PATCH (correction d'un brouillon de lecture)", () => {
    const routes = routesDd();
    expect(routes).toHaveLength(74);
    expect(
      routes
        .filter((r) => !["GET", "POST"].includes(r.methode))
        .map((r) => `${r.methode} ${r.motif}`),
    ).toEqual(["PATCH /api/dd/extractions/:id"]);
  });

  it("chaque gestionnaire de routes/due-diligence*.ts et de R52, R53 appelle exiger", () => {
    const dossier = "src/routes";
    const fichiers = readdirSync(dossier).filter((f) => f.startsWith("due-diligence"));
    expect(fichiers.length).toBeGreaterThanOrEqual(5);
    let n = 0;
    for (const f of [...fichiers, "rapports.ts"]) {
      const t = readFileSync(`${dossier}/${f}`, "utf8");
      const re = /app\.(get|post|put|patch|delete)\(\s*(["`][^"`]*["`])/g;
      const p: { i: number; chemin: string }[] = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(t))) p.push({ i: m.index, chemin: m[2] as string });
      p.forEach((x, k) => {
        if (f === "rapports.ts" && !x.chemin.includes("/dd/")) return;
        n += 1;
        const corps = t.slice(x.i, k + 1 < p.length ? (p[k + 1] as { i: number }).i : t.length);
        expect(/exiger/.test(corps), `${f} ${x.chemin}`).toBe(true);
      });
    }
    // R01 à R53, 6 gestionnaires des modèles sectoriels (DD-07) et ceux des fichiers due-diligence-portail*.
    expect(n).toBe(70);
  });
});

describe("401 et portail fermé", () => {
  it("sans session : 401 sur chaque route", async () => {
    for (const { methode, motif } of routesDd()) {
      const r = await ctx.app.inject({
        method: methode as "GET",
        url: concret(motif),
        ...(methode === "GET" ? {} : { payload: {} }),
      });
      expect(r.statusCode, `${methode} ${motif}`).toBe(401);
    }
  });

  it("un compte du portail : 403 PORTAIL_ROUTE_INTERDITE sur chaque route", async () => {
    for (const { methode, motif } of routesDd()) {
      const r = await ctx.app.inject({
        method: methode as "GET",
        url: concret(motif),
        headers: { cookie: portail.cookie },
        ...(methode === "GET" ? {} : { payload: {} }),
      });
      expect(r.statusCode, `${methode} ${motif}`).toBe(403);
      expect(r.json().erreur.code, `${methode} ${motif}`).toBe("PORTAIL_ROUTE_INTERDITE");
    }
  });
});

describe("matrice des rôles (§7)", () => {
  const lecteurs = () => [s.a.associe, s.a.directeur, s.a.chef, s.consultantEquipe, s.expertMetier];
  const autres = () => [s.ressources, s.gestionnaire, s.expertExterne];

  it("dd.lire : associé, directeur, chef, consultant, expert métier ; ni ressources, ni gestionnaire, ni expert externe", async () => {
    const url = `/api/missions/${s.missionId}/dd/dossiers`;
    for (const u of lecteurs()) expect((await u.get(url)).statusCode).toBe(200);
    for (const u of autres()) expect((await u.get(url)).statusCode).toBe(403);
    for (const u of autres())
      expect((await u.post("/api/dd/dimensionnements/calculer", {})).statusCode).toBe(403);
  });

  it("dd.ecrire : associé, directeur, chef, consultant ; pas l'expert métier", async () => {
    const url = `/api/dd/dossiers/${INCONNU}/hypotheses`;
    for (const u of [s.a.associe, s.a.directeur, s.a.chef, s.consultantEquipe]) {
      expect((await u.post(url, { libelle: "x" })).statusCode).toBe(404);
    }
    for (const u of [s.expertMetier, ...autres()]) {
      expect((await u.post(url, { libelle: "x" })).statusCode).toBe(403);
    }
  });

  it("dd.valider : associé, directeur, chef, expert métier ; pas le consultant", async () => {
    const url = `/api/dd/verdicts/${INCONNU}/validation`;
    for (const u of [s.a.associe, s.a.directeur, s.a.chef, s.expertMetier]) {
      expect((await u.post(url, { decision: "valide" })).statusCode).toBe(404);
    }
    for (const u of [s.consultantEquipe, ...autres()]) {
      expect((await u.post(url, { decision: "valide" })).statusCode).toBe(403);
    }
  });

  it("dd.referentiel.gerer : associé, directeur, expert métier ; ni chef ni consultant", async () => {
    const url = `/api/dd/signaux/${INCONNU}/versions`;
    const corps = {
      libelle: "x",
      famille: "pays",
      gravite_indicative: "faible",
      version_courante: 1,
      motif: "x.",
    };
    for (const u of [s.a.associe, s.a.directeur, s.expertMetier]) {
      expect((await u.post(url, corps)).statusCode).toBe(404);
    }
    for (const u of [s.a.chef, s.consultantEquipe, ...autres()]) {
      expect((await u.post(url, corps)).statusCode).toBe(403);
    }
    expect((await api(ctx).post(url, corps)).statusCode).toBe(401);
  });
});
