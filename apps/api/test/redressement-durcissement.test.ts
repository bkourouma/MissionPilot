import { SEUILS_ALERTE_DEFAUT } from "@missionpilot/engines";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seuilsVersJson } from "../src/redressement/vues.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import { creerMission } from "./missions-outils.js";
import { attendre } from "./portail-outils.js";
import {
  CORRESPONDANCE_CAS_A,
  erreur,
  INCONNU,
  ouvrirDossierRed,
  preparerRed,
  type ScenarioRed,
} from "./redressement-outils.js";

/*
 * Durcissements issus de l'audit de sécurité du lot 3a : débits de création des objets à plafond
 * irréversible (429), brouillon de seuils unique par secteur, annulation d'un paiement et refus du
 * paiement en double, plan de 300 actions (contenu au-delà de 120 Ko), lectures bornées, journal
 * (valeurs avant et après des seuls indicateurs, jamais un nom).
 */

let ctx: Contexte;
let s: ScenarioRed;

const M = 1_000_000;
const urlD = (id: string, suffixe = "") => `/api/redressement/dossiers/${id}${suffixe}`;
const urlC = (id: string, suffixe = "") => `/api/redressement/creanciers/${id}${suffixe}`;
const defaut = seuilsVersJson(SEUILS_ALERTE_DEFAUT);

async function dossier(intitule: string): Promise<string> {
  return (await ouvrirDossierRed(s, (await creerMission(s.a, { intitule })).id)).id;
}

beforeAll(async () => {
  ctx = await demarrer();
  s = await preparerRed(ctx, "RED durcissement");
}, 120_000);

afterAll(async () => {
  await ctx.fermer();
});

describe("débits de création (429) : plafonds irréversibles protégés", () => {
  const u = () => s.associe2;

  it("correspondances : 20 par utilisateur et par 10 minutes", async () => {
    const d = await dossier("Débit correspondances");
    for (let i = 0; i < 20; i += 1) {
      attendre(
        201,
        await u().post(urlD(d, "/correspondances"), { postes: CORRESPONDANCE_CAS_A }),
        `v${i}`,
      );
    }
    const trop = await u().post(urlD(d, "/correspondances"), { postes: CORRESPONDANCE_CAS_A });
    expect(trop.statusCode).toBe(429);
    expect(erreur(trop)).toBe("RED_TROP_DE_CORRESPONDANCES");
  });

  it("versions de plan : 20 par utilisateur et par 10 minutes", async () => {
    const d = await dossier("Débit versions de plan");
    for (let i = 0; i < 20; i += 1) {
      attendre(201, await u().post(urlD(d, "/plan/versions"), {}), `v${i}`);
    }
    const trop = await u().post(urlD(d, "/plan/versions"), {});
    expect(trop.statusCode).toBe(429);
    expect(erreur(trop)).toBe("RED_TROP_DE_VERSIONS_PLAN");
  });

  it("actions : 60 par utilisateur et par 10 minutes", async () => {
    const d = await dossier("Débit actions");
    const corps = (i: number) => ({
      titre: `Action ${i}`,
      volet: "quick_win",
      domaine: "tresorerie",
      echeance: "2099-01-01",
      responsable_id: u().utilisateurId,
    });
    for (let i = 0; i < 60; i += 1)
      attendre(201, await u().post(urlD(d, "/actions"), corps(i)), `a${i}`);
    const trop = await u().post(urlD(d, "/actions"), corps(61));
    expect(trop.statusCode).toBe(429);
    expect(erreur(trop)).toBe("RED_TROP_D_ACTIONS");
  });

  it("créanciers et événements de négociation : 60 chacun par utilisateur et par 10 minutes", async () => {
    const d = await dossier("Débit créanciers");
    const creancier = (i: number) => ({
      nom: `Créancier ${i}`,
      categorie: "autre",
      principal: 1000,
      date_arrete: "2026-10-01",
    });
    let premier = "";
    for (let i = 0; i < 60; i += 1) {
      const r = await u().post(urlD(d, "/creanciers"), creancier(i));
      attendre(201, r, `c${i}`);
      if (i === 0) premier = r.json().id;
    }
    const trop = await u().post(urlD(d, "/creanciers"), creancier(61));
    expect(trop.statusCode).toBe(429);
    expect(erreur(trop)).toBe("RED_TROP_DE_CREANCIERS");
    for (let i = 0; i < 60; i += 1) {
      attendre(
        201,
        await u().post(urlC(premier, "/evenements"), {
          type: "note",
          date_evenement: "2026-10-10",
        }),
        `e${i}`,
      );
    }
    const tropEv = await u().post(urlC(premier, "/evenements"), {
      type: "note",
      date_evenement: "2026-10-10",
    });
    expect(tropEv.statusCode).toBe(429);
    expect(erreur(tropEv)).toBe("RED_TROP_D_EVENEMENTS");
  });

  it("seuils : 10 versions par utilisateur et par 10 minutes (un brouillon à la fois)", async () => {
    for (let i = 0; i < 10; i += 1) {
      const v = await u().post("/api/redressement/seuils", { secteur: "btp", seuils: defaut });
      attendre(201, v, `v${i}`);
      attendre(
        200,
        await u().post(`/api/redressement/seuils/${v.json().id}/publication`, {}),
        `p${i}`,
      );
    }
    const trop = await u().post("/api/redressement/seuils", { secteur: "btp", seuils: defaut });
    expect(trop.statusCode).toBe(429);
    expect(erreur(trop)).toBe("RED_TROP_DE_SEUILS");
  });
});

describe("brouillon de seuils unique par secteur", () => {
  it("409 RED_SEUILS_BROUILLON_EN_COURS tant que la dernière version est un brouillon ; autre secteur libre", async () => {
    const v = await s.expert.post("/api/redressement/seuils", {
      secteur: "agriculture",
      seuils: defaut,
    });
    attendre(201, v, "brouillon");
    const bis = await s.expert2.post("/api/redressement/seuils", {
      secteur: "agriculture",
      seuils: defaut,
    });
    expect(bis.statusCode).toBe(409);
    expect(erreur(bis)).toBe("RED_SEUILS_BROUILLON_EN_COURS");
    attendre(
      201,
      await s.expert2.post("/api/redressement/seuils", { secteur: "services", seuils: defaut }),
      "autre secteur",
    );
    attendre(
      200,
      await s.expert2.post(`/api/redressement/seuils/${v.json().id}/publication`, {}),
      "publication",
    );
    attendre(
      201,
      await s.expert.post("/api/redressement/seuils", { secteur: "agriculture", seuils: defaut }),
      "après publication",
    );
  });
});

describe("annulation d'un paiement et paiement en double", () => {
  const accord = {
    type: "accord",
    date_evenement: "2019-12-20",
    montant: 80 * M,
    echeancier: {
      mode: "explicite",
      lignes: [
        { date: "2020-01-15", montant: 40 * M },
        { date: "2099-01-15", montant: 40 * M },
      ],
    },
  };
  const paiement = (accordId: string, montant: number, extra: Record<string, unknown> = {}) => ({
    type: "paiement",
    date_evenement: "2020-01-16",
    montant,
    accord_id: accordId,
    ...extra,
  });

  it("le paiement saisi en double est refusé (409) ; une annulation corrige ; le total payé exclut les annulés", async () => {
    const d = await dossier("Annulation");
    const c = (
      await s.a.chef.post(urlD(d, "/creanciers"), {
        nom: "Banque",
        categorie: "banque",
        principal: 90 * M,
        interets: 10 * M,
        date_arrete: "2026-10-01",
      })
    ).json();
    const a = (await s.a.chef.post(urlC(c.id, "/evenements"), accord)).json().accord_en_vigueur;
    const p1 = await s.a.chef.post(
      urlC(c.id, "/evenements"),
      paiement(a.id, 30 * M, { echeance_rang: 1 }),
    );
    attendre(201, p1, "paiement");
    const idPaiement = p1.json().accord_en_vigueur.paiements[0].id as string;
    expect(idPaiement).toBeTruthy();
    // Double envoi : même accord, date, montant, échéance, même auteur, dans la minute.
    const doublon = await s.a.chef.post(
      urlC(c.id, "/evenements"),
      paiement(a.id, 30 * M, { echeance_rang: 1 }),
    );
    expect(doublon.statusCode).toBe(409);
    expect(erreur(doublon)).toBe("RED_PAIEMENT_EN_DOUBLE");
    // Un montant différent n'est pas un doublon.
    attendre(
      201,
      await s.a.chef.post(urlC(c.id, "/evenements"), paiement(a.id, 10 * M)),
      "autre montant",
    );
    // Annulation du premier : le total payé retombe à 10 M.
    const annul = await s.a.chef.post(urlC(c.id, "/evenements"), {
      type: "annulation_paiement",
      date_evenement: "2026-10-11",
      paiement_annule_id: idPaiement,
    });
    attendre(201, annul, "annulation");
    const v = annul.json();
    expect(v.accord_en_vigueur.paiements).toHaveLength(1);
    expect(v.accord_en_vigueur.paiements[0]).toMatchObject({ montant: 10 * M });
    expect(v.situation.accord.total_paye).toBe(10 * M);
    const ev = v.evenements.find((e: { type: string }) => e.type === "annulation_paiement");
    expect(ev).toMatchObject({ paiement_annule_id: idPaiement, accord_id: a.id, montant: null });
    // Le paiement annulé reste dans l'historique (ajout seul).
    expect(v.evenements.filter((e: { type: string }) => e.type === "paiement")).toHaveLength(2);
    // Une seconde annulation du même paiement, ou d'un identifiant étranger : 409.
    for (const id of [idPaiement, INCONNU, a.id]) {
      const r = await s.a.chef.post(urlC(c.id, "/evenements"), {
        type: "annulation_paiement",
        date_evenement: "2026-10-11",
        paiement_annule_id: id,
      });
      expect(r.statusCode, id).toBe(409);
      expect(erreur(r)).toBe("RED_NEGOCIATION_INCOHERENTE");
    }
    // Le paiement identique peut être ressaisi une fois l'original annulé.
    attendre(
      201,
      await s.a.chef.post(urlC(c.id, "/evenements"), paiement(a.id, 30 * M, { echeance_rang: 1 })),
      "ressaisie",
    );
    // Plafond du paiement : calculé sur le total NET des annulations (10 + 30 = 40 M payés, 40 M restent).
    const trop = await s.a.chef.post(
      urlC(c.id, "/evenements"),
      paiement(a.id, 40 * M + 1, { date_evenement: "2020-01-17" }),
    );
    expect(erreur(trop)).toBe("RED_PAIEMENT_EXCESSIF");
    attendre(
      201,
      await s.a.chef.post(
        urlC(c.id, "/evenements"),
        paiement(a.id, 40 * M, { date_evenement: "2020-01-17" }),
      ),
      "solde",
    );
    // Le paiement d'un autre créancier ne s'annule pas par celui-ci.
    const autre = (
      await s.a.chef.post(urlD(d, "/creanciers"), {
        nom: "Autre",
        categorie: "autre",
        principal: M,
        date_arrete: "2026-10-01",
      })
    ).json();
    const croise = await s.a.chef.post(urlC(autre.id, "/evenements"), {
      type: "annulation_paiement",
      date_evenement: "2026-10-11",
      paiement_annule_id: idPaiement,
    });
    expect(croise.statusCode).toBe(409);
    // Corps strict ; identifiant mal formé : 400. Le journal ne porte que le type.
    expect(
      (
        await s.a.chef.post(urlC(c.id, "/evenements"), {
          type: "annulation_paiement",
          date_evenement: "2026-10-11",
          paiement_annule_id: idPaiement,
          montant: 5,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await s.a.chef.post(urlC(c.id, "/evenements"), {
          type: "annulation_paiement",
          date_evenement: "2026-10-11",
          paiement_annule_id: "x",
        })
      ).statusCode,
    ).toBe(400);
    const j = await proprietaire((cl) =>
      cl.query(
        "SELECT details FROM journal_audit WHERE entite = 'red_creancier' AND entite_id = $1 AND action = 'evenement'",
        [c.id],
      ),
    );
    expect(j.rows.some((x) => x.details.type === "annulation_paiement")).toBe(true);
    for (const x of j.rows) expect(Object.keys(x.details).sort()).toEqual(["dossier_id", "type"]);
  });

  it("lectures bornées : seuls les créanciers actifs et le dernier accord comptent dans le résumé du dossier", async () => {
    const d = await dossier("Résumé borné");
    const cree = async (nom: string, principal: number) =>
      (
        await s.a.chef.post(urlD(d, "/creanciers"), {
          nom,
          categorie: "fournisseur",
          principal,
          date_arrete: "2026-10-01",
        })
      ).json();
    const actif = await cree("Actif", 10 * M);
    const inactif = await cree("Inactif", 500 * M);
    await s.a.chef.patch(urlC(inactif.id), { actif: false });
    expect((await s.a.chef.get(urlD(d))).json().creanciers).toEqual({
      nombre: 1,
      encours_total: 10 * M,
      echu_total: 0,
    });
    // Ancien accord rompu puis nouvel accord : la situation suit le dernier.
    const a1 = (
      await s.a.chef.post(urlC(actif.id, "/evenements"), {
        type: "accord",
        date_evenement: "2019-12-20",
        montant: 8 * M,
        echeancier: {
          mode: "regulier",
          nombre_echeances: 2,
          date_premiere: "2099-01-01",
          periodicite_mois: 1,
        },
      })
    ).json().accord_en_vigueur;
    attendre(
      201,
      await s.a.chef.post(urlC(actif.id, "/evenements"), {
        type: "rupture",
        date_evenement: "2020-03-01",
        accord_id: a1.id,
      }),
      "rupture",
    );
    attendre(
      201,
      await s.a.chef.post(urlC(actif.id, "/evenements"), {
        ...accord,
        montant: 6 * M,
        echeancier: {
          mode: "regulier",
          nombre_echeances: 2,
          date_premiere: "2099-05-01",
          periodicite_mois: 1,
        },
      }),
      "nouvel accord",
    );
    const liste = (await s.a.chef.get(urlD(d, "/creanciers"))).json();
    expect(liste.elements).toHaveLength(1);
    expect(liste.elements[0].situation.accord).toMatchObject({
      statut: "respecte",
      montant_convenu: 6 * M,
    });
    expect(liste.elements[0].situation.encours_restant).toBe(6 * M);
  });
});

describe("plan de 300 actions : contenu au-delà de 120 Ko", () => {
  it("la version est enregistrée (contenu jusqu'à 400 Ko) et le plan reste lisible", async () => {
    const d = await dossier("Grand plan");
    const titre = "é".repeat(200);
    await proprietaire((c) =>
      c.query(
        `INSERT INTO red_actions (cabinet_id, dossier_id, titre, volet, domaine, echeance, responsable_id, cree_par)
         SELECT $1, $2, $5 || g, 'quick_win', 'tresorerie', '2099-01-01', $3, $4 FROM generate_series(1, 300) g`,
        [s.a.cabinetId, d, s.a.chef.utilisateurId, s.a.chef.utilisateurId, titre.slice(0, 190)],
      ),
    );
    const r = await s.a.chef.post(urlD(d, "/plan/versions"), {});
    attendre(201, r, "version");
    expect(r.json().contenu.actions).toHaveLength(300);
    const taille = await proprietaire((c) =>
      c.query("SELECT octet_length(contenu::text) AS n FROM red_plan_versions WHERE id = $1", [
        r.json().id,
      ]),
    );
    expect(taille.rows[0].n).toBeGreaterThan(120_000);
    expect(taille.rows[0].n).toBeLessThanOrEqual(400_000);
    // Lecture : les versions n'embarquent pas leur contenu ; l'écart reste calculable.
    const plan = (await s.a.chef.get(urlD(d, "/plan"))).json();
    expect(plan.versions).toHaveLength(1);
    expect(plan.versions[0].contenu).toBeUndefined();
    expect(Object.values(plan.kanban.colonnes).flat()).toHaveLength(300);
    // Au-delà de 400 Ko, la base refuse (23514).
    const refus = await proprietaire(async (c) => {
      try {
        await c.query(
          `INSERT INTO red_plan_versions (cabinet_id, dossier_id, version, date_reference, contenu, empreinte, cree_par)
           VALUES ($1, $2, 2, '2026-10-11', jsonb_build_object('x', repeat('a', 400001)), repeat('a', 64), $3)`,
          [s.a.cabinetId, d, s.a.chef.utilisateurId],
        );
        return "aucun";
      } catch (e) {
        return (e as { code?: string }).code;
      }
    });
    expect(refus).toBe("23514");
  });
});

describe("journal : valeurs avant et après des seuls indicateurs", () => {
  it("créancier : actif et garanti (de, vers), jamais le nom ni la référence ; dossier : secteur, jamais l'intitulé", async () => {
    const d = await dossier("Journal indicateurs");
    const c = (
      await s.a.chef.post(urlD(d, "/creanciers"), {
        nom: "Nom confidentiel",
        categorie: "banque",
        principal: M,
        date_arrete: "2026-10-01",
      })
    ).json();
    attendre(
      200,
      await s.a.chef.patch(urlC(c.id), {
        actif: false,
        garanti: true,
        nom: "Nouveau nom secret",
        reference: "Réf secrète",
      }),
      "modification",
    );
    const j = await proprietaire((cl) =>
      cl.query(
        "SELECT details FROM journal_audit WHERE entite = 'red_creancier' AND action = 'modification' AND entite_id = $1",
        [c.id],
      ),
    );
    expect(j.rows[0].details).toMatchObject({
      actif: { de: true, vers: false },
      garanti: { de: false, vers: true },
    });
    expect(JSON.stringify(j.rows[0].details)).not.toMatch(/secret|confidentiel/i);
    attendre(
      200,
      await s.a.chef.patch(urlD(d), { secteur: "btp", intitule: "Intitulé confidentiel" }),
      "dossier",
    );
    const jd = await proprietaire((cl) =>
      cl.query(
        "SELECT details FROM journal_audit WHERE entite = 'red_dossier' AND action = 'modification' AND entite_id = $1",
        [d],
      ),
    );
    expect(jd.rows[0].details).toMatchObject({ secteur: { de: "general", vers: "btp" } });
    expect(JSON.stringify(jd.rows[0].details)).not.toContain("confidentiel");
  });
});
