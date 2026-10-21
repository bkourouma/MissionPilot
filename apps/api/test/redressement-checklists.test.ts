import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CHECKLISTS_DEPART,
  ITEMS_CHECKLIST_MAX,
  ITEM_AIDE_MAX,
  ITEM_ID_MAX,
  ITEM_LIBELLE_MAX,
  REPONSES_CHECKLIST,
  SECTEURS_CHECKLIST,
} from "@missionpilot/engines";
import {
  RED_CHECKLIST_AIDE_MAX,
  RED_CHECKLIST_ITEMS_MAX,
  RED_CHECKLIST_ITEM_ID_MAX,
  RED_CHECKLIST_LIBELLE_MAX,
  RED_CHECKLIST_MENTION_A_VALIDER,
  RED_CHECKLIST_REPONSES,
  RED_SECTEURS,
} from "@missionpilot/shared";
import type { Db } from "../src/db/pool.js";
import { api, type Api } from "./api.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import { creerMissionSignee } from "./missions-outils.js";
import { attendre, inviterClient, type UtilisateurPortail } from "./portail-outils.js";
import {
  codeProprietaire,
  codeSql,
  corpsModele,
  item,
  itemsDe,
  modelePublie,
  nouveauDossier,
  type Json,
} from "./redressement-checklists-outils.js";
import {
  INCONNU,
  erreur,
  ouvrirDossierRed,
  preparerRed,
  type ScenarioRed,
} from "./redressement-outils.js";

/*
 * Check-lists métier du redressement (RED-03) : référentiel, modèles du cabinet et leurs versions
 * (brouillon puis publiée, séparation des tâches, ajout seul), activation dans un dossier (instantané
 * figé), réponses en ajout seul (la dernière est la courante), taux du moteur, archivage, droits, portail
 * fermé, isolation entre cabinets, plafonds, dossier clos et mission clôturée, journal sans donnée saisie.
 */

let ctx: Contexte;
let s: ScenarioRed;
let dirigeant: UtilisateurPortail;
let dossierId: string;

const MODELES = "/api/redressement/checklists/modeles";
const urlD = (suffixe = "", id = dossierId) =>
  `/api/redressement/dossiers/${id}/checklists${suffixe}`;
const urlC = (id: string, suffixe = "") => `/api/redressement/checklists/${id}${suffixe}`;
const urlV = (id: string, suffixe = "") => `/api/redressement/checklists/versions/${id}${suffixe}`;
const reponse = (item_id: string, rep = "oui", extra: Record<string, unknown> = {}) => ({
  item_id,
  reponse: rep,
  ...extra,
});

async function activerDepart(par: Api, code: string, dossier = dossierId): Promise<Json> {
  const r = await par.post(urlD("", dossier), { origine: "depart", code });
  attendre(201, r, `activation ${code}`);
  return r.json();
}

beforeAll(async () => {
  ctx = await demarrer();
  s = await preparerRed(ctx, "RED check-lists");
  dossierId = (await ouvrirDossierRed(s)).id;
  dirigeant = await inviterClient(ctx, s.a.associe, s.a.clientId, ["client_dirigeant"]);
}, 120_000);

afterAll(async () => {
  await ctx.fermer();
});

describe("référentiel (contenu de départ)", () => {
  it("trois check-lists de départ provisoires, à valider par un expert ; parité moteur, schémas partagés", async () => {
    const r = await s.a.chef.get("/api/redressement/checklists/referentiel");
    expect(r.statusCode).toBe(200);
    expect(r.headers["cache-control"]).toContain("private");
    const ref = r.json();
    expect(ref.mention_a_valider).toBe(RED_CHECKLIST_MENTION_A_VALIDER);
    expect(ref.departs.map((d: Json) => d.secteur)).toEqual(["industrie", "services", "commerce"]);
    for (const d of ref.departs) {
      expect(d.a_valider_par_un_expert).toBe(true);
      expect(d.items.length).toBeGreaterThanOrEqual(8);
      expect(d.items.length).toBeLessThanOrEqual(10);
    }
    expect(ref.departs.map((d: Json) => d.code)).toEqual(CHECKLISTS_DEPART.map((c) => c.code));
    expect(ref.reponses).toEqual([...RED_CHECKLIST_REPONSES]);
    expect(ref.secteurs).toEqual([...RED_SECTEURS]);
    // Parité : les constantes dupliquées du moteur et du paquet partagé.
    expect([...REPONSES_CHECKLIST]).toEqual([...RED_CHECKLIST_REPONSES]);
    expect([...SECTEURS_CHECKLIST]).toEqual([...RED_SECTEURS]);
    expect(ITEMS_CHECKLIST_MAX).toBe(RED_CHECKLIST_ITEMS_MAX);
    expect(ITEM_ID_MAX).toBe(RED_CHECKLIST_ITEM_ID_MAX);
    expect(ITEM_LIBELLE_MAX).toBe(RED_CHECKLIST_LIBELLE_MAX);
    expect(ITEM_AIDE_MAX).toBe(RED_CHECKLIST_AIDE_MAX);
    expect(ref.plafonds).toMatchObject({ modeles_par_cabinet: 100, versions_par_modele: 30 });
  });
});

describe("accès : 401, 403, 404, portail fermé", () => {
  it("401 sans session, 403 pour gestionnaire / ressources / expert externe, 403 PORTAIL_ROUTE_INTERDITE", async () => {
    const c = await activerDepart(
      s.a.chef,
      "depart_services",
      (await nouveauDossier(s, "Accès 1")).dossierId,
    );
    const m = await modelePublie(s.expert, s.expert2, { code: "acces-modele" });
    const brouillon = (
      await s.expert.post(`${MODELES}/${m.id}/versions`, { items: itemsDe(2) })
    ).json();
    const defs: { methode: "GET" | "POST"; url: string; corps?: unknown }[] = [
      { methode: "GET", url: "/api/redressement/checklists/referentiel" },
      { methode: "GET", url: MODELES },
      { methode: "POST", url: MODELES, corps: corpsModele({ code: "autre-code" }) },
      { methode: "POST", url: `${MODELES}/${m.id}/versions`, corps: { items: itemsDe(1) } },
      { methode: "POST", url: urlV(brouillon.id, "/publication"), corps: {} },
      { methode: "GET", url: urlD() },
      { methode: "POST", url: urlD(), corps: { origine: "depart", code: "depart_commerce" } },
      { methode: "GET", url: urlC(c.id) },
      {
        methode: "POST",
        url: urlC(c.id, "/reponses"),
        corps: { reponses: [reponse("srv_tre_01")] },
      },
      { methode: "POST", url: urlC(c.id, "/archivage"), corps: {} },
    ];
    const appeler = (par: Api, d: (typeof defs)[number]) =>
      d.methode === "GET" ? par.get(d.url) : par.post(d.url, d.corps ?? {});
    for (const d of defs) {
      expect((await appeler(api(ctx), d)).statusCode, `401 ${d.url}`).toBe(401);
      for (const u of [s.gestionnaire, s.ressources, s.expertExterne]) {
        expect((await appeler(u, d)).statusCode, `403 ${d.url}`).toBe(403);
      }
      const rep = await appeler(dirigeant, d);
      expect(rep.statusCode, `portail ${d.url}`).toBe(403);
      expect(erreur(rep), `portail ${d.url}`).toBe("PORTAIL_ROUTE_INTERDITE");
    }
  });

  it("droits d'écriture : l'expert métier ne renseigne pas un dossier ; le chef ne paramètre pas les modèles", async () => {
    const dos = (await nouveauDossier(s, "Accès 2")).dossierId;
    const c = await activerDepart(s.a.chef, "depart_commerce", dos);
    expect(
      (await s.expert.post(urlD("", dos), { origine: "depart", code: "depart_industrie" }))
        .statusCode,
    ).toBe(403);
    expect(
      (await s.expert.post(urlC(c.id, "/reponses"), { reponses: [reponse("com_tre_01")] }))
        .statusCode,
    ).toBe(403);
    expect((await s.expert.post(urlC(c.id, "/archivage"), {})).statusCode).toBe(403);
    for (const u of [s.a.chef, s.consultantEquipe, s.a.directeur]) {
      expect((await u.post(MODELES, corpsModele({ code: "chef-modele" }))).statusCode).toBe(403);
    }
    // Lecture des modèles ouverte aux détenteurs de `redressement.lire`.
    for (const u of [s.a.chef, s.consultantEquipe, s.a.directeur, s.expert, s.a.associe]) {
      expect((await u.get(MODELES)).statusCode).toBe(200);
    }
  });

  it("consultant hors équipe : 404 ; autre cabinet : 404 ; identifiant inconnu : 404 ; corps invalide : 400", async () => {
    const dos = (await nouveauDossier(s, "Accès 3")).dossierId;
    const c = await activerDepart(s.a.chef, "depart_industrie", dos);
    const defs: ["GET" | "POST", string, unknown][] = [
      ["GET", urlD("", dos), undefined],
      ["POST", urlD("", dos), { origine: "depart", code: "depart_services" }],
      ["GET", urlC(c.id), undefined],
      ["POST", urlC(c.id, "/reponses"), { reponses: [reponse("ind_tre_01")] }],
      ["POST", urlC(c.id, "/archivage"), {}],
    ];
    for (const [m, url, corps] of defs) {
      const appeler = (par: Api) => (m === "GET" ? par.get(url) : par.post(url, corps));
      expect((await appeler(s.consultantHors)).statusCode, `hors équipe ${url}`).toBe(404);
      expect((await appeler(s.b.associe)).statusCode, `autre cabinet ${url}`).toBe(404);
    }
    expect((await s.a.associe.get(urlC(INCONNU))).statusCode).toBe(404);
    expect(
      (await s.a.chef.post(urlC(INCONNU, "/reponses"), { reponses: [reponse("x")] })).statusCode,
    ).toBe(404);
    expect((await s.a.chef.get(urlD("", INCONNU))).statusCode).toBe(404);
    expect((await s.a.chef.get(urlC("pas-un-uuid"))).statusCode).toBe(400);
    expect(
      (await s.expert.post(`${MODELES}/${INCONNU}/versions`, { items: itemsDe(1) })).statusCode,
    ).toBe(404);
    expect((await s.expert2.post(urlV(INCONNU, "/publication"), {})).statusCode).toBe(404);
  });
});

describe("modèles du cabinet et versions", () => {
  let modeleId: string;
  let v1: string;

  it("création : version 1 en brouillon ; validations (code, secteur, items, champs inconnus) ; code unique", async () => {
    const r = await s.expert.post(MODELES, corpsModele({ motif: "Premier jet" }));
    attendre(201, r, "modèle");
    modeleId = r.json().id;
    expect(r.json()).toMatchObject({
      code: "modele-test",
      intitule: "Modèle de test",
      secteur: "industrie",
      en_vigueur: null,
    });
    expect(r.json().cree_par.id).toBe(s.expert.utilisateurId);
    v1 = r.json().brouillon.id;
    expect(r.json().brouillon).toMatchObject({
      version: 1,
      statut: "brouillon",
      remplacee: false,
      nombre_items: 3,
      motif: "Premier jet",
      peut_publier: false,
      publiee_par: null,
    });
    expect(r.json().brouillon.items.map((i: Json) => i.id)).toEqual(["i1", "i2", "i3"]);
    expect(r.json().historique).toHaveLength(1);
    expect(r.json().historique[0].items).toBeUndefined();
    const invalides: Record<string, unknown>[] = [
      { code: "A" },
      { code: "x" },
      { secteur: "mines" },
      { intitule: " " },
      { items: [] },
      { items: itemsDe(41) },
      { items: [item("a"), item("a")] },
      { items: [item("a", "juridique")] },
      { items: [item("A")] },
      { items: [item("a", "social", { libelle: "x".repeat(301) })] },
      { items: [item("a", "social", { poids: 2 })] },
      { extra: 1 },
    ];
    for (const extra of invalides) {
      const rep = await s.expert.post(MODELES, corpsModele({ code: "autre-code", ...extra }));
      expect(rep.statusCode, JSON.stringify(extra).slice(0, 60)).toBe(400);
    }
    const dup = await s.expert2.post(MODELES, corpsModele());
    expect(dup.statusCode).toBe(409);
    expect(erreur(dup)).toBe("RED_CHECKLIST_CODE_EXISTE");
  });

  it("un seul brouillon à la fois ; la liste montre le brouillon, publiable par un autre expert seulement", async () => {
    const encore = await s.expert.post(`${MODELES}/${modeleId}/versions`, { items: itemsDe(2) });
    expect(encore.statusCode).toBe(409);
    expect(erreur(encore)).toBe("RED_CHECKLIST_BROUILLON_EN_COURS");
    const vue = (m: Json) => m.id === modeleId;
    const parAuteur = (await s.expert.get(MODELES)).json().modeles.find(vue);
    expect(parAuteur.brouillon.peut_publier).toBe(false);
    const parAutre = (await s.expert2.get(MODELES)).json().modeles.find(vue);
    expect(parAutre.brouillon.peut_publier).toBe(true);
    // Un consultant ne publie pas (confort d'affichage faux) ; filtre de secteur.
    expect(
      (await s.consultantEquipe.get(MODELES)).json().modeles.find(vue).brouillon.peut_publier,
    ).toBe(false);
    expect((await s.expert.get(`${MODELES}?secteur=services`)).json().modeles).toEqual([]);
    expect((await s.expert.get(`${MODELES}?secteur=mines`)).statusCode).toBe(400);
    expect((await s.expert.get(`${MODELES}?x=1`)).statusCode).toBe(400);
  });

  it("publication : l'auteur 403, un consultant 403, un autre expert 200 ; republier 409 ; corps strict", async () => {
    const auteur = await s.expert.post(urlV(v1, "/publication"), {});
    expect(auteur.statusCode).toBe(403);
    expect(erreur(auteur)).toBe("SEPARATION_DES_TACHES");
    for (const u of [s.consultantEquipe, s.a.chef, s.a.directeur]) {
      expect((await u.post(urlV(v1, "/publication"), {})).statusCode).toBe(403);
    }
    expect((await s.b.associe.post(urlV(v1, "/publication"), {})).statusCode).toBe(404);
    expect((await s.expert2.post(urlV(v1, "/publication"), { exces: 1 })).statusCode).toBe(400);
    const ok = await s.expert2.post(urlV(v1, "/publication"), {});
    attendre(200, ok, "publication");
    expect(ok.json()).toMatchObject({ statut: "publiee", version: 1, remplacee: false });
    expect(ok.json().publiee_par.id).toBe(s.expert2.utilisateurId);
    expect(ok.json().items).toHaveLength(3);
    const bis = await s.expert2.post(urlV(v1, "/publication"), {});
    expect(bis.statusCode).toBe(409);
    expect(erreur(bis)).toBe("RED_CHECKLIST_NON_BROUILLON");
    const m = (await s.expert.get(MODELES)).json().modeles.find((x: Json) => x.id === modeleId);
    expect(m.brouillon).toBeNull();
    expect(m.en_vigueur.id).toBe(v1);
    expect(m.en_vigueur.items).toHaveLength(3);
  });

  it("v2 : l'associé publie la version d'un expert ; v1 devient « remplacée » ; un associé publie la sienne (dispense)", async () => {
    const v2 = await s.expert.post(`${MODELES}/${modeleId}/versions`, {
      items: [...itemsDe(3), item("i4", "social", { aide: "Voir le classeur" })],
      motif: "Ajout d'un point",
    });
    attendre(201, v2, "v2");
    expect(v2.json()).toMatchObject({ version: 2, statut: "brouillon", nombre_items: 4 });
    expect((await s.a.associe.post(urlV(v2.json().id, "/publication"), {})).statusCode).toBe(200);
    const m = (await s.expert.get(MODELES)).json().modeles.find((x: Json) => x.id === modeleId);
    expect(m.en_vigueur).toMatchObject({ version: 2, remplacee: false });
    expect(m.en_vigueur.items[3].aide).toBe("Voir le classeur");
    expect(m.historique.map((x: Json) => [x.version, x.statut, x.remplacee])).toEqual([
      [2, "publiee", false],
      [1, "publiee", true],
    ]);
    // Un associé rédige puis publie sa propre version : dispensé de la séparation.
    const propre = await s.associe2.post(MODELES, corpsModele({ code: "modele-associe" }));
    attendre(201, propre, "modèle associé");
    attendre(
      200,
      await s.associe2.post(urlV(propre.json().brouillon.id, "/publication"), {}),
      "associé auteur",
    );
  });

  it("v3 : republier une ancienne version est refusé (409) ; une version publiée ne repasse pas en brouillon", async () => {
    const v3 = await s.expert2.post(`${MODELES}/${modeleId}/versions`, { items: itemsDe(2) });
    attendre(201, v3, "v3");
    expect(v3.json().version).toBe(3);
    const ancienne = await s.a.associe.post(urlV(v1, "/publication"), {});
    expect(ancienne.statusCode).toBe(409);
    expect(erreur(ancienne)).toBe("RED_CHECKLIST_NON_BROUILLON");
    attendre(200, await s.expert.post(urlV(v3.json().id, "/publication"), {}), "v3");
  });

  it("isolation : le cabinet B ne voit aucun modèle de A et ne peut ni les lire ni les publier", async () => {
    const b = (await s.b.associe.get(MODELES)).json();
    expect(b.modeles).toEqual([]);
    expect(
      (await s.b.associe.post(`${MODELES}/${modeleId}/versions`, { items: itemsDe(1) })).statusCode,
    ).toBe(404);
    // Même code de modèle dans un autre cabinet : accepté (unicité par cabinet).
    const memeCode = await s.b.associe.post(MODELES, corpsModele());
    expect(memeCode.statusCode).toBe(201);
  });

  it("base : contenu figé (MPZ04), publication par l'auteur ou un consultant refusée (MPZ07), ajout seul (MPZ01)", async () => {
    const cree = await s.expert.post(MODELES, corpsModele({ code: "modele-base" }));
    attendre(201, cree, "modèle base");
    const brouillon = cree.json().brouillon.id as string;
    const cab = s.a.cabinetId;
    const publier = (par: string) => (db: Db) =>
      db.query(
        "UPDATE red_checklist_versions SET statut = 'publiee', publiee_par = $2, publiee_le = now() WHERE id = $1",
        [brouillon, par],
      );
    expect(await codeSql(ctx, cab, publier(s.expert.utilisateurId))).toBe("MPZ07");
    expect(await codeSql(ctx, cab, publier(s.consultantEquipe.utilisateurId))).toBe("MPZ07");
    // Colonnes autres que la publication : refusées au rôle applicatif (privilège), figées pour le propriétaire.
    expect(
      await codeSql(ctx, cab, (db) =>
        db.query("UPDATE red_checklist_versions SET contenu = '{\"items\":[]}' WHERE id = $1", [
          brouillon,
        ]),
      ),
    ).toBe("42501");
    expect(
      await codeProprietaire((c) =>
        c.query(
          `UPDATE red_checklist_versions SET contenu = '{"items":[{"id":"z","domaine":"social","libelle":"x"}]}',
             statut = 'publiee', publiee_par = $2, publiee_le = now() WHERE id = $1`,
          [brouillon, s.expert2.utilisateurId],
        ),
      ),
    ).toBe("MPZ04");
    expect(
      await codeProprietaire((c) =>
        c.query("DELETE FROM red_checklist_versions WHERE id = $1", [brouillon]),
      ),
    ).toBe("MPZ01");
    expect(
      await codeProprietaire((c) =>
        c.query("UPDATE red_checklist_modeles SET intitule = 'x' WHERE id = $1", [modeleId]),
      ),
    ).toBe("MPZ01");
    expect(
      await codeSql(ctx, cab, (db) =>
        db.query("DELETE FROM red_checklist_modeles WHERE id = $1", [modeleId]),
      ),
    ).toBe("42501");
    // Publication légitime par un autre expert actif.
    expect(await codeSql(ctx, cab, publier(s.expert2.utilisateurId))).toBe("aucun");
    // Une version publiée ne repasse jamais en brouillon.
    expect(
      await codeProprietaire((c) =>
        c.query(
          "UPDATE red_checklist_versions SET statut = 'brouillon', publiee_par = NULL, publiee_le = NULL WHERE id = $1",
          [brouillon],
        ),
      ),
    ).toBe("MPZ06");
  });

  it("plafonds : 30 versions par modèle et 100 modèles par cabinet (MPZ10, RED_PLAFOND_ATTEINT)", async () => {
    const cree = await s.expert.post(MODELES, corpsModele({ code: "modele-plafond" }));
    attendre(201, cree, "modèle plafond");
    const id = cree.json().id as string;
    const cab = s.a.cabinetId;
    // Versions 1 à 30 : publiées une à une par un autre expert (accès direct, hors débit d'API).
    await ctx.db.withTenant(cab, async (db) => {
      const contenu = JSON.stringify({ items: itemsDe(2) });
      await db.query(
        "UPDATE red_checklist_versions SET statut = 'publiee', publiee_par = $2, publiee_le = now() WHERE id = $1",
        [cree.json().brouillon.id, s.expert2.utilisateurId],
      );
      for (let v = 2; v <= 30; v += 1) {
        const r = await db.query(
          `INSERT INTO red_checklist_versions (cabinet_id, modele_id, version, contenu, cree_par)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [cab, id, v, contenu, s.expert.utilisateurId],
        );
        await db.query(
          "UPDATE red_checklist_versions SET statut = 'publiee', publiee_par = $2, publiee_le = now() WHERE id = $1",
          [r.rows[0].id, s.expert2.utilisateurId],
        );
      }
    });
    const trop = await s.expert.post(`${MODELES}/${id}/versions`, { items: itemsDe(1) });
    expect(trop.statusCode).toBe(409);
    expect(erreur(trop)).toBe("RED_PLAFOND_ATTEINT");
    // 100 modèles dans le cabinet B (déjà un), puis le suivant est refusé.
    const b = s.b.cabinetId;
    await ctx.db.withTenant(b, (db) =>
      db.query(
        `INSERT INTO red_checklist_modeles (cabinet_id, code, intitule, secteur, cree_par)
         SELECT $1, 'plafond-' || g, 'Modèle ' || g, 'general', $2 FROM generate_series(1, 99) g`,
        [b, s.b.associeId],
      ),
    );
    const cent = await s.b.associe.post(MODELES, corpsModele({ code: "modele-101" }));
    expect(cent.statusCode).toBe(409);
    expect(erreur(cent)).toBe("RED_PLAFOND_ATTEINT");
  });
});

describe("activation, réponses et évaluation du moteur", () => {
  let industrie: Json;

  it("activation du contenu de départ : instantané, à valider par un expert, rien de renseigné", async () => {
    industrie = await activerDepart(s.a.chef, "depart_industrie");
    expect(industrie).toMatchObject({
      dossier_id: dossierId,
      origine: "depart",
      code_depart: "depart_industrie",
      modele_id: null,
      modele_version: null,
      statut: "active",
      a_valider_par_un_expert: true,
      secteur: "industrie",
      reponses: [],
      peut_repondre: true,
      archivee_le: null,
    });
    expect(industrie.items).toHaveLength(10);
    expect(industrie.cree_par.id).toBe(s.a.chef.utilisateurId);
    expect(industrie.evaluation.global).toMatchObject({
      total: 10,
      oui: 0,
      non_renseignes: 10,
      completude_pb: 0,
      conformite_pb: 0,
    });
    expect(industrie.evaluation.complete).toBe(false);
    expect(industrie.evaluation.domaines.map((d: Json) => d.domaine)).toEqual([
      "tresorerie",
      "activite",
      "exploitation",
      "social",
      "financement",
    ]);
    const doublon = await s.a.chef.post(urlD(), { origine: "depart", code: "depart_industrie" });
    expect(doublon.statusCode).toBe(409);
    expect(erreur(doublon)).toBe("RED_CHECKLIST_DEJA_ACTIVE");
  });

  it("entrées d'activation invalides : 400 ; départ inconnu : 404 ; modèle inconnu : 404 ; modèle non publié : 409", async () => {
    for (const corps of [
      {},
      { origine: "autre" },
      { origine: "depart" },
      { origine: "depart", code: "depart_industrie", x: 1 },
      { origine: "modele", modele_id: "pas-un-uuid" },
      { origine: "modele", code: "x" },
    ]) {
      expect((await s.a.chef.post(urlD(), corps)).statusCode, JSON.stringify(corps)).toBe(400);
    }
    expect((await s.a.chef.post(urlD(), { origine: "depart", code: "inconnu" })).statusCode).toBe(
      404,
    );
    expect(
      (await s.a.chef.post(urlD(), { origine: "modele", modele_id: INCONNU })).statusCode,
    ).toBe(404);
    const brouillon = await s.expert.post(MODELES, corpsModele({ code: "modele-non-publie" }));
    attendre(201, brouillon, "brouillon");
    const non = await s.a.chef.post(urlD(), { origine: "modele", modele_id: brouillon.json().id });
    expect(non.statusCode).toBe(409);
    expect(erreur(non)).toBe("RED_CHECKLIST_SANS_VERSION_PUBLIEE");
  });

  it("lot de réponses : taux exacts du moteur par domaine, items à traiter, réponses courantes", async () => {
    const r = await s.a.chef.post(urlC(industrie.id, "/reponses"), {
      reponses: [
        reponse("ind_tre_01", "oui"),
        reponse("ind_tre_02", "non", { commentaire: "Échéancier à reconstituer" }),
        reponse("ind_act_01", "partiel"),
        reponse("ind_act_02", "sans_objet"),
      ],
    });
    attendre(201, r, "réponses");
    const c = r.json();
    const dom = (nom: string) => c.evaluation.domaines.find((d: Json) => d.domaine === nom);
    // Trésorerie : 1 oui, 1 non sur 2 -> conformité (2×1) / (2×2) = 5000 pb ; complétude 10 000 pb.
    expect(dom("tresorerie")).toMatchObject({
      total: 2,
      oui: 1,
      non: 1,
      applicables: 2,
      completude_pb: 10_000,
      conformite_pb: 5000,
    });
    // Activité : 1 partiel, 1 sans objet -> un seul item applicable : (0 + 1) / (2×1) = 5000 pb.
    expect(dom("activite")).toMatchObject({
      total: 2,
      partiel: 1,
      sans_objet: 1,
      applicables: 1,
      completude_pb: 10_000,
      conformite_pb: 5000,
    });
    // Exploitation (3 items) : rien de renseigné, jamais conforme.
    expect(dom("exploitation")).toMatchObject({
      total: 3,
      non_renseignes: 3,
      completude_pb: 0,
      conformite_pb: 0,
    });
    // Global : 4 renseignés sur 10 = 4000 pb ; (2×1 + 1) / (2×9) = 1667 pb.
    expect(c.evaluation.global).toMatchObject({
      total: 10,
      applicables: 9,
      completude_pb: 4000,
      conformite_pb: 1667,
    });
    expect(c.evaluation.non_conformes).toEqual(["ind_tre_02"]);
    expect(c.evaluation.partiels).toEqual(["ind_act_01"]);
    expect(c.evaluation.non_renseignes).toHaveLength(6);
    expect(c.evaluation.complete).toBe(false);
    expect(c.reponses.map((x: Json) => [x.item_id, x.reponse])).toEqual([
      ["ind_tre_01", "oui"],
      ["ind_tre_02", "non"],
      ["ind_act_01", "partiel"],
      ["ind_act_02", "sans_objet"],
    ]);
    expect(c.reponses[1]).toMatchObject({ commentaire: "Échéancier à reconstituer" });
    expect(c.reponses[0].auteur.id).toBe(s.a.chef.utilisateurId);
    // Lecture par un autre membre autorisé : même évaluation.
    const lu = await s.consultantEquipe.get(urlC(industrie.id));
    expect(lu.statusCode).toBe(200);
    expect(lu.json().evaluation).toEqual(c.evaluation);
    expect(lu.json().peut_repondre).toBe(true);
    expect((await s.a.directeur.get(urlC(industrie.id))).statusCode).toBe(200);
  });

  it("ajout seul : corriger une réponse ajoute une ligne, la dernière est la courante ; une réponse identique n'ajoute rien", async () => {
    const compte = async () =>
      proprietaire(async (c) =>
        Number(
          (
            await c.query(
              "SELECT count(*)::int AS n FROM red_checklist_reponses WHERE checklist_id = $1",
              [industrie.id],
            )
          ).rows[0].n,
        ),
      );
    expect(await compte()).toBe(4);
    const corrige = await s.consultantEquipe.post(urlC(industrie.id, "/reponses"), {
      reponses: [reponse("ind_tre_02", "oui")],
    });
    attendre(201, corrige, "correction");
    expect(await compte()).toBe(5);
    const c = corrige.json();
    expect(c.reponses.find((x: Json) => x.item_id === "ind_tre_02")).toMatchObject({
      reponse: "oui",
      commentaire: null,
    });
    expect(c.reponses.find((x: Json) => x.item_id === "ind_tre_02").auteur.id).toBe(
      s.consultantEquipe.utilisateurId,
    );
    expect(c.evaluation.non_conformes).toEqual([]);
    expect(c.evaluation.domaines[0]).toMatchObject({ oui: 2, conformite_pb: 10_000 });
    // Même réponse, même commentaire : rien n'est ajouté.
    attendre(
      201,
      await s.consultantEquipe.post(urlC(industrie.id, "/reponses"), {
        reponses: [reponse("ind_tre_02", "oui")],
      }),
      "identique",
    );
    expect(await compte()).toBe(5);
    // Tout renseigner : complète.
    const tout = await s.a.chef.post(urlC(industrie.id, "/reponses"), {
      reponses: industrie.items.map((i: Json) => reponse(i.id, "oui")),
    });
    attendre(201, tout, "tout renseigner");
    expect(tout.json().evaluation).toMatchObject({ complete: true, non_renseignes: [] });
    expect(tout.json().evaluation.global).toMatchObject({
      completude_pb: 10_000,
      conformite_pb: 10_000,
    });
    // Base : une réponse ne se modifie ni ne se supprime (propriétaire : MPZ01 ; rôle applicatif : privilège).
    expect(
      await codeProprietaire((c2) =>
        c2.query("UPDATE red_checklist_reponses SET reponse = 'non' WHERE checklist_id = $1", [
          industrie.id,
        ]),
      ),
    ).toBe("MPZ01");
    expect(
      await codeProprietaire((c2) =>
        c2.query("DELETE FROM red_checklist_reponses WHERE checklist_id = $1", [industrie.id]),
      ),
    ).toBe("MPZ01");
    expect(
      await codeSql(ctx, s.a.cabinetId, (db) =>
        db.query("UPDATE red_checklist_reponses SET reponse = 'non'"),
      ),
    ).toBe("42501");
  });

  it("entrées de réponses invalides : 400 ; item inconnu : RED_QUESTION_INCONNUE", async () => {
    const url = urlC(industrie.id, "/reponses");
    for (const corps of [
      {},
      { reponses: [] },
      { reponses: [reponse("ind_tre_01", "peut-etre")] },
      { reponses: [reponse("ind_tre_01"), reponse("ind_tre_01", "non")] },
      { reponses: [reponse("ind_tre_01", "oui", { commentaire: "x".repeat(501) })] },
      { reponses: [reponse("ind_tre_01", "oui", { poids: 2 })] },
      { reponses: [reponse("")] },
      { reponses: Array.from({ length: 41 }, (_, i) => reponse(`i${i}`)) },
      { reponses: [reponse("ind_tre_01")], extra: 1 },
    ]) {
      expect((await s.a.chef.post(url, corps)).statusCode, JSON.stringify(corps).slice(0, 60)).toBe(
        400,
      );
    }
    const inconnu = await s.a.chef.post(url, { reponses: [reponse("zzz")] });
    expect(inconnu.statusCode).toBe(400);
    expect(erreur(inconnu)).toBe("RED_QUESTION_INCONNUE");
    expect(inconnu.json().erreur.details.manquants).toEqual(["zzz"]);
  });

  it("base : item hors check-list refusé (MPZ02)", async () => {
    expect(
      await codeSql(ctx, s.a.cabinetId, (db) =>
        db.query(
          `INSERT INTO red_checklist_reponses (cabinet_id, checklist_id, dossier_id, item_id, reponse, auteur)
           VALUES ($1, $2, $3, 'inexistant', 'oui', $4)`,
          [s.a.cabinetId, industrie.id, dossierId, s.a.chef.utilisateurId],
        ),
      ),
    ).toBe("MPZ02");
  });

  it("modèle du cabinet : instantané figé de la version publiée ; nouvelle version sans effet sur l'existant", async () => {
    const m = await modelePublie(s.expert, s.expert2, { code: "modele-activable" });
    const c = await s.a.chef.post(urlD(), { origine: "modele", modele_id: m.id });
    attendre(201, c, "activation du modèle");
    expect(c.json()).toMatchObject({
      origine: "modele",
      code_depart: null,
      modele_id: m.id,
      modele_version: 1,
      a_valider_par_un_expert: false,
      intitule: "Modèle de test",
    });
    expect(c.json().items.map((i: Json) => i.id)).toEqual(["i1", "i2", "i3"]);
    const deux = await s.a.chef.post(urlD(), { origine: "modele", modele_id: m.id });
    expect(deux.statusCode).toBe(409);
    expect(erreur(deux)).toBe("RED_CHECKLIST_DEJA_ACTIVE");
    // Une version 2 publiée ne change pas l'instantané déjà activé.
    const v2 = await s.expert.post(`${MODELES}/${m.id}/versions`, { items: itemsDe(5) });
    attendre(201, v2, "v2");
    attendre(200, await s.expert2.post(urlV(v2.json().id, "/publication"), {}), "publication v2");
    const relu = (await s.a.chef.get(urlC(c.json().id))).json();
    expect(relu.items).toHaveLength(3);
    expect(relu.modele_version).toBe(1);
    // Un autre dossier reçoit la version 2.
    const autre = await nouveauDossier(s, "Autre dossier modèle");
    const c2 = await s.a.chef.post(urlD("", autre.dossierId), {
      origine: "modele",
      modele_id: m.id,
    });
    attendre(201, c2, "activation v2");
    expect(c2.json()).toMatchObject({ modele_version: 2 });
    expect(c2.json().items).toHaveLength(5);
    // Base : l'instantané égale la version publiée (MPZ02) ; un contenu différent est refusé.
    const version = (await s.expert.get(MODELES)).json().modeles.find((x: Json) => x.id === m.id)
      .en_vigueur.id;
    const inserer = (contenu: string) => (db: Db) =>
      db.query(
        `INSERT INTO red_checklists (cabinet_id, dossier_id, intitule, secteur, origine, modele_id,
           modele_version_id, contenu, a_valider_par_un_expert, cree_par)
         VALUES ($1, $2, 'x', 'general', 'modele', $3, $4, $5, false, $6)`,
        [s.a.cabinetId, autre.dossierId, m.id, version, contenu, s.a.chef.utilisateurId],
      );
    expect(
      await codeSql(
        ctx,
        s.a.cabinetId,
        inserer('{"items":[{"id":"zz","domaine":"social","libelle":"x"}]}'),
      ),
    ).toBe("MPZ02");
  });

  it("journal : identifiants, comptes et codes seulement (ni libellé, ni commentaire, ni motif)", async () => {
    const secret = "SECRET-COMMENTAIRE-CHECKLIST";
    const c = await activerDepart(s.a.chef, "depart_commerce");
    attendre(
      201,
      await s.a.chef.post(urlC(c.id, "/reponses"), {
        reponses: [reponse("com_tre_01", "non", { commentaire: secret })],
      }),
      "commentaire",
    );
    attendre(
      200,
      await s.a.chef.post(urlC(c.id, "/archivage"), { motif: `${secret}-motif` }),
      "archivage",
    );
    const brouillon = await s.expert.post(
      MODELES,
      corpsModele({ code: "modele-journal", intitule: `${secret}-intitule`, motif: `${secret}-m` }),
    );
    attendre(201, brouillon, "modèle journal");
    const j = await proprietaire((cl) =>
      cl.query(
        "SELECT entite, action, details::text AS d FROM journal_audit WHERE entite LIKE 'red_checklist%'",
      ),
    );
    expect(j.rows.length).toBeGreaterThan(5);
    const actions = new Set(j.rows.map((l: Json) => `${l.entite}/${l.action}`));
    for (const attendu of [
      "red_checklist/activation",
      "red_checklist/reponses",
      "red_checklist/archivage",
      "red_checklist_modele/creation",
      "red_checklist_version/publication",
    ]) {
      expect(actions.has(attendu), attendu).toBe(true);
    }
    for (const l of j.rows as Json[]) {
      expect(l.d).not.toContain("SECRET");
      expect(l.d).not.toContain("Point de contrôle");
      expect(l.d).not.toContain("prévisionnel");
    }
  });
});

describe("archivage et figement", () => {
  let c: Json;
  let dossier: string;

  it("archivage : la check-list est figée (409), listes par statut, réactivation possible", async () => {
    dossier = (await nouveauDossier(s, "Archivage")).dossierId;
    c = await activerDepart(s.a.chef, "depart_services", dossier);
    attendre(
      201,
      await s.a.chef.post(urlC(c.id, "/reponses"), { reponses: [reponse("srv_tre_01")] }),
      "réponse avant archivage",
    );
    expect((await s.a.chef.post(urlC(c.id, "/archivage"), { exces: 1 })).statusCode).toBe(400);
    const a = await s.a.chef.post(urlC(c.id, "/archivage"), { motif: "Activée par erreur" });
    attendre(200, a, "archivage");
    expect(a.json()).toMatchObject({
      statut: "archivee",
      motif_archivage: "Activée par erreur",
      peut_repondre: false,
    });
    expect(a.json().archivee_le).not.toBeNull();
    const figee = await s.a.chef.post(urlC(c.id, "/reponses"), {
      reponses: [reponse("srv_tre_01", "non")],
    });
    expect(figee.statusCode).toBe(409);
    expect(erreur(figee)).toBe("RED_CHECKLIST_FIGEE");
    const bis = await s.a.chef.post(urlC(c.id, "/archivage"), {});
    expect(bis.statusCode).toBe(409);
    expect(erreur(bis)).toBe("RED_CHECKLIST_FIGEE");
    expect((await s.a.chef.get(urlD("", dossier))).json().checklists).toEqual([]);
    const toutes = (await s.a.chef.get(urlD("?statut=toutes", dossier))).json().checklists;
    expect(toutes).toHaveLength(1);
    expect(toutes[0]).toMatchObject({ id: c.id, statut: "archivee", nombre_items: 9 });
    expect((await s.a.chef.get(urlD("?statut=archivee", dossier))).json().checklists).toHaveLength(
      1,
    );
    expect((await s.a.chef.get(urlD("?statut=autre", dossier))).statusCode).toBe(400);
    // La lecture reste possible ; la réactivation crée une nouvelle check-list vierge.
    expect((await s.a.chef.get(urlC(c.id))).json().reponses).toHaveLength(1);
    const neuve = await activerDepart(s.a.chef, "depart_services", dossier);
    expect(neuve.id).not.toBe(c.id);
    expect(neuve.reponses).toEqual([]);
  });

  it("liste : taux du moteur par check-list active", async () => {
    const liste = (await s.a.chef.get(urlD("", dossier))).json().checklists;
    expect(liste).toHaveLength(1);
    expect(liste[0]).toMatchObject({
      origine: "depart",
      statut: "active",
      a_valider_par_un_expert: true,
      nombre_items: 9,
      completude_pb: 0,
      conformite_pb: 0,
    });
    expect(liste[0].cree_par.id).toBe(s.a.chef.utilisateurId);
  });

  it("base : une check-list archivée est figée (MPZ12) pour les réponses et les modifications", async () => {
    const cab = s.a.cabinetId;
    expect(
      await codeSql(ctx, cab, (db) =>
        db.query(
          `INSERT INTO red_checklist_reponses (cabinet_id, checklist_id, dossier_id, item_id, reponse, auteur)
           VALUES ($1, $2, $3, 'srv_tre_01', 'non', $4)`,
          [cab, c.id, dossier, s.a.chef.utilisateurId],
        ),
      ),
    ).toBe("MPZ12");
    expect(
      await codeSql(ctx, cab, (db) =>
        db.query(
          "UPDATE red_checklists SET statut = 'archivee', motif_archivage = 'x' WHERE id = $1",
          [c.id],
        ),
      ),
    ).toBe("MPZ12");
    expect(
      await codeProprietaire((cl) =>
        cl.query(
          "UPDATE red_checklists SET statut = 'active', motif_archivage = NULL, archivee_par = NULL, archivee_le = NULL WHERE id = $1",
          [c.id],
        ),
      ),
    ).toBe("MPZ12");
    // Une check-list active : contenu figé (MPZ04) pour le propriétaire, suppression refusée.
    const active = await activerDepart(s.a.chef, "depart_commerce", dossier);
    expect(
      await codeProprietaire((cl) =>
        cl.query(
          `UPDATE red_checklists SET contenu = '{"items":[{"id":"z","domaine":"social","libelle":"x"}]}',
             statut = 'archivee', archivee_par = $2, archivee_le = now() WHERE id = $1`,
          [active.id, s.a.chef.utilisateurId],
        ),
      ),
    ).toBe("MPZ04");
    expect(
      await codeProprietaire((cl) =>
        cl.query("DELETE FROM red_checklists WHERE id = $1", [active.id]),
      ),
    ).toBe("MPZ01");
  });
});

describe("dossier clos et mission clôturée", () => {
  it("dossier clos : plus d'écriture (409), lecture admise", async () => {
    const { dossierId: dos } = await nouveauDossier(s, "Dossier clos");
    const c = await activerDepart(s.a.chef, "depart_industrie", dos);
    attendre(
      200,
      await s.a.directeur.post(`/api/redressement/dossiers/${dos}/statut`, {
        statut: "clos",
        motif: "Fin de mission",
      }),
      "clos",
    );
    const rep = await s.a.chef.post(urlC(c.id, "/reponses"), { reponses: [reponse("ind_tre_01")] });
    expect(rep.statusCode).toBe(409);
    expect(erreur(rep)).toBe("RED_DOSSIER_CLOS");
    expect((await s.a.chef.post(urlC(c.id, "/archivage"), {})).statusCode).toBe(409);
    const act = await s.a.chef.post(urlD("", dos), { origine: "depart", code: "depart_services" });
    expect(act.statusCode).toBe(409);
    expect(erreur(act)).toBe("RED_DOSSIER_CLOS");
    const lu = await s.a.chef.get(urlC(c.id));
    expect(lu.statusCode).toBe(200);
    expect(lu.json().peut_repondre).toBe(false);
    expect((await s.a.chef.get(urlD("", dos))).statusCode).toBe(200);
    // Base : plus de réponse directe (MPZ03).
    expect(
      await codeSql(ctx, s.a.cabinetId, (db) =>
        db.query(
          `INSERT INTO red_checklist_reponses (cabinet_id, checklist_id, dossier_id, item_id, reponse, auteur)
           VALUES ($1, $2, $3, 'ind_tre_01', 'oui', $4)`,
          [s.a.cabinetId, c.id, dos, s.a.chef.utilisateurId],
        ),
      ),
    ).toBe("MPZ03");
  });

  it("mission clôturée : 409 RED_MISSION_CLOTUREE, lecture admise", async () => {
    const m = await creerMissionSignee(s.a, { intitule: "Mission à clôturer" });
    const dos = (await ouvrirDossierRed(s, m.id)).id;
    const c = await activerDepart(s.a.chef, "depart_commerce", dos);
    await proprietaire((cl) =>
      cl.query("UPDATE missions SET statut = 'cloturee', cloturee_le = now() WHERE id = $1", [
        m.id,
      ]),
    );
    const rep = await s.a.chef.post(urlC(c.id, "/reponses"), { reponses: [reponse("com_tre_01")] });
    expect(rep.statusCode).toBe(409);
    expect(erreur(rep)).toBe("RED_MISSION_CLOTUREE");
    expect(
      (await s.a.chef.post(urlD("", dos), { origine: "depart", code: "depart_industrie" }))
        .statusCode,
    ).toBe(409);
    expect((await s.a.chef.get(urlC(c.id))).statusCode).toBe(200);
  });
});

describe("plafonds de volume et de débit", () => {
  it("30 check-lists par dossier (MPZ10, RED_PLAFOND_ATTEINT)", async () => {
    const { dossierId: dos } = await nouveauDossier(s, "Plafond check-lists");
    await ctx.db.withTenant(s.a.cabinetId, (db) =>
      db.query(
        `INSERT INTO red_checklists (cabinet_id, dossier_id, intitule, secteur, origine, code_depart,
           contenu, a_valider_par_un_expert, cree_par)
         SELECT $1, $2, 'Départ ' || g, 'general', 'depart', 'fictif-' || g,
           '{"items":[{"id":"a","domaine":"social","libelle":"x"}]}'::jsonb, true, $3
         FROM generate_series(1, 30) g`,
        [s.a.cabinetId, dos, s.a.chef.utilisateurId],
      ),
    );
    const trop = await s.a.chef.post(urlD("", dos), {
      origine: "depart",
      code: "depart_industrie",
    });
    expect(trop.statusCode).toBe(409);
    expect(erreur(trop)).toBe("RED_PLAFOND_ATTEINT");
    expect((await s.a.chef.get(urlD("", dos))).json().checklists).toHaveLength(30);
  });

  it("2 000 réponses par check-list (MPZ10, RED_PLAFOND_ATTEINT)", async () => {
    const { dossierId: dos } = await nouveauDossier(s, "Plafond réponses");
    const c = await activerDepart(s.a.chef, "depart_industrie", dos);
    await ctx.db.withTenant(s.a.cabinetId, (db) =>
      db.query(
        `INSERT INTO red_checklist_reponses (cabinet_id, checklist_id, dossier_id, item_id, reponse, auteur)
         SELECT $1, $2, $3, 'ind_tre_01', 'oui', $4 FROM generate_series(1, 2000)`,
        [s.a.cabinetId, c.id, dos, s.a.chef.utilisateurId],
      ),
    );
    const trop = await s.a.chef.post(urlC(c.id, "/reponses"), {
      reponses: [reponse("ind_tre_01", "non")],
    });
    expect(trop.statusCode).toBe(409);
    expect(erreur(trop)).toBe("RED_PLAFOND_ATTEINT");
    // La dernière réponse (rang le plus élevé) reste la courante.
    expect((await s.a.chef.get(urlC(c.id))).json().reponses[0]).toMatchObject({ reponse: "oui" });
  });

  it("débit : 60 lots de réponses par utilisateur et par 10 minutes (429)", async () => {
    const { dossierId: dos, missionId } = await nouveauDossier(s, "Débit réponses");
    const neuf = await s.a.avecRoles(["consultant"]);
    const cible = await activerDepart(s.a.chef, "depart_industrie", dos);
    // Le consultant d'équipe répond : il rejoint l'équipe de cette mission.
    attendre(
      201,
      await s.a.chef.post(`/api/missions/${missionId}/equipe`, {
        utilisateur_id: neuf.utilisateurId,
      }),
      "équipe",
    );
    for (let i = 0; i < 60; i += 1) {
      const r = await neuf.post(urlC(cible.id, "/reponses"), {
        reponses: [reponse("ind_tre_01")],
      });
      if (r.statusCode !== 201) throw new Error(`lot ${i} : ${r.statusCode} ${r.body}`);
    }
    const trop = await neuf.post(urlC(cible.id, "/reponses"), {
      reponses: [reponse("ind_tre_01")],
    });
    expect(trop.statusCode).toBe(429);
    expect(erreur(trop)).toBe("RED_TROP_DE_REPONSES_CHECKLIST");
  }, 90_000);

  it("débit : 10 modèles par utilisateur et par 10 minutes (429)", async () => {
    // L'expert a déjà créé plusieurs modèles ci-dessus ; un associé neuf part de zéro.
    const neuf = await s.a.avecRoles(["associe"]);
    for (let i = 0; i < 10; i += 1) {
      attendre(201, await neuf.post(MODELES, corpsModele({ code: `debit-${i}` })), `modèle ${i}`);
    }
    const trop = await neuf.post(MODELES, corpsModele({ code: "debit-10" }));
    expect(trop.statusCode).toBe(429);
    expect(erreur(trop)).toBe("RED_TROP_DE_MODELES_CHECKLIST");
  });
});
