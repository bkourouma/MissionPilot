/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api } from "./api.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import { creerMission, creerMissionSignee } from "./missions-outils.js";
import {
  attendre,
  CRITERES_2026,
  creerCampagne,
  P,
  cloturerMission,
  preparerFroide,
  type ScenarioFroide,
} from "./qualite-froide-outils.js";

/*
 * Revue à froid (QUA-05), tirage : droits par rôle, isolation entre cabinets, reproductibilité
 * (graine, critères, stratification, exclusion des missions déjà revues), immuabilité en base.
 */

let ctx: Contexte;
let a: ScenarioFroide;
let b: ScenarioFroide;

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerFroide(ctx, "Froide Tirage A", 6);
  b = await preparerFroide(ctx, "Froide Tirage B", 2);
});
afterAll(async () => {
  await ctx.fermer();
});

const corps = (extra: Record<string, unknown> = {}) => ({
  intitule: "Campagne",
  criteres: { ...CRITERES_2026, exclure_deja_revues: false },
  taille: 3,
  graine: "graine-fixe",
  ...extra,
});

describe("droits", () => {
  it("l'associé tire ; les autres rôles et les anonymes non", async () => {
    expect((await api(ctx).post(`${P}/campagnes`, corps())).statusCode).toBe(401);
    for (const u of [
      a.c.chef,
      a.consultant,
      a.gestionnaire,
      a.ressources,
      a.c.directeur,
      a.tiers,
      a.tiers2,
    ]) {
      expect((await u.post(`${P}/campagnes`, corps())).statusCode).toBe(403);
      expect((await u.get(`${P}/campagnes`)).statusCode).toBe(403);
    }
    const ok = await a.c.associe.post(`${P}/campagnes`, corps());
    expect(ok.statusCode, ok.body).toBe(201);
  });

  it("refuse un corps ou une requête hors schéma (strict)", async () => {
    const x = await a.c.associe.post(`${P}/campagnes`, { ...corps(), inconnu: 1 });
    expect(x.statusCode).toBe(400);
    const y = await a.c.associe.post(`${P}/campagnes`, corps({ taille: 101 }));
    expect(y.statusCode).toBe(400);
    const z = await a.c.associe.get(`${P}/campagnes?foo=1`);
    expect(z.statusCode).toBe(400);
  });
});

describe("reproductibilité", () => {
  it("même graine et mêmes critères donnent le même échantillon ; la vérification est vraie", async () => {
    const c1 = await creerCampagne(a.c.associe, { graine: "reproductible" });
    const c2 = await creerCampagne(a.c.associe, { graine: "reproductible" });
    const ordre = (c: any) => c.echantillon.map((e: any) => [e.rang, e.mission_id, e.cle]);
    expect(c1.graine).toBe("reproductible");
    expect(ordre(c1)).toEqual(ordre(c2));
    expect(c1.echantillon).toHaveLength(6);
    expect(c1.population_taille).toBe(6);
    expect(c1.empreinte_population).toBe(c2.empreinte_population);
    const v = await a.c.associe.get(`${P}/campagnes/${c1.id}/verification`);
    expect(v.statusCode, v.body).toBe(200);
    expect(v.json()).toMatchObject({ reproductible: true, graine: "reproductible", ecarts: [] });
    // Une autre graine change l'ordre de tirage.
    const c3 = await creerCampagne(a.c.associe, { graine: "autre-graine" });
    expect(ordre(c3)).not.toEqual(ordre(c1));
  });

  it("la graine est générée par le serveur (12 hexadécimaux) puis enregistrée", async () => {
    const r = await a.c.associe.post(`${P}/campagnes`, {
      intitule: "Sans graine",
      criteres: { ...CRITERES_2026, exclure_deja_revues: false },
      taille: 2,
    });
    expect(r.statusCode, r.body).toBe(201);
    const c = r.json();
    expect(c.graine).toMatch(/^[0-9a-f]{12}$/);
    const relu = (await a.c.associe.get(`${P}/campagnes/${c.id}`)).json();
    expect(relu.graine).toBe(c.graine);
    expect(relu.echantillon).toHaveLength(2);
    expect(relu.echantillon.map((e: any) => e.rang)).toEqual([1, 2]);
    const v = (await a.c.associe.get(`${P}/campagnes/${c.id}/verification`)).json();
    expect(v.reproductible).toBe(true);
  });

  it("la vérification signale un écart si la population rejouée ne correspond plus", async () => {
    const s = await preparerFroide(ctx, "Froide Écart", 3);
    const dir = s.c.directeur.utilisateurId;
    const c = await creerCampagne(s.c.associe, {
      graine: "ecart",
      taille: 3,
      criteres: { ...CRITERES_2026, exclure_deja_revues: false, directeur_ids: [dir] },
    });
    expect(
      (await s.c.associe.get(`${P}/campagnes/${c.id}/verification`)).json().reproductible,
    ).toBe(true);
    // Le directeur d'une mission tirée change après le tirage : le rejeu ne la retrouve plus.
    const autre = await s.c.avecRoles(["directeur_mission"]);
    await proprietaire((cl) =>
      cl.query("UPDATE missions SET directeur_id = $2 WHERE id = $1", [
        c.echantillon[0].mission_id,
        autre.utilisateurId,
      ]),
    );
    const v = (await s.c.associe.get(`${P}/campagnes/${c.id}/verification`)).json();
    expect(v.reproductible).toBe(false);
    expect(v.ecarts.length).toBeGreaterThan(0);
    expect(v.ecarts[0]).toHaveProperty("message");
  });

  it("exclut les missions déjà revues quand le critère le demande, puis refuse une population vide", async () => {
    const s = await preparerFroide(ctx, "Froide Exclusion", 4);
    const crit = { ...CRITERES_2026, exclure_deja_revues: true };
    const un = await creerCampagne(s.c.associe, { criteres: crit, taille: 3, graine: "ex1" });
    const deux = await creerCampagne(s.c.associe, { criteres: crit, taille: 3, graine: "ex2" });
    const idsUn = un.echantillon.map((e: any) => e.mission_id);
    const idsDeux = deux.echantillon.map((e: any) => e.mission_id);
    expect(idsUn).toHaveLength(3);
    expect(idsDeux).toHaveLength(1);
    expect(idsDeux.filter((i: string) => idsUn.includes(i))).toEqual([]);
    expect(deux.population_taille).toBe(1);
    const vide = await s.c.associe.post(`${P}/campagnes`, corps({ criteres: crit }));
    expect(vide.statusCode).toBe(409);
    expect(vide.json().erreur.code).toBe("POPULATION_VIDE");
  });
});

describe("critères", () => {
  it("période, types et directeurs filtrent la population ; seules les missions clôturées comptent", async () => {
    const s = await preparerFroide(ctx, "Froide Critères", 0);
    const types = (await s.c.associe.get("/api/types-mission")).json().elements as {
      code: string;
      id: string;
    }[];
    const autreType = types.find((t) => t.id !== s.c.typePlanId) as { id: string };
    const dir2 = await s.c.avecRoles(["directeur_mission"]);
    const m = async (jour: string, corpsMission: Record<string, unknown>) => {
      const x = await creerMissionSignee(s.c, corpsMission);
      await cloturerMission(x.id, jour, s.c.directeur.utilisateurId);
      return x.id;
    };
    const m1 = await m("2026-02-10", { intitule: "T1 février" });
    const m2 = await m("2026-05-10", { intitule: "T1 mai" });
    const m3 = await m("2026-05-12", { intitule: "T2 mai", type_mission_id: autreType.id });
    const x4 = await creerMission(s.c, { intitule: "D2 août", directeur_id: dir2.utilisateurId });
    attendre(
      200,
      await dir2.post(`/api/missions/${x4.id}/signer`, { date_signature: "2026-02-01" }),
      "signature",
    );
    await cloturerMission(x4.id, "2026-08-01", s.c.directeur.utilisateurId);
    const m4 = x4.id;
    // Mission signée mais non clôturée : jamais tirée.
    await creerMissionSignee(s.c, { intitule: "En cours" });
    const base = { ...CRITERES_2026, exclure_deja_revues: false };
    const ids = async (criteres: Record<string, unknown>) => {
      const r = await s.c.associe.post(`${P}/campagnes`, corps({ criteres, taille: 10 }));
      expect(r.statusCode, r.body).toBe(201);
      return r
        .json()
        .echantillon.map((e: any) => e.mission_id)
        .sort();
    };
    expect(await ids(base)).toEqual([m1, m2, m3, m4].sort());
    expect(await ids({ ...base, periode_debut: "2026-05-01", periode_fin: "2026-05-31" })).toEqual(
      [m2, m3].sort(),
    );
    expect(await ids({ ...base, types_mission_ids: [autreType.id] })).toEqual([m3]);
    expect(await ids({ ...base, directeur_ids: [dir2.utilisateurId] })).toEqual([m4]);
    // Période invalide.
    const inverse = await s.c.associe.post(
      `${P}/campagnes`,
      corps({ criteres: { periode_debut: "2026-06-01", periode_fin: "2026-01-01" } }),
    );
    expect(inverse.statusCode).toBe(400);
  });

  it("la stratification répartit l'échantillon entre les types de mission", async () => {
    const s = await preparerFroide(ctx, "Froide Strates", 0);
    const types = (await s.c.associe.get("/api/types-mission")).json().elements as { id: string }[];
    const autreType = types.find((t) => t.id !== s.c.typePlanId) as { id: string };
    const parType = new Map<string, string>();
    for (let i = 0; i < 6; i++) {
      const type = i < 4 ? s.c.typePlanId : autreType.id;
      const x = await creerMissionSignee(s.c, { intitule: `Strate ${i}`, type_mission_id: type });
      await cloturerMission(x.id, "2026-04-10", s.c.directeur.utilisateurId);
      parType.set(x.id, type);
    }
    const c = await creerCampagne(s.c.associe, {
      taille: 2,
      graine: "strates",
      criteres: { ...CRITERES_2026, exclure_deja_revues: false, stratifier_par: "type_mission" },
    });
    const typesTires = c.echantillon.map((e: any) => parType.get(e.mission_id));
    expect(new Set(typesTires).size).toBe(2);
  });

  it("refuse plus de 5000 missions éligibles par un 409 « affiner les critères »", async () => {
    const s = await preparerFroide(ctx, "Froide Population", 1);
    // 5000 missions clôturées copiées en base (propriétaire) : une de plus que la borne.
    await proprietaire((cl) =>
      cl.query(
        `INSERT INTO missions (cabinet_id, intitule, client_id, mode_facturation, statut,
           date_signature, signee_par, taux_change, devise_reference, cloturee_le, cloturee_par)
         SELECT cabinet_id, 'Copie ' || g, client_id, mode_facturation, 'cloturee', date_signature,
           signee_par, taux_change, devise_reference, cloturee_le, cloturee_par
         FROM missions, generate_series(1, 5000) g WHERE id = $1`,
        [s.missions[0]],
      ),
    );
    const r = await s.c.associe.post(`${P}/campagnes`, corps());
    expect(r.statusCode).toBe(409);
    expect(r.json().erreur.code).toBe("POPULATION_TROP_GRANDE");
  });
});

describe("liste et détail", () => {
  it("liste paginée par curseur et détail complet", async () => {
    const s = await preparerFroide(ctx, "Froide Liste", 3);
    for (let i = 0; i < 3; i++) await creerCampagne(s.c.associe, { intitule: `Liste ${i}` });
    const p1 = (await s.c.associe.get(`${P}/campagnes?limite=2`)).json();
    expect(p1.elements).toHaveLength(2);
    expect(p1.curseur_suivant).toBeTruthy();
    const p2 = (
      await s.c.associe.get(
        `${P}/campagnes?limite=2&curseur=${encodeURIComponent(p1.curseur_suivant)}`,
      )
    ).json();
    expect(p2.elements).toHaveLength(1);
    expect(p2.curseur_suivant).toBeNull();
    expect(p1.elements[0]).toMatchObject({ statut: "ouverte", taille_obtenue: 3, terminees: 0 });
    const d = (await s.c.associe.get(`${P}/campagnes/${p1.elements[0].id}`)).json();
    expect(d.progression).toEqual({ total: 3, terminees: 0 });
    expect(d.echantillon[0]).toMatchObject({
      statut: "a_affecter",
      relecteur_id: null,
      client_nom: expect.stringContaining("Client de"),
    });
    expect(d.echantillon[0]).toHaveProperty("mission_intitule");
    expect(d.echantillon[0]).toHaveProperty("directeur_nom");
    expect(d.echantillon[0]).toHaveProperty("type_mission_libelle");
    expect(d).not.toHaveProperty("population_ids");
  });
});

describe("isolation entre cabinets", () => {
  it("le cabinet B reçoit 404 partout et ne tire pas les missions de A", async () => {
    const c = await creerCampagne(a.c.associe, { graine: "iso", taille: 2 });
    const e = c.echantillon[0].id;
    const urls: [string, string][] = [
      ["get", `${P}/campagnes/${c.id}`],
      ["get", `${P}/campagnes/${c.id}/verification`],
      ["get", `${P}/campagnes/${c.id}/plan`],
      ["get", `${P}/echantillons/${e}`],
      ["get", `${P}/echantillons/${e}/dossier`],
      ["get", `${P}/echantillons/${e}/relecteurs-eligibles`],
    ];
    for (const [, url] of urls) expect((await b.c.associe.get(url)).statusCode, url).toBe(404);
    expect((await b.c.associe.post(`${P}/campagnes/${c.id}/cloture`)).statusCode).toBe(404);
    expect(
      (
        await b.c.associe.post(`${P}/campagnes/${c.id}/actions`, {
          titre: "x",
          responsable_id: b.c.associeId,
          echeance: "2099-01-01",
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await b.c.associe.post(`${P}/echantillons/${e}/affectation`, {
          relecteur_id: b.tiers.utilisateurId,
        })
      ).statusCode,
    ).toBe(404);
    // B tire parmi SES missions seulement.
    const rb = await creerCampagne(b.c.associe, { graine: "iso", taille: 10 });
    const idsA = new Set(a.missions);
    expect(rb.echantillon).toHaveLength(2);
    for (const x of rb.echantillon) expect(idsA.has(x.mission_id)).toBe(false);
    // B ne peut pas désigner un relecteur de A sur sa propre revue.
    const refus = await b.c.associe.post(`${P}/echantillons/${rb.echantillon[0].id}/affectation`, {
      relecteur_id: a.tiers.utilisateurId,
    });
    expect(refus.statusCode).toBe(404);
    // La liste de B ne montre pas les campagnes de A.
    const liste = (await b.c.associe.get(`${P}/campagnes?limite=100`)).json().elements;
    expect(liste.map((x: any) => x.id)).not.toContain(c.id);
  });

  it("un cabinet sans mission clôturée reçoit une population vide, jamais celle d'un autre", async () => {
    const vide = await preparerFroide(ctx, "Froide Vide", 0);
    const r = await vide.c.associe.post(`${P}/campagnes`, corps());
    expect(r.statusCode).toBe(409);
    expect(r.json().erreur.code).toBe("POPULATION_VIDE");
  });
});

describe("immuabilité en base (MQQ02, MQQ05)", () => {
  it("critères, graine, population et échantillon sont figés ; seule la clôture change", async () => {
    const c = await creerCampagne(a.c.associe, { graine: "fige", taille: 2 });
    const sql = (texte: string, params: unknown[] = []) =>
      proprietaire((cl) => cl.query(texte, params));
    for (const champ of [
      "graine = 'autre'",
      "intitule = 'autre'",
      "taille_demandee = 5",
      `criteres = '{}'::jsonb`,
      `population_ids = '[]'::jsonb`,
      "empreinte_population = 'aaaaaaaaaaaaaa'",
    ]) {
      await expect(
        sql(`UPDATE qualite_froide_campagnes SET ${champ} WHERE id = $1`, [c.id]),
      ).rejects.toMatchObject({ code: "MQQ02" });
    }
    await expect(
      sql("UPDATE qualite_froide_echantillon SET cle = '00000000000000' WHERE id = $1", [
        c.echantillon[0].id,
      ]),
    ).rejects.toMatchObject({ code: "MQQ02" });
    await expect(
      sql("UPDATE qualite_froide_echantillon SET rang = 90 WHERE id = $1", [c.echantillon[0].id]),
    ).rejects.toMatchObject({ code: "MQQ02" });
    await expect(
      sql("DELETE FROM qualite_froide_echantillon WHERE id = $1", [c.echantillon[0].id]),
    ).rejects.toMatchObject({ code: "MQQ02" });
    await expect(
      sql("DELETE FROM qualite_froide_campagnes WHERE id = $1", [c.id]),
    ).rejects.toMatchObject({
      code: "MQQ02",
    });
    // Le rôle applicatif n'a ni UPDATE sur ces colonnes ni DELETE.
    // Mission hors population / non clôturée : refusée à l'insertion dans l'échantillon.
    const enCours = await creerMissionSignee(a.c, { intitule: "Non clôturée" });
    await expect(
      sql(
        `INSERT INTO qualite_froide_echantillon (cabinet_id, campagne_id, mission_id, rang, cle)
         VALUES ($1, $2, $3, 50, 'aaaaaaaaaaaaaa')`,
        [a.c.cabinetId, c.id, enCours.id],
      ),
    ).rejects.toMatchObject({ code: "MQQ05" });
    // Mission clôturée mais hors population (clôturée après le tirage).
    await cloturerMission(enCours.id, "2026-09-09", a.c.directeur.utilisateurId);
    await expect(
      sql(
        `INSERT INTO qualite_froide_echantillon (cabinet_id, campagne_id, mission_id, rang, cle)
         VALUES ($1, $2, $3, 50, 'aaaaaaaaaaaaaa')`,
        [a.c.cabinetId, c.id, enCours.id],
      ),
    ).rejects.toMatchObject({ code: "MQQ05" });
  });

  it("une revue terminée ou non, la clôture exige que toutes les revues soient terminées (MQQ10)", async () => {
    const c = await creerCampagne(a.c.associe, { graine: "cloture", taille: 2 });
    await expect(
      proprietaire((cl) =>
        cl.query(
          `UPDATE qualite_froide_campagnes SET statut = 'close', cloturee_le = now(), cloturee_par = $2
           WHERE id = $1`,
          [c.id, a.c.associeId],
        ),
      ),
    ).rejects.toMatchObject({ code: "MQQ10" });
    const r = await a.c.associe.post(`${P}/campagnes/${c.id}/cloture`);
    expect(r.statusCode).toBe(409);
    expect(r.json().erreur.code).toBe("REVUES_NON_TERMINEES");
    expect(r.json().erreur.details.manquants).toHaveLength(2);
  });
});
