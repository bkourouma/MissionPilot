/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  VEILLE_IMPORT_AVIS_MAX as AVIS_MOTEUR,
  VEILLE_IMPORT_OCTETS_MAX,
} from "@missionpilot/engines";
import {
  VEILLE_IMPORT_AVIS_MAX,
  VEILLE_IMPORT_TEXTE_MAX,
  VEILLE_RESULTATS_MAX,
} from "@missionpilot/shared";
import { LISTE_BLANCHE_PORTAIL } from "../src/portail/garde.js";
import { SOURCES_VEILLE } from "../src/appels-offres/veille-sources.js";
import { api, cabinetTest, type Api, type CabinetTest } from "./api.js";
import { proprietaire, demarrer, type Contexte } from "./helpers.js";
import { attendre, inviterClient } from "./portail-outils.js";

/*
 * Veille multi-sources des appels d'offres (AO-01, lot 5b) : sources simulées activables, collecte
 * à la main, import CSV/JSON, dédoublonnage inter-sources et contre les fiches, rapprochement
 * expliqué (matrice de compétences, banque de références), décisions en ajout seul, création de
 * fiche, plafonds, droits, isolation et portail fermé. Aucun appel réseau.
 */

const V = "/api/appels-offres/veille";
let ctx: Contexte;
let a: CabinetTest;
let b: CabinetTest;
let chef: Api & { utilisateurId: string };
let expert: Api & { utilisateurId: string };
let ressources: Api & { utilisateurId: string };
let anonyme: Api;
let compteur = 0;

const jourIso = (delta: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
};
const ref = () => `VEI-${Date.now()}-${(compteur += 1)}`;
const avis = (extra: Record<string, unknown> = {}) => ({
  reference: ref(),
  titre: "Évaluation d'un programme de santé communautaire",
  bailleur: "Banque mondiale",
  pays: "CI",
  secteur: "Santé",
  date_limite: jourIso(30),
  ...extra,
});

async function codeBase(sql: string, params: unknown[] = []): Promise<string | null> {
  return proprietaire(async (c) => {
    try {
      await c.query(sql, params);
      return null;
    } catch (e) {
      return (e as { code?: string }).code ?? "?";
    }
  });
}

beforeAll(async () => {
  ctx = await demarrer();
  a = await cabinetTest(ctx, "Veille A");
  b = await cabinetTest(ctx, "Veille B");
  chef = await a.avecRoles(["chef_mission"]);
  expert = await a.avecRoles(["expert_metier"]);
  ressources = await a.avecRoles(["ressources"]);
  anonyme = api(ctx);
  attendre(
    201,
    await a.associe.post("/api/collaborateurs", {
      nom: "Experte santé",
      competences: ["Évaluation de programmes", "Contrôle interne"],
      secteurs: ["Santé"],
    }),
    "collaborateur",
  );
}, 180_000);
afterAll(async () => {
  await ctx.fermer();
});

describe("contrat et absence de réseau", () => {
  it("plafonds du moteur et du contrat partagé identiques", () => {
    expect(VEILLE_IMPORT_AVIS_MAX).toBe(AVIS_MOTEUR);
    expect(VEILLE_IMPORT_TEXTE_MAX).toBe(VEILLE_IMPORT_OCTETS_MAX);
  });

  it("adaptateurs simulés : déterministes, dates dérivées de maintenant, aucun réseau", async () => {
    const fetchEspion = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("réseau interdit");
    });
    const maintenant = new Date();
    for (const s of SOURCES_VEILLE) {
      const un = await s.collecter({ maintenant });
      expect(await s.collecter({ maintenant })).toEqual(un);
      expect(un.length).toBeGreaterThan(0);
      for (const x of un) {
        expect(x.date_limite && x.date_limite > (x.date_publication as string)).toBe(true);
        if (x.url) expect(x.url).toMatch(/^https:\/\/[a-z.]+\.invalid\//);
      }
    }
    const demain = new Date(maintenant.getTime() + 86_400_000);
    const [avant, apres] = await Promise.all([
      SOURCES_VEILLE[0]!.collecter({ maintenant }),
      SOURCES_VEILLE[0]!.collecter({ maintenant: demain }),
    ]);
    expect(apres[0]!.date_limite! > avant[0]!.date_limite!).toBe(true);
    expect(fetchEspion).not.toHaveBeenCalled();
    fetchEspion.mockRestore();
    const code = readFileSync(
      new URL("../src/appels-offres/veille-sources.ts", import.meta.url),
      "utf8",
    )
      .split("\n")
      .filter(
        (l) =>
          !l.trim().startsWith("*") && !l.trim().startsWith("/*") && !l.trim().startsWith("//"),
      )
      .join("\n");
    expect(code).not.toMatch(
      /fetch\(|node:https?|from "https?"|undici|axios|XMLHttpRequest|WebSocket/,
    );
  });
});

describe("droits, portail et routes", () => {
  it("401 sans session, 403 sans ao.lire ou ao.gerer", async () => {
    expect((await anonyme.get(`${V}/sources`)).statusCode).toBe(401);
    expect((await anonyme.post(`${V}/collecte`, {})).statusCode).toBe(401);
    expect((await ressources.get(`${V}/sources`)).statusCode).toBe(403);
    expect((await ressources.get(`${V}/resultats`)).statusCode).toBe(403);
    expect((await expert.get(`${V}/sources`)).statusCode).toBe(200);
    expect((await expert.get(V)).statusCode).toBe(200);
    expect((await expert.put(`${V}/sources/sim_presse`, { active: true })).statusCode).toBe(403);
    expect((await expert.post(`${V}/collecte`, {})).statusCode).toBe(403);
    expect((await expert.post(`${V}/avis`, avis())).statusCode).toBe(403);
    expect((await expert.post(`${V}/import`, { texte: "titre\nx" })).statusCode).toBe(403);
    const inconnu = "00000000-0000-4000-8000-000000000000";
    for (const action of ["retenir", "ecarter", "reexaminer", "fiche"]) {
      expect((await expert.post(`${V}/resultats/${inconnu}/${action}`, {})).statusCode).toBe(403);
    }
    expect((await chef.get(`${V}/resultats/${inconnu}`)).statusCode).toBe(404);
  });

  it("/appels-offres/veille n'est pas avalé par /appels-offres/:id", async () => {
    const r = await chef.get(V);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ total: expect.any(Number), plafond: VEILLE_RESULTATS_MAX });
    expect(
      (await chef.get("/api/appels-offres/00000000-0000-4000-8000-000000000000")).statusCode,
    ).toBe(404);
  });

  it("portail client : route absente de la liste blanche, 403 partout", async () => {
    expect(LISTE_BLANCHE_PORTAIL.map((r) => r.motif).filter((m) => m.includes("veille"))).toEqual(
      [],
    );
    const c = await a.associe.post("/api/clients", { raison_sociale: "Client veille (fictif)" });
    attendre(201, c, "client");
    const portail = await inviterClient(ctx, a.associe, c.json().id, ["client_dirigeant"]);
    for (const [methode, url] of [
      ["get", V],
      ["get", `${V}/sources`],
      ["get", `${V}/resultats`],
      ["put", `${V}/sources/sim_presse`],
      ["post", `${V}/collecte`],
      ["post", `${V}/avis`],
      ["post", `${V}/import`],
    ] as const) {
      const r = await (portail as any)[methode](url, { active: true });
      expect(r.statusCode, `${methode} ${url}`).toBe(403);
      expect(r.json().erreur.code).toBe("PORTAIL_ROUTE_INTERDITE");
    }
  });
});

describe("sources et collecte", () => {
  it("désactivées par défaut ; collecte refusée sans source activée", async () => {
    const r = (await chef.get(`${V}/sources`)).json();
    expect(r.elements.map((s: any) => s.code)).toEqual(SOURCES_VEILLE.map((s) => s.code));
    expect(r.elements.every((s: any) => s.active === false && s.simulee === true)).toBe(true);
    const c = await chef.post(`${V}/collecte`, {});
    expect(c.statusCode).toBe(409);
    expect((await chef.put(`${V}/sources/inconnue`, { active: true })).statusCode).toBe(404);
    expect((await chef.put(`${V}/sources/sim_presse`, { active: "oui" })).statusCode).toBe(400);
    const demandee = await chef.post(`${V}/collecte`, { sources: ["sim_presse"] });
    expect(demandee.statusCode).toBe(409);
  });

  it("collecte des trois sources : dédoublonnage inter-sources, occurrences, rejeu sans effet", async () => {
    for (const s of SOURCES_VEILLE) {
      const r = await chef.put(`${V}/sources/${s.code}`, { active: true });
      attendre(200, r, "activation");
      expect(r.json().active).toBe(true);
    }
    const c = await chef.post(`${V}/collecte`, {});
    attendre(201, c, "collecte");
    const bilan = c.json();
    expect(bilan).toMatchObject({ lus: 8, nouveaux: 6, doublons: 2, plafond: 0 });
    expect(bilan.sources.map((s: any) => s.code)).toEqual(SOURCES_VEILLE.map((s) => s.code));

    const liste = (await chef.get(`${V}/resultats?limite=100`)).json();
    expect(liste.total).toBe(6);
    const mp1 = liste.elements.find((x: any) => x.reference === "SIM-MP-001");
    expect(mp1.nb_occurrences).toBe(2);
    expect(mp1.sources).toHaveLength(2);
    expect(mp1.date_limite).toBe(jourIso(30));
    const eau = liste.elements.find((x: any) =>
      x.titre.startsWith("Revue de la gestion financière"),
    );
    expect(eau.nb_occurrences).toBe(2);
    // Trié par score décroissant.
    const scores = liste.elements.map((x: any) => x.score_rapprochement);
    expect(scores).toEqual([...scores].sort((x: number, y: number) => y - x));

    const rejeu = (await chef.post(`${V}/collecte`, {})).json();
    expect(rejeu).toMatchObject({ lus: 8, nouveaux: 0, doublons: 8 });
    const detail = (await chef.get(`${V}/resultats/${mp1.id}`)).json();
    expect(detail.occurrences).toHaveLength(2);

    const un = (await chef.post(`${V}/collecte`, { sources: ["sim_presse"] })).json();
    expect(un.sources).toHaveLength(1);
    const audit = await proprietaire(
      async (c2) =>
        (
          await c2.query(
            "SELECT count(*)::int AS n FROM journal_audit WHERE cabinet_id = $1 AND entite = 'ao_veille' AND action = 'collecte'",
            [a.cabinetId],
          )
        ).rows[0].n,
    );
    expect(audit).toBe(3);
  });

  it("désactiver une source la retire de la collecte", async () => {
    attendre(200, await chef.put(`${V}/sources/sim_presse`, { active: false }), "désactivation");
    const r = (await chef.post(`${V}/collecte`, {})).json();
    expect(r.sources.map((s: any) => s.code)).not.toContain("sim_presse");
    expect((await chef.post(`${V}/collecte`, { sources: ["sim_presse"] })).statusCode).toBe(409);
  });

  it("rapprochement expliqué du moteur sur un avis collecté", async () => {
    const liste = (await chef.get(`${V}/resultats?q=SIM-MP-001`)).json();
    const r = liste.elements[0];
    expect(r.score_rapprochement).toBeGreaterThan(0);
    expect(r.rapprochement.raisons.join(" ")).toContain("Secteur « Santé » déjà couvert");
    expect(r.rapprochement.composantes).toBeDefined();
  });
});

describe("saisie, import et dédoublonnage", () => {
  it("saisie d'un avis, puis la même saisie est un doublon (occurrence ajoutée)", async () => {
    const corps = avis();
    const r = await chef.post(`${V}/avis`, corps);
    attendre(201, r, "saisie");
    expect(r.json().nouveau).toBe(true);
    const bis = await chef.post(`${V}/avis`, {
      ...corps,
      reference: corps.reference.toLowerCase(),
    });
    expect(bis.json()).toMatchObject({ id: r.json().id, nouveau: false });
    expect((await chef.post(`${V}/avis`, { ...corps, extra: 1 })).statusCode).toBe(400);
    expect(
      (await chef.post(`${V}/avis`, { ...corps, url: "javascript:alert(1)" })).statusCode,
    ).toBe(400);
  });

  it("import CSV : erreurs par ligne, doublons contre une source, un import et une fiche", async () => {
    const existante = ref();
    attendre(
      201,
      await chef.post("/api/appels-offres", {
        reference: existante,
        titre: "Fiche déjà présente",
        date_limite: jourIso(20),
      }),
      "fiche",
    );
    const nouvelle = ref();
    const csv = [
      "﻿Référence;Intitulé;Bailleur;Pays;Secteur;Date limite;Mots-clés",
      `${nouvelle};Appui au contrôle interne d'un hôpital;AFD;sn;Santé;${jourIso(15)};audit|risques`,
      `${existante};Autre titre;;CI;;;`,
      "SIM-MP-001;Audit des comptes d'un établissement public hospitalier;;CI;;;",
      ";Sans référence mais valide;;;;;",
      ";;;;;;",
      "X;;;;;;",
      "Y;Date fausse;;;;31/02/2099;",
    ].join("\r\n");
    const r = await chef.post(`${V}/import`, { texte: csv });
    attendre(201, r, "import");
    const bilan = r.json();
    expect(bilan.format).toBe("csv");
    expect(bilan).toMatchObject({ lus: 4, nouveaux: 2, doublons: 2, plafond: 0 });
    expect(bilan.erreurs.map((e: any) => e.ligne)).toEqual([7, 8]);

    const liste = (await chef.get(`${V}/resultats?q=${existante}`)).json();
    expect(liste.elements).toHaveLength(1);
    expect(liste.elements[0]).toMatchObject({ statut: "fiche_creee" });
    expect(liste.elements[0].fiche_id).toBeTruthy();
    // Rejeu : plus rien de nouveau.
    expect((await chef.post(`${V}/import`, { texte: csv })).json()).toMatchObject({ nouveaux: 0 });
    const mp1 = (await chef.get(`${V}/resultats?q=SIM-MP-001`)).json().elements[0];
    expect(
      (await chef.get(`${V}/resultats/${mp1.id}`)).json().occurrences.length,
    ).toBeGreaterThanOrEqual(3);
  });

  it("import JSON, plafonds de taille et de nombre", async () => {
    const json = JSON.stringify({ avis: [avis(), avis({ titre: "Autre avis JSON" })] });
    const r = await chef.post(`${V}/import`, { texte: json });
    expect(r.json()).toMatchObject({ format: "json", nouveaux: 2 });
    const trop = JSON.stringify(Array.from({ length: 201 }, (_, i) => ({ titre: `Avis ${i}` })));
    const refus = await chef.post(`${V}/import`, { texte: trop });
    expect(refus.statusCode).toBe(400);
    const gros = await chef.post(`${V}/import`, { texte: "t".repeat(VEILLE_IMPORT_TEXTE_MAX + 1) });
    expect(gros.statusCode).toBe(400);
    const limite = JSON.stringify(
      Array.from({ length: 200 }, (_, i) => ({ titre: `Lot limite ${compteur} numéro ${i}` })),
    );
    expect((await chef.post(`${V}/import`, { texte: limite })).json().nouveaux).toBe(200);
    expect((await chef.post(`${V}/import`, { texte: "{}", format: "xml" })).statusCode).toBe(400);
    const vide = await chef.post(`${V}/import`, { texte: "[1" });
    expect(vide.json().erreurs[0].message).toBe("JSON invalide.");
  });
});

describe("rapprochement : matrice de compétences et banque de références", () => {
  it("compétences validées et références de la banque expliquées", async () => {
    const avant = (
      await chef.post(
        `${V}/avis`,
        avis({
          titre: "Audit financier de budgets publics",
          secteur: "Finances publiques",
          bailleur: "Banque mondiale",
          pays: "CI",
        }),
      )
    ).json();
    const rAvant = (await chef.get(`${V}/resultats/${avant.id}`)).json();
    expect(rAvant.rapprochement.competencesMatriceTrouvees).toEqual([]);

    // Une compétence du référentiel avec un niveau VALIDÉ (préparée en propriétaire).
    await proprietaire(async (c) => {
      const collaborateurId = (
        await c.query("SELECT id FROM collaborateurs WHERE cabinet_id = $1 LIMIT 1", [a.cabinetId])
      ).rows[0].id as string;
      const comp = await c.query(
        `INSERT INTO competences (cabinet_id, code, libelle, cree_par)
         VALUES ($1, 'audit_financier', 'Audit financier', $2) RETURNING id`,
        [a.cabinetId, a.associeId],
      );
      const decl = await c.query(
        `INSERT INTO competence_declarations (cabinet_id, collaborateur_id, competence_id, niveau,
           declare_par) VALUES ($1, $2, $3, 3, $4) RETURNING id`,
        [a.cabinetId, collaborateurId, comp.rows[0].id, a.associeId],
      );
      await c.query(
        `INSERT INTO competence_decisions (cabinet_id, declaration_id, decision, decide_par)
         VALUES ($1, $2, 'validee', $3)`,
        [a.cabinetId, decl.rows[0].id, a.associeId],
      );
      // Une compétence sans niveau validé ne compte pas.
      await c.query(
        `INSERT INTO competences (cabinet_id, code, libelle, cree_par)
         VALUES ($1, 'zumba', 'Zumbalogie', $2)`,
        [a.cabinetId, a.associeId],
      );
    });
    attendre(
      201,
      await a.associe.post("/api/banque-ao/references", {
        titre: "Appui à la réforme des finances publiques",
        client_nom: "Ministère des Finances",
        pays: "CI",
        secteurs: ["Finances publiques"],
        bailleur: "Banque mondiale",
        montant: 150_000_000,
        devise: "XOF",
        date_debut: "2022-01-15",
        date_fin: "2023-06-30",
        role_cabinet: "chef_de_file",
      }),
      "référence",
    );
    const nouveau = (
      await chef.post(
        `${V}/avis`,
        avis({
          titre: "Audit financier zumbalogie des comptes",
          secteur: "Finances publiques",
          bailleur: "Banque mondiale",
          pays: "CI",
        }),
      )
    ).json();
    const r = (await chef.get(`${V}/resultats/${nouveau.id}`)).json();
    const raisons = r.rapprochement.raisons.join(" | ");
    expect(r.rapprochement.competencesMatriceTrouvees).toEqual(["Audit financier"]);
    expect(raisons).toContain("validées dans la matrice de compétences : Audit financier");
    expect(raisons).not.toContain("Zumbalogie");
    expect(raisons).toContain(
      "Références de la banque : 1 dans le même secteur, 1 dans le même pays, 1 avec le même bailleur",
    );
    expect(r.score_rapprochement).toBeGreaterThan(rAvant.score_rapprochement);
  });
});

describe("décisions et création de fiche", () => {
  it("retenir, écarter (motif), réexaminer : historique en ajout seul", async () => {
    const { id } = (await chef.post(`${V}/avis`, avis())).json();
    expect((await chef.post(`${V}/resultats/${id}/ecarter`, {})).statusCode).toBe(400);
    expect((await chef.post(`${V}/resultats/${id}/ecarter`, { motif: "court" })).statusCode).toBe(
      400,
    );
    expect(
      (await chef.post(`${V}/resultats/${id}/reexaminer`, { motif: "Pas écarté, donc refusé." }))
        .statusCode,
    ).toBe(409);
    const r1 = await chef.post(`${V}/resultats/${id}/retenir`, {});
    expect(r1.json().statut).toBe("retenu");
    expect((await chef.post(`${V}/resultats/${id}/retenir`, {})).json().erreur.code).toBe(
      "AO_VEILLE_DECISION_INCOHERENTE",
    );
    const r2 = await chef.post(`${V}/resultats/${id}/ecarter`, {
      motif: "Hors de notre périmètre actuel.",
    });
    expect(r2.json().statut).toBe("ecarte");
    expect((await chef.post(`${V}/resultats/${id}/fiche`, {})).statusCode).toBe(409);
    const r3 = await chef.post(`${V}/resultats/${id}/reexaminer`, {
      motif: "Le contexte a changé, on revoit.",
    });
    expect(r3.json().statut).toBe("nouveau");
    const d = (await chef.get(`${V}/resultats/${id}`)).json().decisions;
    expect(d.map((x: any) => x.decision)).toEqual(["retenir", "ecarter", "reexaminer"]);
    expect(d[1].motif).toBe("Hors de notre périmètre actuel.");
    expect(
      await codeBase(
        "UPDATE ao_veille_decisions SET motif = 'modifié et assez long' WHERE resultat_id = $1",
        [id],
      ),
    ).toBe("MQA01");
    expect(await codeBase("DELETE FROM ao_veille_decisions WHERE resultat_id = $1", [id])).toBe(
      "MQA01",
    );
    expect(await codeBase("DELETE FROM ao_veille_occurrences WHERE resultat_id = $1", [id])).toBe(
      "MQA01",
    );
    expect(
      await codeBase("UPDATE ao_veille_resultats SET statut = 'fiche_creee' WHERE id = $1", [id]),
    ).not.toBeNull();
  });

  it("création de la fiche : source import, libellé de la source, lien gardé, une seule fois", async () => {
    const liste = (await chef.get(`${V}/resultats?q=SIM-MP-002`)).json();
    const id = liste.elements[0].id as string;
    const r = await chef.post(`${V}/resultats/${id}/fiche`, {});
    attendre(201, r, "fiche");
    const { resultat, fiche } = r.json();
    expect(resultat.statut).toBe("fiche_creee");
    expect(resultat.fiche_id).toBe(fiche.id);
    expect(fiche).toMatchObject({
      source: "import",
      source_libelle: "Portail des marchés publics (simulé)",
      statut: "detecte",
      reference: "SIM-MP-002",
      pays: "SN",
    });
    expect(fiche.montant_estime).toBe(85_000_000);
    expect(resultat.decisions.at(-1)).toMatchObject({
      decision: "creer_fiche",
      fiche_id: fiche.id,
    });
    expect((await chef.get(`/api/appels-offres/${fiche.id}`)).statusCode).toBe(200);
    expect((await chef.post(`${V}/resultats/${id}/fiche`, {})).statusCode).toBe(409);
    expect(
      (await chef.post(`${V}/resultats/${id}/ecarter`, { motif: "Trop tard pour écarter." }))
        .statusCode,
    ).toBe(409);
    expect(
      await codeBase("UPDATE ao_veille_resultats SET fiche_id = NULL WHERE id = $1", [id]),
    ).not.toBeNull();
  });

  it("conflit de référence avec une fiche créée entre-temps : 409 clair", async () => {
    const corps = avis();
    const { id } = (await chef.post(`${V}/avis`, corps)).json();
    attendre(
      201,
      await chef.post("/api/appels-offres", {
        reference: corps.reference,
        titre: "Créée à la main",
      }),
      "fiche manuelle",
    );
    const r = await chef.post(`${V}/resultats/${id}/fiche`, {});
    expect(r.statusCode).toBe(409);
    expect(r.json().erreur.code).toBe("AO_REFERENCE_EXISTANTE");
    expect(r.json().erreur.message).toContain(corps.reference);
    expect((await chef.get(`${V}/resultats/${id}`)).json().statut).toBe("nouveau");
  });
});

describe("isolation et plafonds", () => {
  it("un autre cabinet ne voit ni les résultats, ni les sources activées", async () => {
    const mien = (await chef.get(`${V}/resultats?limite=1`)).json().elements[0];
    const autre = (await b.associe.get(`${V}/resultats`)).json();
    expect(autre.total).toBe(0);
    expect((await b.associe.get(`${V}/resultats/${mien.id}`)).statusCode).toBe(404);
    expect((await b.associe.post(`${V}/resultats/${mien.id}/retenir`, {})).statusCode).toBe(404);
    expect((await b.associe.post(`${V}/resultats/${mien.id}/fiche`, {})).statusCode).toBe(404);
    const sources = (await b.associe.get(`${V}/sources`)).json().elements;
    expect(sources.every((s: any) => !s.active)).toBe(true);
    expect((await b.associe.post(`${V}/collecte`, {})).statusCode).toBe(409);
  });

  it("plafond de résultats par cabinet : collecte, saisie et base", async () => {
    const c = await cabinetTest(ctx, "Veille plafond");
    await proprietaire(async (cl) => {
      await cl.query(
        `INSERT INTO ao_veille_resultats (cabinet_id, cle, titre, score_rapprochement, rapprochement)
         SELECT $1, 'plafond:' || g, 'Avis ' || g, 0, '{}'::jsonb FROM generate_series(1, $2) g`,
        [c.cabinetId, VEILLE_RESULTATS_MAX],
      );
    });
    expect(
      await codeBase(
        `INSERT INTO ao_veille_resultats (cabinet_id, cle, titre, score_rapprochement, rapprochement)
         VALUES ($1, 'plafond:de-trop', 'Trop', 0, '{}'::jsonb)`,
        [c.cabinetId],
      ),
    ).toBe("MQA03");
    attendre(200, await c.associe.put(`${V}/sources/sim_presse`, { active: true }), "activation");
    const col = (await c.associe.post(`${V}/collecte`, {})).json();
    expect(col).toMatchObject({ nouveaux: 0, plafond: 2 });
    const s = await c.associe.post(`${V}/avis`, avis());
    expect(s.statusCode).toBe(409);
    expect(s.json().erreur.code).toBe("AO_VEILLE_PLAFOND");
    expect((await c.associe.get(V)).json().total).toBe(VEILLE_RESULTATS_MAX);
  }, 120_000);
});
