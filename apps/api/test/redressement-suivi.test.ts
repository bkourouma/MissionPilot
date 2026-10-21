import {
  CLES_RATIO_SUIVI,
  EVENEMENTS_JALON_MAX,
  JALONS_SUIVI_MAX,
  LIBELLE_JALON_MAX,
  MOIS_JALON_MAX,
  MOIS_JALONS_PAR_DEFAUT,
  RATIO_SUIVI_PB_MAX,
  RELEVES_PAR_JALON_MAX,
} from "@missionpilot/engines";
import {
  RED_SUIVI_EVENEMENTS_PAR_JALON_MAX,
  RED_SUIVI_JALONS_MAX,
  RED_SUIVI_LIBELLE_MAX,
  RED_SUIVI_MOIS_MAX,
  RED_SUIVI_MOIS_PAR_DEFAUT,
  RED_SUIVI_RATIO_PB_MAX,
  RED_SUIVI_RATIOS,
  RED_SUIVI_RELEVES_PAR_JALON_MAX,
} from "@missionpilot/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Auth } from "../src/auth/contexte.js";
import { lireDossier } from "../src/redressement/acces.js";
import { alertesSuiviDossier } from "../src/redressement/suivi.js";
import { api } from "./api.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import { attendre, inviterClient, type UtilisateurPortail } from "./portail-outils.js";
import {
  erreur,
  INCONNU,
  preparerCasA,
  preparerRed,
  RATIOS_CAS_A,
  type ScenarioRed,
} from "./redressement-outils.js";
import {
  aujourdhui,
  cloturerMission,
  codeSql,
  codeSqlProprietaire,
  ecartJours,
  nouveauDossierSuivi,
  plusJours,
  plusMois,
  releveSaisi,
  urlS,
} from "./redressement-suivi-outils.js";

/*
 * Suivi post-mission (RED-09, lot 2) : droits, portail fermé, isolation, dossier clos requis
 * (409 RED_DOSSIER_NON_CLOS), dates exactes des jalons, relevés (saisis et instantané), alertes
 * calculées à la lecture (retard, dégradation), écriture possible mission clôturée, ajout seul et
 * déclencheurs (SQL), plafonds, entrées invalides, journal sans donnée sensible.
 */

let ctx: Contexte;
let s: ScenarioRed;
let cas: string; // dossier du cas A (états acceptés, correspondance), clos, suivi créé
let jalon1: string;
let jalon2: string;
let portail: UtilisateurPortail;

type Vue = {
  dossier_id: string;
  dossier_clos: boolean;
  date_reference: string;
  plan: {
    id: string;
    date_cloture: string;
    reference: {
      ratios: Record<string, number>;
      exercice: number | null;
      correspondance_version: number | null;
    };
  } | null;
  jalons: {
    id: string;
    rang: number;
    libelle: string;
    date_prevue: string;
    date_prevue_courante: string;
    statut: string;
    realise_le: string | null;
    nombre_reports: number;
    retard_jours: number;
    jours_restants: number;
    evenements: { id: string; type: string; date_effet: string; motif: string | null }[];
    releves: {
      id: string;
      source: string;
      ratios: Record<string, number>;
      correspondance_version: number | null;
      exercice: number | null;
      commentaire: string | null;
    }[];
    comparaisons: {
      ratio: string;
      reference_pb: number;
      releve_pb: number;
      variation_pb: number;
      sens: string;
      gravite: string | null;
    }[];
  }[];
  alertes: {
    type: string;
    gravite: string;
    jalon_rang: number;
    ratio: string | null;
    libelle: string;
  }[];
  synthese: { nombre: number; attention: number; information: number };
};

beforeAll(async () => {
  ctx = await demarrer();
  s = await preparerRed(ctx, "RED suivi");
  // L'expert métier est membre de l'équipe : il lit (200) sans écrire (403).
  attendre(
    201,
    await s.a.chef.post(`/api/missions/${s.missionId}/equipe`, {
      utilisateur_id: s.expert.utilisateurId,
    }),
    "équipe",
  );
  const casA = await preparerCasA(s);
  cas = casA.dossierId;
  attendre(
    200,
    await s.a.directeur.post(`/api/redressement/dossiers/${cas}/statut`, {
      statut: "clos",
      motif: "Objectifs atteints",
    }),
    "clôture",
  );
  const plan = await s.a.chef.post(urlS(cas), {});
  attendre(201, plan, "plan de suivi");
  const vue = plan.json() as Vue;
  jalon1 = vue.jalons[0]?.id as string;
  jalon2 = vue.jalons[1]?.id as string;
  portail = await inviterClient(ctx, s.a.associe, s.a.clientId, ["client_dirigeant"]);
}, 180_000);

afterAll(async () => {
  await ctx.fermer();
});

const lire = async (d: string, par = s.a.chef): Promise<Vue> => {
  const r = await par.get(urlS(d));
  expect(r.statusCode).toBe(200);
  return r.json() as Vue;
};

/* ------------------------------------------------------------------------------------------ */
/* Droits                                                                                      */
/* ------------------------------------------------------------------------------------------ */

describe("accès : 401, 403, 404, portail fermé", () => {
  const defs = (id: string, jalon: string) =>
    [
      ["GET", urlS(id), undefined, "lecture"],
      ["POST", urlS(id), {}, "ecriture"],
      ["POST", urlS(id, "/releves"), releveSaisi({ jalon_id: jalon }), "ecriture"],
      [
        "POST",
        urlS(id, `/jalons/${jalon}/evenements`),
        { type: "realise", date_effet: aujourdhui() },
        "ecriture",
      ],
    ] as const;
  type Appelant = {
    get: (u: string) => Promise<{ statusCode: number }>;
    post: (u: string, b: unknown) => Promise<{ statusCode: number }>;
  };
  const appeler = (par: Appelant, d: ReturnType<typeof defs>[number]) =>
    d[0] === "GET" ? par.get(d[1]) : par.post(d[1], d[2]);

  it("sans session : 401 ; gestionnaire, ressources, expert externe : 403 ; portail : 403 PORTAIL_ROUTE_INTERDITE", async () => {
    for (const d of defs(cas, jalon1)) {
      expect((await appeler(api(ctx), d)).statusCode, `401 ${d[1]}`).toBe(401);
      for (const u of [s.gestionnaire, s.ressources, s.expertExterne]) {
        expect((await appeler(u, d)).statusCode, `403 ${d[0]} ${d[1]}`).toBe(403);
      }
      const p = (await appeler(portail, d)) as { statusCode: number; json: () => never };
      expect(p.statusCode, `portail ${d[1]}`).toBe(403);
      expect(erreur(p), `portail ${d[1]}`).toBe("PORTAIL_ROUTE_INTERDITE");
    }
  });

  it("expert métier : lit (200), n'écrit pas (403)", async () => {
    for (const d of defs(cas, jalon1)) {
      const code = (await appeler(s.expert, d)).statusCode;
      expect(code, d[1]).toBe(d[3] === "lecture" ? 200 : 403);
    }
  });

  it("consultant hors équipe et autre cabinet : 404 ; dossier inconnu : 404", async () => {
    for (const d of defs(cas, jalon1)) {
      expect((await appeler(s.consultantHors, d)).statusCode, `hors équipe ${d[1]}`).toBe(404);
      expect((await appeler(s.b.associe, d)).statusCode, `autre cabinet ${d[1]}`).toBe(404);
    }
    for (const d of defs(INCONNU, INCONNU)) {
      expect((await appeler(s.a.associe, d)).statusCode, `inconnu ${d[1]}`).toBe(404);
    }
  });

  it("associé, directeur, chef de mission et consultant d'équipe créent un suivi (201)", async () => {
    for (const u of [s.a.associe, s.a.directeur, s.a.chef, s.consultantEquipe]) {
      const d = await nouveauDossierSuivi(s, "Droits", { equipe: [s.consultantEquipe] });
      attendre(201, await u.post(urlS(d.id), {}), "création du suivi");
    }
  });

  it("un jalon d'un autre dossier ou d'un autre cabinet : 404", async () => {
    const autre = await nouveauDossierSuivi(s, "Autre dossier");
    attendre(201, await s.a.chef.post(urlS(autre.id), {}), "plan");
    for (const [url, corps] of [
      [urlS(autre.id, "/releves"), releveSaisi({ jalon_id: jalon1 })],
      [
        urlS(autre.id, `/jalons/${jalon1}/evenements`),
        { type: "realise", date_effet: aujourdhui() },
      ],
    ] as const) {
      expect((await s.a.chef.post(url, corps)).statusCode, url).toBe(404);
    }
  });
});

/* ------------------------------------------------------------------------------------------ */
/* Création du plan de suivi                                                                   */
/* ------------------------------------------------------------------------------------------ */

describe("plan de suivi", () => {
  it("dossier non clos : lecture vide, création refusée (409 RED_DOSSIER_NON_CLOS)", async () => {
    const d = await nouveauDossierSuivi(s, "Ouvert", { ouvert: true });
    const v = await lire(d.id);
    expect(v).toMatchObject({ dossier_clos: false, plan: null, jalons: [], alertes: [] });
    expect(v.synthese).toEqual({ nombre: 0, attention: 0, information: 0 });
    for (const [url, corps] of [
      [urlS(d.id), {}],
      [urlS(d.id, "/releves"), releveSaisi({ jalon_id: INCONNU })],
      [urlS(d.id, `/jalons/${INCONNU}/evenements`), { type: "realise", date_effet: aujourdhui() }],
    ] as const) {
      const r = await s.a.chef.post(url, corps);
      expect(r.statusCode, url).toBe(409);
      expect(erreur(r), url).toBe("RED_DOSSIER_NON_CLOS");
    }
    // La base le refuse aussi, même hors de l'API (MPZ19).
    expect(
      await codeSql(ctx, s.a.cabinetId, (db) =>
        db.query(
          "INSERT INTO red_suivi_plans (cabinet_id, dossier_id, date_cloture, cree_par) VALUES ($1, $2, $3, $4)",
          [s.a.cabinetId, d.id, aujourdhui(), s.a.chef.utilisateurId],
        ),
      ),
    ).toBe("MPZ19");
  });

  it("jalons par défaut à 6 et 12 mois : dates exactes depuis la date de clôture", async () => {
    const d = await nouveauDossierSuivi(s, "Dates exactes");
    const r = await s.a.chef.post(urlS(d.id), {});
    attendre(201, r, "plan");
    const v = r.json() as Vue;
    const cloture = aujourdhui();
    expect(v.dossier_clos).toBe(true);
    expect(v.plan?.date_cloture).toBe(cloture);
    expect(v.jalons.map((j) => [j.rang, j.libelle, j.date_prevue, j.statut])).toEqual([
      [1, "Suivi à 6 mois", plusMois(cloture, 6), "a_venir"],
      [2, "Suivi à 12 mois", plusMois(cloture, 12), "a_venir"],
    ]);
    expect(v.jalons[0]?.jours_restants).toBe(ecartJours(cloture, plusMois(cloture, 6)));
    // Même lecture par GET ; un second suivi est refusé.
    expect(await lire(d.id)).toEqual(v);
    const deux = await s.a.chef.post(urlS(d.id), {});
    expect(deux.statusCode).toBe(409);
    expect(erreur(deux)).toBe("RED_SUIVI_EXISTE");
  });

  it("jalons personnalisés dans des bornes ; entrées invalides refusées", async () => {
    const d = await nouveauDossierSuivi(s, "Personnalisés");
    const r = await s.a.chef.post(urlS(d.id), {
      jalons: [{ mois: 3, libelle: "Point rapide" }, { mois: 18 }, { mois: 60 }],
    });
    attendre(201, r, "plan");
    const cloture = aujourdhui();
    expect((r.json() as Vue).jalons.map((j) => [j.libelle, j.date_prevue])).toEqual([
      ["Point rapide", plusMois(cloture, 3)],
      ["Suivi à 18 mois", plusMois(cloture, 18)],
      ["Suivi à 60 mois", plusMois(cloture, 60)],
    ]);
    const invalide = await nouveauDossierSuivi(s, "Invalides");
    for (const corps of [
      { jalons: [] },
      { jalons: [{ mois: 6 }, { mois: 6 }] },
      { jalons: [{ mois: 12 }, { mois: 6 }] },
      { jalons: [{ mois: 61 }] },
      { jalons: [{ mois: 0 }] },
      { jalons: [{ mois: 6, libelle: "x".repeat(121) }] },
      { jalons: [{ mois: 6, autre: 1 }] },
      { inconnu: true },
    ]) {
      expect(
        (await s.a.chef.post(urlS(invalide.id), corps)).statusCode,
        JSON.stringify(corps),
      ).toBe(400);
    }
    // Aucun suivi n'a été créé par ces refus.
    expect((await lire(invalide.id)).plan).toBeNull();
  });

  it("référence de clôture : ratios du dernier état accepté (cas A), vide sans correspondance", async () => {
    const v = await lire(cas);
    const attendus = Object.fromEntries(
      Object.entries(RATIOS_CAS_A).filter(([cle]) => cle !== "bfr_jours"),
    );
    expect(v.plan?.reference).toEqual({
      ratios: attendus,
      exercice: 2025,
      correspondance_version: 1,
    });
    const sans = await nouveauDossierSuivi(s, "Sans correspondance");
    const p = (await s.a.chef.post(urlS(sans.id), {})).json() as Vue;
    expect(p.plan?.reference).toEqual({ ratios: {}, exercice: 2025, correspondance_version: null });
  });
});

/* ------------------------------------------------------------------------------------------ */
/* Relevés et alertes                                                                          */
/* ------------------------------------------------------------------------------------------ */

describe("relevés de suivi", () => {
  it("indicateurs saisis : comparaison à la référence de clôture, alertes de dégradation triées", async () => {
    // Dossier du cas A : même client, ratios de référence identiques à RATIOS_CAS_A après correspondance.
    const r = await s.a.chef.post(urlS(cas, "/releves"), {
      jalon_id: jalon1,
      date_releve: aujourdhui(),
      source: "saisie",
      ratios: {
        liquidite_generale: RATIOS_CAS_A.liquidite_generale - 2_000,
        endettement: RATIOS_CAS_A.endettement + 600,
        marge_brute: RATIOS_CAS_A.marge_brute,
        autonomie_financiere: RATIOS_CAS_A.autonomie_financiere + 100,
      },
      commentaire: "Relevé de contrôle",
    });
    attendre(201, r, "relevé");
    const v = r.json() as Vue;
    const j = v.jalons[0];
    expect(j?.releves).toHaveLength(1);
    expect(j?.releves[0]).toMatchObject({
      source: "saisie",
      correspondance_version: null,
      exercice: null,
      commentaire: "Relevé de contrôle",
    });
    expect(j?.comparaisons.map((c) => [c.ratio, c.variation_pb, c.sens, c.gravite])).toEqual([
      ["liquidite_generale", -2_000, "degradation", "attention"],
      ["autonomie_financiere", 100, "amelioration", null],
      ["endettement", 600, "degradation", "information"],
      ["marge_brute", 0, "stable", null],
    ]);
    expect(v.alertes.map((a) => [a.type, a.gravite, a.jalon_rang, a.ratio])).toEqual([
      ["degradation_ratio", "attention", 1, "liquidite_generale"],
      ["degradation_ratio", "information", 1, "endettement"],
    ]);
    expect(v.alertes[0]?.libelle).toBe(
      "Liquidité générale : 1,16 au relevé du jalon « Suivi à 6 mois », contre 1,36 à la clôture (écart défavorable de 0,20).",
    );
    expect(v.synthese).toEqual({ nombre: 2, attention: 1, information: 1 });
    // L'exposé pour le tableau de bord donne les mêmes comptes que la lecture.
    const dossier = await ctx.db.withTenant(s.a.cabinetId, async (db) => lireDossier(db, cas));
    const alertes = await ctx.db.withTenant(s.a.cabinetId, async (db) =>
      alertesSuiviDossier(db, {} as Auth, dossier!),
    );
    expect(alertes).toEqual({ nombre: 2, attention: 1 });
  });

  it("instantané : ratios du dernier état accepté calculés par le serveur, avec leur version de correspondance", async () => {
    const r = await s.a.chef.post(urlS(cas, "/releves"), {
      jalon_id: jalon2,
      date_releve: aujourdhui(),
      source: "instantane",
    });
    attendre(201, r, "instantané");
    const j = (r.json() as Vue).jalons[1];
    const attendus = Object.fromEntries(
      Object.entries(RATIOS_CAS_A).filter(([cle]) => cle !== "bfr_jours"),
    );
    expect(j?.releves[0]).toMatchObject({
      source: "instantane",
      ratios: attendus,
      correspondance_version: 1,
      exercice: 2025,
    });
    // Identique à la référence : aucune dégradation, aucune alerte pour ce jalon.
    expect(j?.comparaisons.every((c) => c.sens === "stable" && c.gravite === null)).toBe(true);
  });

  it("instantané sans ratio calculable : 409 RED_BASE_INCOMPLETE ; ratios fournis avec un instantané : 400", async () => {
    const d = await nouveauDossierSuivi(s, "Instantané impossible");
    const v = (await s.a.chef.post(urlS(d.id), {})).json() as Vue;
    const j = v.jalons[0]?.id as string;
    const r = await s.a.chef.post(urlS(d.id, "/releves"), {
      jalon_id: j,
      date_releve: aujourdhui(),
      source: "instantane",
    });
    expect(r.statusCode).toBe(409);
    expect(erreur(r)).toBe("RED_BASE_INCOMPLETE");
    const m = await s.a.chef.post(urlS(d.id, "/releves"), {
      jalon_id: j,
      date_releve: aujourdhui(),
      source: "instantane",
      ratios: { endettement: 1 },
    });
    expect(m.statusCode).toBe(400);
  });

  it("entrées invalides : 400 ; relevé antérieur à la clôture : 409 RED_SUIVI_INCOHERENT", async () => {
    for (const corps of [
      releveSaisi({ jalon_id: jalon1, ratios: {} }),
      releveSaisi({ jalon_id: jalon1, ratios: { bfr_jours: 5 } }),
      releveSaisi({ jalon_id: jalon1, ratios: { endettement: 1.5 } }),
      releveSaisi({ jalon_id: jalon1, ratios: { endettement: RED_SUIVI_RATIO_PB_MAX + 1 } }),
      releveSaisi({ jalon_id: jalon1, source: "autre" }),
      releveSaisi({ jalon_id: "pas-un-uuid" }),
      releveSaisi({ jalon_id: jalon1, date_releve: "2026-02-30" }),
      releveSaisi({ jalon_id: jalon1, commentaire: "x".repeat(1001) }),
      releveSaisi({ jalon_id: jalon1, extra: 1 }),
    ]) {
      expect((await s.a.chef.post(urlS(cas, "/releves"), corps)).statusCode).toBe(400);
    }
    const r = await s.a.chef.post(
      urlS(cas, "/releves"),
      releveSaisi({ jalon_id: jalon1, date_releve: "2001-01-01" }),
    );
    expect(r.statusCode).toBe(409);
    expect(erreur(r)).toBe("RED_SUIVI_INCOHERENT");
  });
});

describe("événements de jalon", () => {
  it("reporté (motif obligatoire) puis réalisé ; un jalon réalisé ne bouge plus", async () => {
    const d = await nouveauDossierSuivi(s, "Événements");
    const v0 = (await s.a.chef.post(urlS(d.id), {})).json() as Vue;
    const j = v0.jalons[0] as Vue["jalons"][number];
    const url = urlS(d.id, `/jalons/${j.id}/evenements`);
    const nouvelle = plusJours(j.date_prevue, 20);
    // Sans motif : 400 ; date non postérieure : 409.
    expect((await s.a.chef.post(url, { type: "reporte", date_effet: nouvelle })).statusCode).toBe(
      400,
    );
    const pas = await s.a.chef.post(url, {
      type: "reporte",
      date_effet: j.date_prevue,
      motif: "Client indisponible",
    });
    expect(pas.statusCode).toBe(409);
    expect(erreur(pas)).toBe("RED_SUIVI_INCOHERENT");
    const rep = await s.a.chef.post(url, {
      type: "reporte",
      date_effet: nouvelle,
      motif: "Client indisponible",
    });
    attendre(201, rep, "report");
    const apres = (rep.json() as Vue).jalons[0] as Vue["jalons"][number];
    expect(apres).toMatchObject({
      date_prevue: j.date_prevue,
      date_prevue_courante: nouvelle,
      nombre_reports: 1,
      statut: "a_venir",
    });
    expect(apres.evenements[0]).toMatchObject({ type: "reporte", motif: "Client indisponible" });
    // Un second report doit dépasser le premier.
    expect(
      (
        await s.a.chef.post(url, {
          type: "reporte",
          date_effet: plusJours(nouvelle, -1),
          motif: "x",
        })
      ).statusCode,
    ).toBe(409);
    // Réalisé : sans relevé, une information « jalon sans relevé » est calculée.
    const rea = await s.a.chef.post(url, { type: "realise", date_effet: aujourdhui() });
    attendre(201, rea, "réalisé");
    const vr = rea.json() as Vue;
    expect(vr.jalons[0]).toMatchObject({ statut: "realise", realise_le: aujourdhui() });
    expect(vr.alertes.map((a) => [a.type, a.gravite, a.jalon_rang])).toEqual([
      ["jalon_sans_releve", "information", 1],
    ]);
    const encore = await s.a.chef.post(url, {
      type: "reporte",
      date_effet: plusJours(nouvelle, 5),
      motif: "Trop tard",
    });
    expect(encore.statusCode).toBe(409);
    expect(erreur(encore)).toBe("RED_SUIVI_INCOHERENT");
    // Un relevé enregistré ensuite lève l'information.
    attendre(
      201,
      await s.a.chef.post(urlS(d.id, "/releves"), releveSaisi({ jalon_id: j.id })),
      "relevé",
    );
    expect((await lire(d.id)).alertes).toEqual([]);
  });

  it("une réalisation ne précède pas la clôture (409) ; 8 événements au plus par jalon", async () => {
    const d = await nouveauDossierSuivi(s, "Plafond d'événements");
    const v = (await s.a.chef.post(urlS(d.id), {})).json() as Vue;
    const j = v.jalons[0] as Vue["jalons"][number];
    const url = urlS(d.id, `/jalons/${j.id}/evenements`);
    expect(
      (await s.a.chef.post(url, { type: "realise", date_effet: "2001-01-01" })).statusCode,
    ).toBe(409);
    let date = j.date_prevue;
    for (let i = 0; i < RED_SUIVI_EVENEMENTS_PAR_JALON_MAX; i += 1) {
      date = plusJours(date, 10);
      attendre(
        201,
        await s.associe2.post(url, { type: "reporte", date_effet: date, motif: "Report" }),
        `report ${i}`,
      );
    }
    const r = await s.associe2.post(url, {
      type: "reporte",
      date_effet: plusJours(date, 10),
      motif: "Un de trop",
    });
    expect(r.statusCode).toBe(409);
    expect(erreur(r)).toBe("RED_SUIVI_INCOHERENT");
    // La base refuse aussi le neuvième événement (MPZ10).
    expect(
      await codeSql(ctx, s.a.cabinetId, (db) =>
        db.query(
          `INSERT INTO red_suivi_evenements (cabinet_id, dossier_id, jalon_id, type, date_effet, motif, cree_par)
           VALUES ($1, $2, $3, 'reporte', $4, 'Un de trop', $5)`,
          [s.a.cabinetId, d.id, j.id, plusJours(date, 10), s.a.chef.utilisateurId],
        ),
      ),
    ).toBe("MPZ10");
  });
});

describe("retards et approche des jalons (dossier clos dans le passé)", () => {
  it("jalon échu : information puis attention à partir de 30 jours de retard, calculs exacts", async () => {
    for (const [jours, gravite] of [
      [40, "information"],
      [75, "attention"],
    ] as const) {
      const d = await nouveauDossierSuivi(s, `Retard ${jours}`, { joursDepuisCloture: jours });
      const r = await s.a.chef.post(urlS(d.id), { jalons: [{ mois: 1 }, { mois: 24 }] });
      attendre(201, r, "plan");
      const v = r.json() as Vue;
      const cloture = plusJours(aujourdhui(), -jours);
      const prevue = plusMois(cloture, 1);
      const retard = ecartJours(prevue, aujourdhui());
      expect(v.plan?.date_cloture).toBe(cloture);
      expect(v.jalons[0]).toMatchObject({
        date_prevue: prevue,
        statut: "echu",
        retard_jours: retard,
      });
      expect(v.jalons[1]?.statut).toBe("a_venir");
      expect(retard >= 30).toBe(gravite === "attention");
      expect(v.alertes).toHaveLength(1);
      expect(v.alertes[0]).toMatchObject({ type: "jalon_echu", gravite, jalon_rang: 1 });
      expect(v.alertes[0]?.libelle).toBe(
        `Le jalon « Suivi à 1 mois » est échu depuis ${retard} jours et n'est pas marqué réalisé.`,
      );
      // Reporter le jalon dans le futur supprime l'alerte de retard.
      const j = v.jalons[0]?.id as string;
      const rep = await s.a.chef.post(urlS(d.id, `/jalons/${j}/evenements`), {
        type: "reporte",
        date_effet: plusMois(aujourdhui(), 3),
        motif: "Nouvelle échéance convenue",
      });
      attendre(201, rep, "report");
      expect((rep.json() as Vue).alertes).toEqual([]);
    }
  });

  it("jalon proche : information dans les quinze jours", async () => {
    const d = await nouveauDossierSuivi(s, "Proche", { joursDepuisCloture: 20 });
    const v = (await s.a.chef.post(urlS(d.id), { jalons: [{ mois: 1 }] })).json() as Vue;
    const prevue = plusMois(plusJours(aujourdhui(), -20), 1);
    const restant = ecartJours(aujourdhui(), prevue);
    expect(restant).toBeGreaterThanOrEqual(8);
    expect(restant).toBeLessThanOrEqual(11);
    expect(v.alertes).toHaveLength(1);
    expect(v.alertes[0]).toMatchObject({ type: "jalon_proche", gravite: "information" });
    expect(v.alertes[0]?.libelle).toContain(`dans ${restant} jours`);
  });
});

describe("mission clôturée", () => {
  it("le suivi s'écrit et se lit même quand la mission est clôturée", async () => {
    const d = await nouveauDossierSuivi(s, "Mission clôturée", { signee: true });
    await cloturerMission(d.missionId);
    const plan = await s.a.associe.post(urlS(d.id), {});
    attendre(201, plan, "plan après clôture de la mission");
    const j = (plan.json() as Vue).jalons[0]?.id as string;
    attendre(
      201,
      await s.a.associe.post(urlS(d.id, "/releves"), releveSaisi({ jalon_id: j })),
      "relevé après clôture de la mission",
    );
    attendre(
      201,
      await s.a.associe.post(urlS(d.id, `/jalons/${j}/evenements`), {
        type: "realise",
        date_effet: aujourdhui(),
      }),
      "événement après clôture de la mission",
    );
    expect((await s.a.associe.get(urlS(d.id))).statusCode).toBe(200);
  });
});

/* ------------------------------------------------------------------------------------------ */
/* Débit, journal, parité                                                                      */
/* ------------------------------------------------------------------------------------------ */

describe("plafonds", () => {
  it("dix relevés au plus par jalon (409 RED_PLAFOND_ATTEINT)", async () => {
    const d = await nouveauDossierSuivi(s, "Plafond de relevés");
    const v = (await s.a.chef.post(urlS(d.id), {})).json() as Vue;
    const j = v.jalons[0]?.id as string;
    for (let i = 0; i < RED_SUIVI_RELEVES_PAR_JALON_MAX; i += 1) {
      attendre(
        201,
        await s.associe2.post(urlS(d.id, "/releves"), releveSaisi({ jalon_id: j })),
        `relevé ${i}`,
      );
    }
    const r = await s.associe2.post(urlS(d.id, "/releves"), releveSaisi({ jalon_id: j }));
    expect(r.statusCode).toBe(409);
    expect(erreur(r)).toBe("RED_PLAFOND_ATTEINT");
  });

  it("douze jalons au plus par suivi (400 au-delà)", async () => {
    const d = await nouveauDossierSuivi(s, "Douze jalons");
    const jalons = Array.from({ length: RED_SUIVI_JALONS_MAX }, (_, i) => ({ mois: i + 1 }));
    attendre(201, await s.a.chef.post(urlS(d.id), { jalons }), "douze jalons");
    const d2 = await nouveauDossierSuivi(s, "Treize jalons");
    expect(
      (
        await s.a.chef.post(urlS(d2.id), {
          jalons: [...jalons, { mois: RED_SUIVI_JALONS_MAX + 1 }],
        })
      ).statusCode,
    ).toBe(400);
  });

  it("plafond de débit : au plus 30 relevés par 10 minutes et par utilisateur (429)", async () => {
    const u = await s.a.avecRoles(["associe"]);
    const d = await nouveauDossierSuivi(s, "Débit");
    const v = (
      await u.post(urlS(d.id), { jalons: [{ mois: 1 }, { mois: 2 }, { mois: 3 }, { mois: 4 }] })
    ).json() as Vue;
    const ids = v.jalons.map((j) => j.id);
    for (let i = 0; i < 30; i += 1) {
      attendre(
        201,
        await u.post(
          urlS(d.id, "/releves"),
          releveSaisi({ jalon_id: ids[Math.floor(i / RED_SUIVI_RELEVES_PAR_JALON_MAX)] }),
        ),
        `relevé ${i}`,
      );
    }
    const r = await u.post(urlS(d.id, "/releves"), releveSaisi({ jalon_id: ids[3] }));
    expect(r.statusCode).toBe(429);
    expect(erreur(r)).toBe("RED_TROP_DE_RELEVES_SUIVI");
  });
});

describe("journal", () => {
  it("identifiants et comptes seulement (ni commentaire, ni motif, ni ratio)", async () => {
    const d = await nouveauDossierSuivi(s, "Journal");
    const plan = (await s.a.chef.post(urlS(d.id), {})).json() as Vue;
    const j = plan.jalons[0]?.id as string;
    attendre(
      201,
      await s.a.chef.post(
        urlS(d.id, "/releves"),
        releveSaisi({
          jalon_id: j,
          ratios: { endettement: 98_765 },
          commentaire: "Commentaire confidentiel",
        }),
      ),
      "relevé",
    );
    attendre(
      201,
      await s.a.chef.post(urlS(d.id, `/jalons/${j}/evenements`), {
        type: "reporte",
        date_effet: plusJours(plan.jalons[0]?.date_prevue as string, 9),
        motif: "Motif confidentiel",
      }),
      "report",
    );
    const v = await lire(d.id);
    const idReleve = v.jalons[0]?.releves[0]?.id as string;
    const idEvenement = v.jalons[0]?.evenements[0]?.id as string;
    const lignes = await Promise.all(
      [
        ["red_suivi_plan", "plan_creation", plan.plan?.id as string],
        ["red_suivi_releve", "releve", idReleve],
        ["red_suivi_evenement", "evenement", idEvenement],
      ].map(([entite, action, id]) =>
        proprietaire((c) =>
          c.query(
            "SELECT details, details::text AS texte FROM journal_audit WHERE entite = $1 AND action = $2 AND entite_id = $3",
            [entite, action, id],
          ),
        ),
      ),
    );
    expect(Object.keys(lignes[0]?.rows[0].details).sort()).toEqual([
      "dossier_id",
      "jalons",
      "reference_ratios",
    ]);
    expect(Object.keys(lignes[1]?.rows[0].details).sort()).toEqual([
      "dossier_id",
      "jalon_id",
      "ratios",
      "source",
    ]);
    expect(Object.keys(lignes[2]?.rows[0].details).sort()).toEqual([
      "dossier_id",
      "jalon_id",
      "type",
    ]);
    for (const l of lignes) expect(l.rows[0].texte).not.toMatch(/confidentiel|98765/);
  });
});

describe("parité avec le moteur", () => {
  it("listes et bornes partagées identiques à celles du moteur", () => {
    expect([...RED_SUIVI_RATIOS]).toEqual([...CLES_RATIO_SUIVI]);
    expect([...RED_SUIVI_MOIS_PAR_DEFAUT]).toEqual([...MOIS_JALONS_PAR_DEFAUT]);
    expect(RED_SUIVI_JALONS_MAX).toBe(JALONS_SUIVI_MAX);
    expect(RED_SUIVI_MOIS_MAX).toBe(MOIS_JALON_MAX);
    expect(RED_SUIVI_LIBELLE_MAX).toBe(LIBELLE_JALON_MAX);
    expect(RED_SUIVI_EVENEMENTS_PAR_JALON_MAX).toBe(EVENEMENTS_JALON_MAX);
    expect(RED_SUIVI_RELEVES_PAR_JALON_MAX).toBe(RELEVES_PAR_JALON_MAX);
    expect(RED_SUIVI_RATIO_PB_MAX).toBe(RATIO_SUIVI_PB_MAX);
  });
});

/* ------------------------------------------------------------------------------------------ */
/* Base de données : isolation, ajout seul, déclencheurs                                       */
/* ------------------------------------------------------------------------------------------ */

describe("base de données (migration 0491)", () => {
  const TABLES = [
    "red_suivi_plans",
    "red_suivi_jalons",
    "red_suivi_releves",
    "red_suivi_evenements",
  ] as const;
  let nu: string; // dossier clos sans suivi
  let clos: string; // dossier clos avec suivi, un jalon réalisé
  let jalonClos: string;
  let jalonLibre: string;
  let dateCloture: string;

  beforeAll(async () => {
    nu = (await nouveauDossierSuivi(s, "SQL sans suivi")).id;
    clos = (await nouveauDossierSuivi(s, "SQL avec suivi")).id;
    const v = (await s.a.chef.post(urlS(clos), {})).json() as Vue;
    jalonClos = v.jalons[0]?.id as string;
    jalonLibre = v.jalons[1]?.id as string;
    dateCloture = v.plan?.date_cloture as string;
    attendre(
      201,
      await s.a.chef.post(urlS(clos, "/releves"), releveSaisi({ jalon_id: jalonClos })),
      "relevé",
    );
    attendre(
      201,
      await s.a.chef.post(urlS(clos, `/jalons/${jalonClos}/evenements`), {
        type: "realise",
        date_effet: aujourdhui(),
      }),
      "réalisé",
    );
  });

  const sql = (texte: string, params: unknown[]) =>
    codeSql(ctx, s.a.cabinetId, (db) => db.query(texte, params));

  const insererEvenement = (type: string, date: string, motif: string | null, jalon = jalonClos) =>
    sql(
      `INSERT INTO red_suivi_evenements (cabinet_id, dossier_id, jalon_id, type, date_effet, motif, cree_par)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [s.a.cabinetId, clos, jalon, type, date, motif, s.a.chef.utilisateurId],
    );
  const insererReleve = (ratios: string, date = aujourdhui(), jalon = jalonClos) =>
    sql(
      `INSERT INTO red_suivi_releves (cabinet_id, dossier_id, jalon_id, date_releve, source, ratios, cree_par)
       VALUES ($1, $2, $3, $4, 'saisie', $5::jsonb, $6)`,
      [s.a.cabinetId, clos, jalon, date, ratios, s.a.chef.utilisateurId],
    );

  it("isolation : un autre cabinet ne voit rien et n'écrit rien dans ces tables", async () => {
    for (const t of TABLES) {
      const lues = await ctx.db.withTenant(
        s.b.cabinetId,
        async (db) => (await db.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n as number,
      );
      expect(lues, t).toBe(0);
      const propres = await ctx.db.withTenant(
        s.a.cabinetId,
        async (db) => (await db.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n as number,
      );
      expect(propres, t).toBeGreaterThan(0);
    }
    // Le dossier de A est invisible depuis B : refusé par la RLS (42501) ou par le déclencheur (MPZ19).
    expect(
      await codeSql(ctx, s.b.cabinetId, (db) =>
        db.query(
          "INSERT INTO red_suivi_plans (cabinet_id, dossier_id, date_cloture, cree_par) VALUES ($1, $2, $3, $4)",
          [s.a.cabinetId, nu, dateCloture, s.a.chef.utilisateurId],
        ),
      ),
    ).toMatch(/^(42501|MPZ19)$/);
  });

  it("ajout seul : UPDATE et DELETE refusés au rôle applicatif (42501) et au propriétaire (MPZ01)", async () => {
    for (const t of TABLES) {
      for (const texte of [`UPDATE ${t} SET cabinet_id = cabinet_id`, `DELETE FROM ${t}`]) {
        expect(await sql(texte, []), texte).toBe("42501");
        expect(await codeSqlProprietaire(texte), `propriétaire ${texte}`).toBe("MPZ01");
      }
    }
  });

  it("plan : date de clôture du dossier (MPZ20), ratios de référence valides (MPZ20), un seul par dossier", async () => {
    expect(
      await sql(
        "INSERT INTO red_suivi_plans (cabinet_id, dossier_id, date_cloture, cree_par) VALUES ($1, $2, '2000-01-01', $3)",
        [s.a.cabinetId, nu, s.a.chef.utilisateurId],
      ),
    ).toBe("MPZ20");
    for (const ratios of ['{"bfr_jours": 5}', '{"endettement": 1.5}', '{"endettement": "x"}']) {
      expect(
        await sql(
          "INSERT INTO red_suivi_plans (cabinet_id, dossier_id, date_cloture, reference_ratios, cree_par) VALUES ($1, $2, $3, $4::jsonb, $5)",
          [s.a.cabinetId, nu, aujourdhui(), ratios, s.a.chef.utilisateurId],
        ),
        ratios,
      ).toBe("MPZ20");
    }
    expect(
      await sql(
        "INSERT INTO red_suivi_plans (cabinet_id, dossier_id, date_cloture, cree_par) VALUES ($1, $2, $3, $4)",
        [s.a.cabinetId, clos, dateCloture, s.a.chef.utilisateurId],
      ),
    ).toBe("23505");
  });

  it("jalons : nés dans la transaction du plan (MPZ01), rangs et dates ordonnés (MPZ20)", async () => {
    const plan = await sql(
      `INSERT INTO red_suivi_jalons (cabinet_id, dossier_id, plan_id, rang, mois, libelle, date_prevue, cree_par)
       SELECT $1, $2, p.id, 3, 30, 'Hors plan', $3, $4 FROM red_suivi_plans p WHERE p.dossier_id = $2`,
      [s.a.cabinetId, clos, plusMois(aujourdhui(), 30), s.a.chef.utilisateurId],
    );
    expect(plan).toBe("MPZ01");
    const dans = (jalons: [number, number, string][]) =>
      codeSql(ctx, s.a.cabinetId, async (db) => {
        await db.query(
          "INSERT INTO red_suivi_plans (cabinet_id, dossier_id, date_cloture, cree_par) VALUES ($1, $2, $3, $4)",
          [s.a.cabinetId, nu, dateCloture, s.a.chef.utilisateurId],
        );
        for (const [rang, mois, date] of jalons) {
          await db.query(
            `INSERT INTO red_suivi_jalons (cabinet_id, dossier_id, plan_id, rang, mois, libelle, date_prevue, cree_par)
             SELECT $1, $2, p.id, $3, $4, 'Jalon', $5, $6 FROM red_suivi_plans p WHERE p.dossier_id = $2`,
            [s.a.cabinetId, nu, rang, mois, date, s.a.chef.utilisateurId],
          );
        }
      });
    expect(await dans([[2, 6, plusMois(dateCloture, 6)]]), "rang sauté").toBe("MPZ20");
    expect(await dans([[1, 1, plusJours(dateCloture, -1)]]), "avant la clôture").toBe("MPZ20");
    expect(
      await dans([
        [1, 6, plusMois(dateCloture, 6)],
        [2, 12, plusMois(dateCloture, 6)],
      ]),
      "date non croissante",
    ).toBe("MPZ20");
    expect(await dans([[1, 6, plusMois(dateCloture, 6)]]), "valide").toBe("aucun");
  });

  it("relevés : ratios valides et non vides, pas avant la clôture", async () => {
    expect(await insererReleve('{"inconnu": 1}')).toBe("MPZ20");
    expect(await insererReleve('{"endettement": 1.5}')).toBe("MPZ20");
    expect(await insererReleve('{"endettement": 100000001}')).toBe("MPZ20");
    expect(await insererReleve("{}")).toBe("23514");
    expect(await insererReleve('{"endettement": 1}', plusJours(dateCloture, -1))).toBe("MPZ20");
    expect(await insererReleve('{"endettement": -42}')).toBe("aucun");
  });

  it("événements : jalon réalisé figé, report postérieur, motif de report, réalisation après la clôture (MPZ20)", async () => {
    expect(await insererEvenement("reporte", plusMois(aujourdhui(), 40), "Trop tard")).toBe(
      "MPZ20",
    );
    expect(await insererEvenement("realise", aujourdhui(), null)).toBe("MPZ20");
    expect(await insererEvenement("reporte", plusMois(dateCloture, 1), null, jalonLibre)).toBe(
      "MPZ20",
    );
    expect(await insererEvenement("reporte", plusMois(dateCloture, 13), null, jalonLibre)).toBe(
      "23514",
    );
    expect(await insererEvenement("realise", plusJours(dateCloture, -1), null, jalonLibre)).toBe(
      "MPZ20",
    );
    expect(await insererEvenement("annule", aujourdhui(), null, jalonLibre)).toBe("23514");
  });

  it("dossier non clos : aucune écriture (MPZ19) ; propriétaire soumis aux mêmes déclencheurs", async () => {
    const ouvert = await nouveauDossierSuivi(s, "SQL ouvert", { ouvert: true });
    expect(
      await codeSqlProprietaire(
        "INSERT INTO red_suivi_releves (cabinet_id, dossier_id, jalon_id, date_releve, source, ratios, cree_par) VALUES ($1, $2, $3, $4, 'saisie', '{\"endettement\": 1}'::jsonb, $5)",
        [s.a.cabinetId, ouvert.id, jalonLibre, aujourdhui(), s.a.chef.utilisateurId],
      ),
    ).toBe("MPZ19");
    expect(
      await codeSqlProprietaire(
        "INSERT INTO red_suivi_plans (cabinet_id, dossier_id, date_cloture, cree_par) VALUES ($1, $2, $3, $4)",
        [s.a.cabinetId, ouvert.id, aujourdhui(), s.a.chef.utilisateurId],
      ),
    ).toBe("MPZ19");
  });
});
