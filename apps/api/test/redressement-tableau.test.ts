import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  calculerEtatVoyant,
  type EntreesVoyant,
  type NiveauAlerte,
  type VoyantUrgence,
} from "@missionpilot/engines";
import {
  RED_CODES_MOTIF_VOYANT,
  RED_TABLEAU_LIMITE_MAX,
  RED_VOYANTS_PILOTAGE,
} from "@missionpilot/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Auth } from "../src/auth/contexte.js";
import { lireDossier } from "../src/redressement/acces.js";
import { etatVoyantDossier } from "../src/redressement/voyant.js";
import { LISTE_BLANCHE_PORTAIL } from "../src/portail/garde.js";
import { api } from "./api.js";
import { demarrer, type Contexte } from "./helpers.js";
import { attendre, inviterClient, type UtilisateurPortail } from "./portail-outils.js";
import {
  COVENANTS_CAS_A,
  nouveauDossier as nouveauDossierFin,
  semerTresorerie,
  urlD,
} from "./redressement-financement-outils.js";
import {
  erreur,
  INCONNU,
  ouvrirDossierRed,
  preparerCasA,
  preparerRed,
  toutesLesCles,
  type ScenarioRed,
} from "./redressement-outils.js";
import {
  dossierNeuf,
  semerActionEnRetard,
  semerUrgenceRouge,
  URL_PORTEFEUILLE,
  urlTableau,
} from "./redressement-tableau-outils.js";

/*
 * Tableau de bord du redressement (RED-15, version INTERNE) : voyant et motifs comparés au moteur,
 * dossier vide, cartographie de causes non validée, portefeuille (visibilité, pagination,
 * filtres), droits, portail fermé, isolation entre cabinets, absence de donnée du cabinet (FIN-02).
 */

let ctx: Contexte;
let s: ScenarioRed;
let riche: string; // dossier du cas A : urgence rouge, tension, covenants en défaut, actions en retard
let vide: string; // dossier ouvert sans aucune donnée
let industrie: string; // dossier du secteur « industrie », mission où le consultant hors équipe est membre
let dossierB: string;
let portail: UtilisateurPortail;

beforeAll(async () => {
  ctx = await demarrer();
  s = await preparerRed(ctx, "RED tableau");
  riche = (await preparerCasA(s)).dossierId;
  attendre(
    201,
    await s.a.chef.post(`/api/missions/${s.missionId}/equipe`, {
      utilisateur_id: s.expert.utilisateurId,
    }),
    "équipe (expert métier)",
  );

  await semerUrgenceRouge(s.a.chef, riche);
  attendre(201, await s.a.chef.post(urlD(riche, "/scores"), {}), "score");
  await semerTresorerie(s.a.chef, riche);
  attendre(
    201,
    await s.a.associe.post(urlD(riche, "/covenants/versions"), { covenants: COVENANTS_CAS_A }),
    "covenants",
  );
  await semerActionEnRetard(s.a.chef, riche, s.a.chef.utilisateurId, "Relancer les clients");
  await semerActionEnRetard(s.a.chef, riche, s.a.chef.utilisateurId, "Renégocier les délais");

  vide = await nouveauDossierFin(s, "Dossier vide");

  const ind = await dossierNeuf(s, "Mission industrie", "industrie");
  industrie = ind.dossierId;
  attendre(
    201,
    await s.a.chef.post(`/api/missions/${ind.missionId}/equipe`, {
      utilisateur_id: s.consultantHors.utilisateurId,
    }),
    "équipe (consultant hors équipe de la première mission)",
  );

  dossierB = (await ouvrirDossierRed(s, s.missionB, {}, s.b.chef)).id;
  portail = await inviterClient(ctx, s.a.associe, s.a.clientId, ["client_dirigeant"]);
}, 240_000);

afterAll(async () => {
  await ctx.fermer();
});

const get = async (par: { get: (u: string) => Promise<{ json: () => never }> }, url: string) =>
  (await par.get(url)).json() as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Entrées du moteur reconstituées par des lectures INDÉPENDANTES (routes existantes). */
async function entreesAttendues(id: string): Promise<EntreesVoyant> {
  const d = await get(s.a.associe, `/api/redressement/dossiers/${id}`);
  const cov = await get(s.a.associe, urlD(id, "/covenants"));
  return {
    voyantUrgence: (d.urgence?.voyant as VoyantUrgence | undefined) ?? null,
    niveauAlerte: (d.alerte?.niveau as NiveauAlerte | undefined) ?? null,
    semainesTension: d.tresorerie ? d.tresorerie.semaines_tension.length : null,
    covenantsEnDefaut: cov.synthese ? cov.synthese.en_defaut : null,
    actionsEnRetard: d.plan.en_retard,
    alertesSuivi: null,
    statutCloture: null,
  };
}

describe("vue consolidée d'un dossier riche", () => {
  it("voyant et motifs égaux à ceux du moteur ; entrées issues des autres routes", async () => {
    const r = await s.a.chef.get(urlTableau(riche));
    expect(r.statusCode).toBe(200);
    expect(r.headers["cache-control"]).toBe("private");
    const t = r.json();
    const entrees = await entreesAttendues(riche);
    // Le dossier est bien « riche » : chaque source contribue.
    expect(entrees).toMatchObject({
      voyantUrgence: "rouge",
      covenantsEnDefaut: 2,
      actionsEnRetard: 2,
    });
    expect(entrees.semainesTension).toBeGreaterThan(0);
    expect(entrees.niveauAlerte).not.toBeNull();
    const moteur = calculerEtatVoyant(entrees);
    expect(t.voyant).toEqual({ voyant: moteur.voyant, motifs: moteur.motifs, indicatif: true });
    expect(t.voyant.voyant).toBe("rouge");
    const codes = t.voyant.motifs.map((m: { code: string }) => m.code);
    expect(codes).toEqual(expect.arrayContaining(["URGENCE_ROUGE", "COVENANTS_DEFAUT_MULTIPLES"]));
    for (const m of t.voyant.motifs) expect(RED_CODES_MOTIF_VOYANT).toContain(m.code);
    // Un seul voyant par état : les critiques d'abord.
    const rang = { critique: 0, vigilance: 1, information: 2 } as const;
    const gravites = t.voyant.motifs.map((m: { gravite: keyof typeof rang }) => rang[m.gravite]);
    expect(gravites).toEqual([...gravites].sort((a, b) => a - b));
  });

  it("identité, mention indicative, indicateurs avec source et date", async () => {
    const t = await get(s.a.chef, urlTableau(riche));
    expect(t.dossier).toMatchObject({
      id: riche,
      mission: { id: s.missionId },
      client: { id: s.a.clientId },
      statut: "diagnostic",
      devise: "XOF",
      clos_le: null,
    });
    expect(t.mention).toMatch(/ne qualifie pas la situation juridique/);
    expect(t.date_calcul).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const par = Object.fromEntries(t.indicateurs.map((i: { cle: string }) => [i.cle, i]));
    expect(par.voyant_urgence).toMatchObject({ valeur: "rouge", source: "Diagnostic d'urgence" });
    expect(par.voyant_urgence.date).toBeTruthy();
    expect(par.covenants_en_defaut.valeur).toBe(2);
    expect(par.actions_en_retard.valeur).toBe(2);
    expect(par.semaines_tension.source).toMatch(/Trésorerie à 13 semaines/);
    expect(par.semaines_tension.date).toBe("2026-10-12");
    expect(par.alertes_suivi).toBeUndefined(); // dossier non clos
    for (const i of t.indicateurs) expect(i.source.length).toBeGreaterThan(3);
  });

  it("blocs : trésorerie, covenants, plan ; les absents valent null", async () => {
    const t = await get(s.a.chef, urlTableau(riche));
    expect(t.tresorerie.semaines_tension.length).toBe(
      t.indicateurs.find((i: { cle: string }) => i.cle === "semaines_tension").valeur,
    );
    expect(t.tresorerie.mensuel.mois_tension.length).toBeGreaterThan(0);
    expect(t.covenants).toMatchObject({
      nombre: 4,
      respectes: 2,
      en_defaut: 2,
      non_calculables: 0,
    });
    expect(t.covenants.covenants).toHaveLength(4);
    expect(t.plan.en_retard).toBe(2);
    expect(t.plan.actions_par_statut.a_faire).toBe(2);
    expect(t.financement).toBeNull();
    expect(t.causes).toBeNull();
    expect(t.creanciers).toBeNull();
    expect(t.cloture).toBeNull();
    expect(t.suivi).toBeNull();
  });

  it("plan de financement renseigné : résumé du moteur", async () => {
    const d = await nouveauDossierFin(s, "Financement");
    attendre(
      201,
      await s.a.associe.post(urlD(d, "/financement/versions"), {
        date_debut: "2026-07-01",
        type_periode: "annee",
        nombre_periodes: 2,
        lignes: [
          { periode: 1, sens: "emploi", nature: "investissements", montant: 100_000_000 },
          { periode: 1, sens: "ressource", nature: "apport_associes", montant: 40_000_000 },
        ],
      }),
      "plan de financement",
    );
    const t = await get(s.a.chef, urlTableau(d));
    const f = await get(s.a.chef, urlD(d, "/financement"));
    expect(t.financement).toMatchObject({
      version: 1,
      nombre_periodes: 2,
      equilibre: f.plan.equilibre,
      totaux: f.plan.totaux,
      couverture_totale_pb: f.plan.couverture_totale_pb,
      premiere_periode_insuffisance: f.plan.premiere_periode_insuffisance,
    });
    expect(t.financement.equilibre).toBe(false);
  });

  it("voyant du moteur appelable sans HTTP (etatVoyantDossier)", async () => {
    const etat = await ctx.db.withTenant(s.a.cabinetId, async (db) => {
      const dossier = await lireDossier(db, riche);
      return etatVoyantDossier(db, {} as Auth, dossier as never);
    });
    const t = await get(s.a.chef, urlTableau(riche));
    expect(etat.voyant).toBe(t.voyant.voyant);
    expect(etat.motifs.map((m) => m.code)).toEqual(
      t.voyant.motifs.map((m: { code: string }) => m.code),
    );
    expect(etat.donneesDisponibles).toBe(true);
  });

  it("parité des énumérations partagées avec le moteur", () => {
    const moteur = [
      calculerEtatVoyant({
        voyantUrgence: "rouge",
        niveauAlerte: "critique",
        semainesTension: 6,
        covenantsEnDefaut: 2,
        actionsEnRetard: 6,
        alertesSuivi: { nombre: 2, attention: 1 },
        statutCloture: "absent",
      }),
      calculerEtatVoyant({
        voyantUrgence: "orange",
        niveauAlerte: "modere",
        semainesTension: 1,
        covenantsEnDefaut: 1,
        actionsEnRetard: 1,
        alertesSuivi: { nombre: 1, attention: 0 },
        statutCloture: "brouillon",
      }),
    ].flatMap((e) => e.motifs.map((m) => m.code));
    for (const c of moteur) expect(RED_CODES_MOTIF_VOYANT).toContain(c);
    expect(new Set(moteur).size).toBeGreaterThanOrEqual(10);
    expect([...RED_VOYANTS_PILOTAGE].sort()).toEqual(["inconnu", "orange", "rouge", "vert"]);
  });
});

describe("dossier vide, clos, causes", () => {
  it("dossier vide : voyant inconnu, aucun motif, tous les blocs null", async () => {
    const t = await get(s.a.chef, urlTableau(vide));
    expect(t.voyant).toEqual({ voyant: "inconnu", motifs: [], indicatif: true });
    for (const bloc of [
      "tresorerie",
      "covenants",
      "financement",
      "plan",
      "creanciers",
      "causes",
      "cloture",
      "suivi",
    ])
      expect(t[bloc], bloc).toBeNull();
    expect(
      t.indicateurs.every((i: { valeur: unknown }) => i.valeur === null || i.valeur === 0),
    ).toBe(true);
    expect(t.dossier.statut).toBe("ouvert");
  });

  it("dossier clos sans bilan : bilan « absent » signalé, voyant toujours inconnu", async () => {
    const d = await nouveauDossierFin(s, "Dossier clos");
    attendre(
      200,
      await s.a.associe.post(`/api/redressement/dossiers/${d}/statut`, {
        statut: "clos",
        motif: "Mission terminée, dossier clos pour le test.",
      }),
      "clôture du dossier",
    );
    const t = await get(s.a.chef, urlTableau(d));
    expect(t.dossier.statut).toBe("clos");
    expect(t.dossier.clos_le).toBeTruthy();
    expect(t.cloture).toEqual({ statut: "absent", version: null, valide_le: null });
    expect(t.suivi).toBeNull(); // pas de plan de suivi
    expect(t.voyant.voyant).toBe("inconnu");
    expect(t.voyant.motifs.map((m: { code: string }) => m.code)).toEqual(["CLOTURE_ABSENTE"]);
  });
});

describe("causes validées", () => {
  let dossier: string;
  let versionId: string;

  beforeAll(async () => {
    dossier = await nouveauDossierFin(s, "Causes racines");
    await semerUrgenceRouge(s.a.chef, dossier);
    const g = await s.a.chef.post(`/api/redressement/dossiers/${dossier}/causes/generation`, {});
    attendre(201, g, "proposition de causes");
    versionId = g.json().id as string;
  });

  it("proposition non validée : statut non_validee, aucun nombre de causes", async () => {
    const t = await get(s.a.associe, urlTableau(dossier));
    expect(t.causes).toEqual({
      statut: "non_validee",
      version: 1,
      valide_le: null,
      nombre_causes: null,
      version_plus_recente_non_validee: false,
    });
  });

  it("après validation par un autre consultant : validée, nombre de causes de la liste", async () => {
    attendre(
      200,
      await s.a.associe.post(`/api/redressement/causes/${versionId}/validation`, {}),
      "validation des causes",
    );
    const liste = await get(s.a.associe, `/api/redressement/dossiers/${dossier}/causes`);
    const t = await get(s.a.associe, urlTableau(dossier));
    expect(t.causes).toMatchObject({
      statut: "validee",
      version: 1,
      nombre_causes: liste.elements[0].causes.length,
      version_plus_recente_non_validee: false,
    });
    expect(t.causes.valide_le).toBeTruthy();
  });

  it("nouvelle proposition non validée : la validée reste citée, la plus récente signalée", async () => {
    attendre(
      201,
      await s.a.chef.post(`/api/redressement/dossiers/${dossier}/causes/generation`, {}),
      "seconde proposition",
    );
    const t = await get(s.a.associe, urlTableau(dossier));
    expect(t.causes).toMatchObject({
      statut: "validee",
      version: 1,
      version_plus_recente_non_validee: true,
    });
  });
});

describe("portefeuille", () => {
  type Element = {
    dossier: { id: string; secteur: string; statut: string };
    voyant: string;
    motifs: unknown[];
  };
  const ids = (p: { elements: Element[] }) => p.elements.map((e) => e.dossier.id);

  it("l'associé voit toutes les missions de son cabinet, jamais celles d'un autre cabinet", async () => {
    const r = await s.a.associe.get(`${URL_PORTEFEUILLE}?limite=${RED_TABLEAU_LIMITE_MAX}`);
    expect(r.statusCode).toBe(200);
    expect(r.headers["cache-control"]).toBe("private");
    const p = r.json();
    const lus = ids(p);
    expect(lus).toEqual(expect.arrayContaining([riche, vide, industrie]));
    expect(lus).not.toContain(dossierB);
    expect(p.mention).toMatch(/ne qualifie pas/);
    const riches = p.elements.find((e: Element) => e.dossier.id === riche);
    expect(riches.voyant).toBe("rouge");
    expect(riches.motifs.length).toBeLessThanOrEqual(3);
    expect(riches.indicateurs).toMatchObject({
      dernier_voyant_urgence: "rouge",
      covenants_en_defaut: 2,
      actions_en_retard: 2,
    });
    expect(p.elements.find((e: Element) => e.dossier.id === vide).voyant).toBe("inconnu");
    // Synthèse de la page : un compte par voyant, somme = nombre d'éléments.
    expect(Object.keys(p.synthese_page).sort()).toEqual(["inconnu", "orange", "rouge", "vert"]);
    expect(
      Object.values(p.synthese_page as Record<string, number>).reduce((a, b) => a + b, 0),
    ).toBe(p.elements.length);
    // Cohérence avec la vue détaillée.
    const detail = await get(s.a.associe, urlTableau(riche));
    expect(riches.voyant).toBe(detail.voyant.voyant);
    expect(riches.motifs).toEqual(detail.voyant.motifs.slice(0, 3));
  });

  it("le consultant hors équipe ne voit que les missions dont il est membre", async () => {
    const p = (await s.consultantHors.get(URL_PORTEFEUILLE)).json();
    expect(ids(p)).toEqual([industrie]);
  });

  it("le consultant d'équipe voit sa mission, pas celle réservée au consultant voisin", async () => {
    const lus = ids((await s.consultantEquipe.get(URL_PORTEFEUILLE)).json());
    expect(lus).toContain(riche);
    expect(lus).not.toContain(industrie);
    expect(lus).not.toContain(dossierB);
  });

  it("pagination par curseur : pages disjointes, ordre stable, aucun oubli", async () => {
    const tout = ids(
      (await s.a.associe.get(`${URL_PORTEFEUILLE}?limite=${RED_TABLEAU_LIMITE_MAX}`)).json(),
    );
    const lus: string[] = [];
    let curseur: string | null = null;
    let pages = 0;
    do {
      const url: string = `${URL_PORTEFEUILLE}?limite=2${curseur ? `&curseur=${encodeURIComponent(curseur)}` : ""}`;
      const p = (await s.a.associe.get(url)).json();
      expect(p.elements.length).toBeLessThanOrEqual(2);
      lus.push(...ids(p));
      curseur = p.suivant;
      pages += 1;
    } while (curseur && pages < 20);
    expect(lus).toEqual(tout);
    expect(new Set(lus).size).toBe(lus.length);
    expect(pages).toBeGreaterThan(1);
  });

  it("filtres statut et secteur", async () => {
    const parSecteur = (await s.a.associe.get(`${URL_PORTEFEUILLE}?secteur=industrie`)).json();
    expect(ids(parSecteur)).toEqual([industrie]);
    const parStatut = (await s.a.associe.get(`${URL_PORTEFEUILLE}?statut=ouvert`)).json();
    expect(ids(parStatut)).toEqual(expect.arrayContaining([vide, industrie]));
    expect(ids(parStatut)).not.toContain(riche);
    for (const e of parStatut.elements) expect(e.dossier.statut).toBe("ouvert");
    const aucun = (await s.a.associe.get(`${URL_PORTEFEUILLE}?secteur=btp`)).json();
    expect(aucun.elements).toEqual([]);
    expect(aucun.suivant).toBeNull();
  });

  it("requêtes invalides : 400", async () => {
    for (const q of [
      "limite=0",
      `limite=${RED_TABLEAU_LIMITE_MAX + 1}`,
      "statut=ferme",
      "secteur=inconnu",
      "curseur=%25%25",
      "client_id=00000000-0000-4000-8000-000000000000",
    ]) {
      expect((await s.a.associe.get(`${URL_PORTEFEUILLE}?${q}`)).statusCode, q).toBe(400);
    }
  });
});

describe("droits, portail, isolation", () => {
  const adresses = () => [urlTableau(riche), URL_PORTEFEUILLE];

  it("sans session : 401", async () => {
    for (const u of adresses()) expect((await api(ctx).get(u)).statusCode, u).toBe(401);
  });

  it("associé, directeur, chef, consultant d'équipe, expert métier d'équipe : 200", async () => {
    for (const u of [s.a.associe, s.a.directeur, s.a.chef, s.consultantEquipe, s.expert]) {
      for (const url of adresses()) expect((await u.get(url)).statusCode, url).toBe(200);
    }
  });

  it("gestionnaire, ressources, expert externe : 403", async () => {
    for (const u of [s.gestionnaire, s.ressources, s.expertExterne]) {
      for (const url of adresses()) expect((await u.get(url)).statusCode, url).toBe(403);
    }
  });

  it("compte du portail : 403 PORTAIL_ROUTE_INTERDITE", async () => {
    for (const url of adresses()) {
      const r = await portail.get(url);
      expect(r.statusCode, url).toBe(403);
      expect(erreur(r as never), url).toBe("PORTAIL_ROUTE_INTERDITE");
    }
  });

  it("mission invisible, dossier inconnu ou d'un autre cabinet : 404 identique", async () => {
    const attendu = (await s.consultantHors.get(urlTableau(riche))).json();
    expect(attendu.erreur.code).toBe("INTROUVABLE");
    for (const r of [
      await s.consultantHors.get(urlTableau(riche)),
      await s.a.associe.get(urlTableau(INCONNU)),
      await s.a.associe.get(urlTableau(dossierB)),
      await s.b.associe.get(urlTableau(riche)),
    ]) {
      expect(r.statusCode).toBe(404);
      expect(r.json()).toEqual(attendu);
    }
    expect((await s.a.associe.get(urlTableau("pas-un-uuid"))).statusCode).toBe(400);
  });

  it("isolation : le cabinet B ne voit que son dossier, sans fuite d'identifiant du cabinet A", async () => {
    const p = (await s.b.associe.get(URL_PORTEFEUILLE)).json();
    expect(ids2(p)).toEqual([dossierB]);
    const texte = JSON.stringify(p);
    for (const id of [riche, vide, industrie, s.missionId, s.a.clientId])
      expect(texte).not.toContain(id);
  });

  it("FIN-02 : aucune donnée du cabinet (coût, taux, marge, honoraires, budget) dans les réponses", async () => {
    const interdites = [
      "cout",
      "couts",
      "taux",
      "marge_mission",
      "honoraires",
      "budget",
      "facturation",
      "tarif",
      "rentabilite",
    ];
    const cles = new Set([
      ...toutesLesCles(await get(s.a.chef, urlTableau(riche))),
      ...toutesLesCles((await s.a.associe.get(URL_PORTEFEUILLE)).json()),
    ]);
    for (const k of interdites) expect(cles.has(k), k).toBe(false);
  });

  it("lecture seule : rien n'est journalisé, aucune écriture", async () => {
    const { proprietaire } = await import("./helpers.js");
    const compter = async () =>
      proprietaire(async (c) =>
        Number((await c.query("SELECT count(*)::int AS n FROM journal_audit")).rows[0].n),
      );
    const avant = await compter();
    await s.a.associe.get(urlTableau(riche));
    await s.a.associe.get(URL_PORTEFEUILLE);
    expect(await compter()).toBe(avant);
  });

  it("autres méthodes : aucune écriture possible (404 ou 405)", async () => {
    for (const r of [
      await s.a.chef.post(urlTableau(riche), {}),
      await s.a.chef.post(URL_PORTEFEUILLE, {}),
    ]) {
      expect([404, 405]).toContain(r.statusCode);
    }
  });
});

describe("inventaire : aucune route du tableau de bord au portail", () => {
  it("les deux routes sont enregistrées et absentes de LISTE_BLANCHE_PORTAIL", () => {
    const routes = ctx.app.routesInventoriees.filter(
      (r) => r.motif.startsWith("/api/redressement/") && r.motif.includes("tableau-de-bord"),
    );
    expect(
      routes
        .filter((r) => r.methode === "GET")
        .map((r) => `${r.methode} ${r.motif}`)
        .sort(),
    ).toEqual([
      "GET /api/redressement/dossiers/:id/tableau-de-bord",
      "GET /api/redressement/tableau-de-bord",
    ]);
    for (const r of routes) {
      expect(
        LISTE_BLANCHE_PORTAIL.some((o) => o.motif === r.motif),
        r.motif,
      ).toBe(false);
    }
  });

  it("le service du tableau ne lit aucune table du cabinet ni ne calcule de montant", () => {
    const racine = join(import.meta.dirname, "..", "src");
    for (const f of [
      "redressement/tableau.ts",
      "redressement/voyant.ts",
      "routes/redressement-tableau.ts",
    ]) {
      const code = readFileSync(join(racine, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(/SUM\(|AVG\(|Math\.round|toFixed\(|fetch\(|process\.env/.test(code), f).toBe(false);
      expect(/cout_journalier|grille_taux|taux_horaire|honoraires|marge/i.test(code), f).toBe(
        false,
      );
    }
  });
});

const ids2 = (p: { elements: { dossier: { id: string } }[] }) =>
  p.elements.map((e) => e.dossier.id);
