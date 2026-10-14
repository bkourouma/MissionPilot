import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, type Api } from "./api.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import { creerMission, creerMissionSignee } from "./missions-outils.js";
import { attendre } from "./portail-outils.js";
import {
  erreur,
  INCONNU,
  ouvrirDossierRed,
  preparerRed,
  type ScenarioRed,
} from "./redressement-outils.js";

/*
 * Créanciers, créances, négociations, accords et échéanciers (routes 23 à 28) : doublon (409), versions
 * de créance, accord régulier (C1) et explicite invalide, deuxième accord (409), paiements (excessif,
 * rupture, paiement après rupture), situation (C5, C7, C8) et synthèse du passif (C10) rendues par le
 * moteur. Les dates d'échéance sont posées loin dans le passé (2020) et dans le futur (2099) : la date
 * de référence est le jour courant. Le journal ne contient aucun nom, montant ni condition.
 */

let ctx: Contexte;
let s: ScenarioRed;
let dossierId: string;

const M = 1_000_000;
const urlD = (suffixe: string, id = dossierId) => `/api/redressement/dossiers/${id}${suffixe}`;
const urlC = (id: string, suffixe = "") => `/api/redressement/creanciers/${id}${suffixe}`;

const corpsCreancier = (extra: Record<string, unknown> = {}) => ({
  nom: "Banque de développement",
  categorie: "banque",
  principal: 90 * M,
  interets: 10 * M,
  date_arrete: "2026-10-01",
  ...extra,
});

async function creer(par: Api, extra: Record<string, unknown> = {}, d = dossierId) {
  const r = await par.post(urlD("/creanciers", d), corpsCreancier(extra));
  attendre(201, r, "créancier");
  return r.json() as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** Accord de 80 M en quatre échéances de 20 M : deux échues (2020), deux à venir (2099). */
const accord4 = (extra: Record<string, unknown> = {}) => ({
  type: "accord",
  date_evenement: "2019-12-20",
  montant: 80 * M,
  conditions: "Clause de déchéance du terme secrète",
  echeancier: {
    mode: "explicite",
    lignes: [
      { date: "2020-01-15", montant: 20 * M },
      { date: "2020-02-15", montant: 20 * M },
      { date: "2099-01-15", montant: 20 * M },
      { date: "2099-02-15", montant: 20 * M },
    ],
  },
  ...extra,
});

const paiement = (accordId: string, montant: number, extra: Record<string, unknown> = {}) => ({
  type: "paiement",
  date_evenement: "2020-01-16",
  montant,
  accord_id: accordId,
  ...extra,
});

beforeAll(async () => {
  ctx = await demarrer();
  s = await preparerRed(ctx, "RED creanciers");
  dossierId = (await ouvrirDossierRed(s)).id;
}, 120_000);

afterAll(async () => {
  await ctx.fermer();
});

describe("accès (routes 23 à 28)", () => {
  it("401, 403, 404 et autre cabinet", async () => {
    const c = await creer(s.a.chef, { nom: "Pour les accès" });
    const defs: ["GET" | "POST" | "PATCH", string, unknown, "lecture" | "ecriture"][] = [
      ["GET", urlD("/creanciers"), undefined, "lecture"],
      ["POST", urlD("/creanciers"), corpsCreancier({ nom: "Autre" }), "ecriture"],
      ["GET", urlC(c.id), undefined, "lecture"],
      ["PATCH", urlC(c.id), { garanti: true }, "ecriture"],
      ["POST", urlC(c.id, "/creances"), { principal: 1, date_arrete: "2026-10-02" }, "ecriture"],
      [
        "POST",
        urlC(c.id, "/evenements"),
        { type: "note", date_evenement: "2026-10-02" },
        "ecriture",
      ],
    ];
    const appeler = (par: Api, d: (typeof defs)[number]) =>
      d[0] === "GET"
        ? par.get(d[1])
        : d[0] === "PATCH"
          ? par.patch(d[1], d[2])
          : par.post(d[1], d[2]);
    for (const d of defs) {
      expect((await appeler(api(ctx), d)).statusCode, `401 ${d[1]}`).toBe(401);
      for (const u of [s.gestionnaire, s.ressources, s.expertExterne]) {
        expect((await appeler(u, d)).statusCode, `403 ${d[1]}`).toBe(403);
      }
      if (d[3] === "ecriture")
        expect((await appeler(s.expert, d)).statusCode, `403 expert ${d[1]}`).toBe(403);
      expect((await appeler(s.consultantHors, d)).statusCode, `404 ${d[1]}`).toBe(404);
      expect((await appeler(s.b.associe, d)).statusCode, `404 autre cabinet ${d[1]}`).toBe(404);
    }
    expect((await s.a.associe.get(urlC(INCONNU))).statusCode).toBe(404);
    expect((await s.a.associe.patch(urlC(INCONNU), { actif: false })).statusCode).toBe(404);
  });
});

describe("registre et créances (routes 24 à 27)", () => {
  it("création : créancier et créance n° 1 ; doublon 409 ; corps invalide 400", async () => {
    const c = await creer(s.consultantEquipe, {
      nom: "Fournisseur Alpha",
      categorie: "fournisseur",
      garanti: false,
      reference: "FA-1",
    });
    expect(c).toMatchObject({
      nom: "Fournisseur Alpha",
      categorie: "fournisseur",
      garanti: false,
      reference: "FA-1",
      actif: true,
      version_creance: 1,
      principal: 90 * M,
      interets: 10 * M,
    });
    expect(c.situation).toMatchObject({
      encours_initial: 100 * M,
      accord: null,
      encours_restant: 100 * M,
      echu: 0,
    });
    expect(c.accord_en_vigueur).toBeNull();
    expect(c.creances).toHaveLength(1);
    expect(c.evenements).toEqual([]);
    const doublon = await s.a.chef.post(
      urlD("/creanciers"),
      corpsCreancier({ nom: "  fournisseur alpha ", categorie: "fournisseur" }),
    );
    expect(doublon.statusCode).toBe(409);
    expect(erreur(doublon)).toBe("RED_CREANCIER_EN_DOUBLE");
    // Même nom, autre catégorie : admis.
    await creer(s.a.chef, { nom: "Fournisseur Alpha", categorie: "autre" });
    for (const corps of [
      corpsCreancier({ nom: "" }),
      corpsCreancier({ categorie: "banquier" }),
      corpsCreancier({ principal: -1 }),
      corpsCreancier({ principal: 10 ** 13 + 1 }),
      corpsCreancier({ date_arrete: "1999-12-31" }),
      corpsCreancier({ exces: 1 }),
    ]) {
      expect(
        (await s.a.chef.post(urlD("/creanciers"), corps)).statusCode,
        JSON.stringify(corps).slice(0, 60),
      ).toBe(400);
    }
  });

  it("modification bornée : doublon de nom 409, désactivation ; versions de créance (ajout seul)", async () => {
    const c = await creer(s.a.chef, { nom: "Bailleur du siège", categorie: "bailleur" });
    const autre = await creer(s.a.chef, { nom: "Bailleur annexe", categorie: "bailleur" });
    const dup = await s.a.chef.patch(urlC(autre.id), { nom: "bailleur du siège" });
    expect(dup.statusCode).toBe(409);
    expect(erreur(dup)).toBe("RED_CREANCIER_EN_DOUBLE");
    expect((await s.a.chef.patch(urlC(c.id), {})).statusCode).toBe(400);
    expect((await s.a.chef.patch(urlC(c.id), { categorie: "autre" })).statusCode).toBe(400);
    const m = await s.consultantEquipe.patch(urlC(c.id), {
      garanti: true,
      reference: "Bail 2024",
      actif: false,
    });
    attendre(200, m, "modification");
    expect(m.json()).toMatchObject({ garanti: true, reference: "Bail 2024", actif: false });
    const v2 = await s.a.chef.post(urlC(c.id, "/creances"), {
      principal: 70 * M,
      interets: 5 * M,
      date_arrete: "2026-10-05",
      nature: "Loyers impayés",
      commentaire: "Arrêté de compte",
    });
    attendre(201, v2, "créance v2");
    expect(v2.json()).toMatchObject({ version_creance: 2, principal: 70 * M, interets: 5 * M });
    expect(v2.json().creances.map((x: { version: number }) => x.version)).toEqual([2, 1]);
    expect(v2.json().situation.encours_initial).toBe(75 * M);
    expect(
      (
        await s.a.chef.post(urlC(c.id, "/creances"), {
          principal: 1,
          date_arrete: "2026-10-05",
          exces: 1,
        })
      ).statusCode,
    ).toBe(400);
    // Ajout seul : aucune route ne modifie une créance existante ; la base le refuse.
    const refus = await proprietaire(async (cl) => {
      try {
        await cl.query("UPDATE red_creances SET principal = 1 WHERE creancier_id = $1", [c.id]);
        return "aucun";
      } catch (e) {
        return (e as { code?: string }).code;
      }
    });
    expect(refus).toBe("MPZ01");
  });

  it("actifs : liste par défaut = actifs ; `false` et `tous`", async () => {
    const d = (await ouvrirDossierRed(s, (await creerMission(s.a, { intitule: "Actifs" })).id)).id;
    const a1 = await creer(s.a.chef, { nom: "Actif" }, d);
    const a2 = await creer(s.a.chef, { nom: "Inactif" }, d);
    await s.a.chef.patch(urlC(a2.id), { actif: false });
    const noms = async (q: string) =>
      ((await s.a.chef.get(urlD(`/creanciers${q}`, d))).json().elements as { nom: string }[]).map(
        (x) => x.nom,
      );
    expect(await noms("")).toEqual(["Actif"]);
    expect(await noms("?actifs=false")).toEqual(["Inactif"]);
    expect((await noms("?actifs=tous")).sort()).toEqual(["Actif", "Inactif"]);
    expect((await s.a.chef.get(urlD("/creanciers?actifs=peut-etre", d))).statusCode).toBe(400);
    expect(a1.id).toBeTruthy();
  });
});

describe("négociation et accords (route 28)", () => {
  it("C1 : accord régulier de 10 000 001 en 3 échéances : 3 333 333, 3 333 333, 3 333 335", async () => {
    const c = await creer(s.a.chef, { nom: "Régulier", categorie: "fournisseur" });
    const r = await s.a.chef.post(urlC(c.id, "/evenements"), {
      type: "accord",
      date_evenement: "2026-10-10",
      montant: 10_000_001,
      conditions: "Remise des pénalités",
      echeancier: {
        mode: "regulier",
        nombre_echeances: 3,
        date_premiere: "2026-11-30",
        periodicite_mois: 1,
      },
    });
    attendre(201, r, "accord régulier");
    const a = r.json().accord_en_vigueur;
    expect(a).toMatchObject({
      montant_convenu: 10_000_001,
      conditions: "Remise des pénalités",
      paiements: [],
    });
    expect(a.echeances).toEqual([
      { rang: 1, date: "2026-11-30", montant: 3_333_333 },
      { rang: 2, date: "2026-12-30", montant: 3_333_333 },
      { rang: 3, date: "2027-01-30", montant: 3_333_335 },
    ]);
    expect(r.json().evenements).toHaveLength(1);
  });

  it("échéancier explicite invalide, accord supérieur à la créance, deuxième accord, corps invalide", async () => {
    const c = await creer(s.a.chef, { nom: "Contrôles", categorie: "social" });
    const url = urlC(c.id, "/evenements");
    const somme = await s.a.chef.post(url, accord4({ montant: 80 * M - 1 }));
    expect(somme.statusCode).toBe(400);
    expect(erreur(somme)).toBe("RED_ECHEANCIER_INVALIDE");
    const dates = await s.a.chef.post(
      url,
      accord4({
        echeancier: {
          mode: "explicite",
          lignes: [
            { date: "2020-02-15", montant: 40 * M },
            { date: "2020-01-15", montant: 40 * M },
          ],
        },
      }),
    );
    expect(erreur(dates)).toBe("RED_ECHEANCIER_INVALIDE");
    const trop = await s.a.chef.post(
      url,
      accord4({
        montant: 100 * M + 1,
        echeancier: {
          mode: "regulier",
          nombre_echeances: 2,
          date_premiere: "2026-11-01",
          periodicite_mois: 1,
        },
      }),
    );
    expect(trop.statusCode).toBe(400);
    expect(erreur(trop)).toBe("RED_ACCORD_SUPERIEUR_CREANCE");
    for (const corps of [
      { type: "accord", date_evenement: "2026-10-10", montant: 10 },
      { type: "inconnu", date_evenement: "2026-10-10" },
      { type: "paiement", date_evenement: "2026-10-10", montant: 1 },
      { type: "note", date_evenement: "2026-10-10", exces: 1 },
      {
        type: "accord",
        date_evenement: "2026-10-10",
        montant: 10,
        echeancier: {
          mode: "regulier",
          nombre_echeances: 61,
          date_premiere: "2026-11-01",
          periodicite_mois: 1,
        },
      },
    ]) {
      expect((await s.a.chef.post(url, corps)).statusCode, JSON.stringify(corps).slice(0, 70)).toBe(
        400,
      );
    }
    // Un accord valide, puis un deuxième : 409 RED_ACCORD_EN_VIGUEUR.
    attendre(201, await s.a.chef.post(url, accord4()), "accord");
    const deux = await s.a.chef.post(url, accord4());
    expect(deux.statusCode).toBe(409);
    expect(erreur(deux)).toBe("RED_ACCORD_EN_VIGUEUR");
  });

  it("C5 : situation recalculée par le moteur : retard 20 M, en retard, reste à payer 60 M", async () => {
    const c = await creer(s.a.chef, { nom: "Situation", categorie: "fournisseur" });
    const accord = (await s.a.chef.post(urlC(c.id, "/evenements"), accord4())).json()
      .accord_en_vigueur;
    const r = await s.a.chef.post(
      urlC(c.id, "/evenements"),
      paiement(accord.id, 20 * M, { echeance_rang: 1 }),
    );
    attendre(201, r, "paiement");
    const v = r.json();
    expect(v.accord_en_vigueur.paiements).toEqual([
      { id: expect.any(String), date: "2020-01-16", montant: 20 * M, echeance_rang: 1 },
    ]);
    expect(v.situation).toMatchObject({
      encours_initial: 100 * M,
      encours_restant: 60 * M,
      echu: 20 * M,
    });
    expect(v.situation.accord).toMatchObject({
      statut: "en_retard",
      montant_convenu: 80 * M,
      remise: 20 * M,
      total_paye: 20 * M,
      reste_a_payer: 60 * M,
      echeances_echues: 2,
      montant_echu: 40 * M,
      retard: 20 * M,
      prochaine_non_soldee: { rang: 2, date: "2020-02-15", montant_restant: 20 * M },
    });
    expect(
      v.situation.accord.echeances_restantes.map((e: { rang: number; montant_restant: number }) => [
        e.rang,
        e.montant_restant,
      ]),
    ).toEqual([
      [2, 20 * M],
      [3, 20 * M],
      [4, 20 * M],
    ]);
    // Échéance inexistante, accord d'un autre créancier : 409 RED_NEGOCIATION_INCOHERENTE.
    const hors = await s.a.chef.post(
      urlC(c.id, "/evenements"),
      paiement(accord.id, 1, { echeance_rang: 9 }),
    );
    expect(hors.statusCode).toBe(409);
    expect(erreur(hors)).toBe("RED_NEGOCIATION_INCOHERENTE");
    const autre = await creer(s.a.chef, { nom: "Autre créancier", categorie: "fiscal" });
    const croise = await s.a.chef.post(urlC(autre.id, "/evenements"), paiement(accord.id, 1));
    expect(croise.statusCode).toBe(409);
    expect(erreur(croise)).toBe("RED_NEGOCIATION_INCOHERENTE");
    // Paiement excessif : 60 M déjà dus, 60 M + 1 de plus refusé ; paiement exact accepté : soldé.
    const exces = await s.a.chef.post(urlC(c.id, "/evenements"), paiement(accord.id, 60 * M + 1));
    expect(exces.statusCode).toBe(409);
    expect(erreur(exces)).toBe("RED_PAIEMENT_EXCESSIF");
    const exact = await s.a.chef.post(urlC(c.id, "/evenements"), paiement(accord.id, 60 * M));
    attendre(201, exact, "solde");
    expect(exact.json().situation.accord).toMatchObject({
      statut: "solde",
      reste_a_payer: 0,
      prochaine_non_soldee: null,
      echeances_restantes: [],
    });
    expect(exact.json().situation).toMatchObject({ encours_restant: 0, echu: 0 });
  });

  it("C7 : rupture : encours restant et échu = 80 M ; paiement ou rupture après rupture : 409 ; nouvel accord admis", async () => {
    const c = await creer(s.a.chef, { nom: "Rompu", categorie: "banque" });
    const accord = (await s.a.chef.post(urlC(c.id, "/evenements"), accord4())).json()
      .accord_en_vigueur;
    attendre(
      201,
      await s.a.chef.post(urlC(c.id, "/evenements"), paiement(accord.id, 20 * M)),
      "paiement",
    );
    const rupture = await s.a.chef.post(urlC(c.id, "/evenements"), {
      type: "rupture",
      date_evenement: "2020-03-01",
      accord_id: accord.id,
      conditions: "Défaut de paiement de l'échéance de février",
    });
    attendre(201, rupture, "rupture");
    const v = rupture.json();
    expect(v.accord_en_vigueur).toBeNull();
    expect(v.situation.accord).toMatchObject({ statut: "rompu", total_paye: 20 * M });
    expect(v.situation).toMatchObject({ encours_restant: 80 * M, echu: 80 * M });
    const apres = await s.a.chef.post(urlC(c.id, "/evenements"), paiement(accord.id, 1));
    expect(apres.statusCode).toBe(409);
    expect(erreur(apres)).toBe("RED_ACCORD_ROMPU");
    const bis = await s.a.chef.post(urlC(c.id, "/evenements"), {
      type: "rupture",
      date_evenement: "2020-03-02",
      accord_id: accord.id,
    });
    expect(bis.statusCode).toBe(409);
    expect(erreur(bis)).toBe("RED_ACCORD_ROMPU");
    attendre(
      201,
      await s.a.chef.post(
        urlC(c.id, "/evenements"),
        accord4({
          date_evenement: "2020-04-01",
          montant: 70 * M,
          echeancier: {
            mode: "regulier",
            nombre_echeances: 2,
            date_premiere: "2099-05-01",
            periodicite_mois: 1,
          },
        }),
      ),
      "nouvel accord",
    );
    // Le fil de négociation garde tout (ajout seul).
    const detail = (await s.a.chef.get(urlC(c.id))).json();
    expect(detail.evenements.map((e: { type: string }) => e.type).sort()).toEqual([
      "accord",
      "accord",
      "paiement",
      "rupture",
    ]);
  });

  it("C8 : sans accord, échéance initiale dépassée : tout l'encours est échu ; sans échéance : rien", async () => {
    const echu = await creer(s.a.chef, { nom: "Echu", echeance_initiale: "2020-09-30" });
    expect(echu.situation).toMatchObject({ accord: null, encours_restant: 100 * M, echu: 100 * M });
    const libre = await creer(s.a.chef, { nom: "Libre" });
    expect(libre.situation).toMatchObject({ encours_restant: 100 * M, echu: 0 });
  });

  it("événements simples : ouverture, proposition, contre-proposition, note ; mission clôturée : 409", async () => {
    const c = await creer(s.a.chef, { nom: "Simples", categorie: "fiscal" });
    for (const type of ["ouverture", "proposition", "contre_proposition", "note"]) {
      attendre(
        201,
        await s.a.chef.post(urlC(c.id, "/evenements"), {
          type,
          date_evenement: "2026-10-10",
          montant: 5 * M,
          conditions: "Étaler sur 12 mois",
        }),
        type,
      );
    }
    const detail = (await s.a.chef.get(urlC(c.id))).json();
    expect(detail.evenements).toHaveLength(4);
    expect(detail.evenements[0]).toMatchObject({
      type: "note",
      montant: 5 * M,
      conditions: "Étaler sur 12 mois",
      accord_id: null,
    });
    const m = await creerMissionSignee(s.a);
    const d = (await ouvrirDossierRed(s, m.id)).id;
    const cc = await creer(s.a.chef, { nom: "Avant clôture" }, d);
    await proprietaire((cl) =>
      cl.query("UPDATE missions SET statut = 'cloturee', cloturee_le = now() WHERE id = $1", [
        m.id,
      ]),
    );
    const r = await s.a.associe.post(urlC(cc.id, "/evenements"), {
      type: "note",
      date_evenement: "2026-10-10",
    });
    expect(r.statusCode).toBe(409);
    expect(erreur(r)).toBe("RED_MISSION_CLOTUREE");
    expect((await s.a.associe.get(urlC(cc.id))).statusCode).toBe(200);
  });
});

describe("synthèse du passif (route 23) : cas C10", () => {
  it("encours 230 M, échu 60 M, garantie 4348 pb, concentration des trois plus gros 8696 pb, par catégorie", async () => {
    const d = (await ouvrirDossierRed(s, (await creerMission(s.a, { intitule: "Synthèse" })).id))
      .id;
    const lot: [string, string, number, boolean, string | undefined][] = [
      ["Banque garantie", "banque", 100, true, undefined],
      ["Fournisseur A", "fournisseur", 60, false, "2020-06-30"],
      ["Fournisseur B", "fournisseur", 40, false, undefined],
      ["Trésor public", "fiscal", 20, false, undefined],
      ["Caisse sociale", "social", 10, false, undefined],
    ];
    for (const [nom, categorie, montant, garanti, echeance] of lot) {
      await creer(
        s.a.chef,
        {
          nom,
          categorie,
          garanti,
          principal: montant * M,
          interets: 0,
          ...(echeance ? { echeance_initiale: echeance } : {}),
        },
        d,
      );
    }
    const r = (await s.a.chef.get(urlD("/creanciers", d))).json();
    expect(r.elements).toHaveLength(5);
    expect(r.synthese).toMatchObject({
      nombre: 5,
      total_encours: 230 * M,
      total_echu: 60 * M,
      part_garantie_pb: 4348,
      concentration_top3_pb: 8696,
    });
    expect(r.synthese.par_categorie).toEqual([
      { categorie: "fournisseur", nombre: 2, encours: 100 * M, echu: 60 * M, part_pb: 4348 },
      { categorie: "banque", nombre: 1, encours: 100 * M, echu: 0, part_pb: 4348 },
      { categorie: "fiscal", nombre: 1, encours: 20 * M, echu: 0, part_pb: 870 },
      { categorie: "social", nombre: 1, encours: 10 * M, echu: 0, part_pb: 435 },
    ]);
    expect(typeof r.date_reference).toBe("string");
    // Le résumé du dossier reprend la synthèse.
    const dossier = (await s.a.chef.get(`/api/redressement/dossiers/${d}`)).json();
    expect(dossier.creanciers).toEqual({ nombre: 5, encours_total: 230 * M, echu_total: 60 * M });
    // Dossier vide : totaux nuls, parts nulles.
    const vide = (await ouvrirDossierRed(s, (await creerMission(s.a, { intitule: "Vide" })).id)).id;
    const v = (await s.a.chef.get(urlD("/creanciers", vide))).json();
    expect(v.synthese).toMatchObject({
      nombre: 0,
      total_encours: 0,
      part_garantie_pb: null,
      concentration_top3_pb: null,
      par_categorie: [],
    });
  });

  it("volume : 200 créanciers lus en moins de 5 secondes", async () => {
    const d = (await ouvrirDossierRed(s, (await creerMission(s.a, { intitule: "Volume" })).id)).id;
    await proprietaire(async (cl) => {
      await cl.query(
        `INSERT INTO red_creanciers (cabinet_id, dossier_id, nom, categorie, cree_par)
         SELECT $1, $2, 'Créancier ' || g, 'autre', $3 FROM generate_series(1, 200) g`,
        [s.a.cabinetId, d, s.a.chef.utilisateurId],
      );
      await cl.query(
        `INSERT INTO red_creances (cabinet_id, dossier_id, creancier_id, version, principal, date_arrete, saisi_par)
         SELECT $1, $2, c.id, 1, 1000, '2026-10-01', $3 FROM red_creanciers c WHERE c.dossier_id = $2`,
        [s.a.cabinetId, d, s.a.chef.utilisateurId],
      );
    });
    const debut = Date.now();
    const r = await s.a.chef.get(urlD("/creanciers", d));
    expect(Date.now() - debut).toBeLessThan(5000);
    expect(r.json().elements).toHaveLength(200);
    expect(r.json().synthese.total_encours).toBe(200_000);
  });
});

describe("journal d'audit", () => {
  it("ne contient jamais un nom de créancier, un montant ni une condition de négociation", async () => {
    const d = (await ouvrirDossierRed(s, (await creerMission(s.a, { intitule: "Journal" })).id)).id;
    const c = await creer(
      s.a.chef,
      { nom: "Banque Secrète Zéphyr", principal: 987_654_321, interets: 0 },
      d,
    );
    await s.a.chef.post(urlC(c.id, "/evenements"), {
      type: "accord",
      date_evenement: "2026-10-10",
      montant: 123_456_789,
      conditions: "Garantie hypothécaire sur l'usine de Bouaké",
      echeancier: {
        mode: "regulier",
        nombre_echeances: 2,
        date_premiere: "2099-01-01",
        periodicite_mois: 1,
      },
    });
    await s.a.chef.post(urlC(c.id, "/creances"), {
      principal: 555_444_333,
      date_arrete: "2026-10-05",
      commentaire: "Commentaire privé",
    });
    const j = await proprietaire((cl) =>
      cl.query(
        "SELECT action, details::text AS d FROM journal_audit WHERE entite = 'red_creancier' AND entite_id = $1",
        [c.id],
      ),
    );
    expect(j.rows.map((x) => x.action).sort()).toEqual(["creance", "creation", "evenement"]);
    const tout = j.rows.map((x) => x.d).join(" ");
    for (const interdit of [
      "Zéphyr",
      "Secrète",
      "987654321",
      "123456789",
      "555444333",
      "hypothécaire",
      "Bouaké",
      "privé",
    ]) {
      expect(tout, interdit).not.toContain(interdit);
    }
  });
});
