import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CONTROLES_CLOTURE,
  projeterTresorerie,
  SENS_RATIO_CLOTURE,
  type LigneTresorerie,
} from "@missionpilot/engines";
import {
  RED_CLES_RATIO,
  RED_CONTROLES_CLOTURE,
  redClotureContenuSchema,
} from "@missionpilot/shared";
import { resumeCloture } from "../src/redressement/cloture.js";
import { api } from "./api.js";
import { proprietaire } from "./helpers.js";
import { inviterClient, attendre } from "./portail-outils.js";
import { dezipper, toutLeXml } from "./rapports-outils.js";
import {
  auditDe,
  construireBilan,
  dans,
  dossierComplet,
  nouveauDossierCas,
  preparerCloture,
  refusSql,
  urlC,
  urlCloturesD,
  urlD,
  type Json,
  type ScenarioCloture,
} from "./redressement-cloture-outils.js";
import { codeSql, DEBUT, LIGNES_TRESO, M } from "./redressement-financement-outils.js";
import { erreur, INCONNU, RATIOS_CAS_A } from "./redressement-outils.js";

/*
 * Bilan de clôture du redressement et rapport de clôture (RED-08, lot 2). Dossier du cas A
 * entièrement renseigné par l'API : le contenu du bilan est comparé aux sorties des moteurs lues par
 * les autres routes ; bilan incomplet non validable (MPZ18) ; validation réservée au directeur de la
 * mission, séparation des tâches, état périmé, dernière version ; contenu figé après validation
 * (MPZ17) ; rapport de clôture d'un bilan VALIDÉ seulement (409, MPR05 en base), fichier lisible
 * avec `redressement.lire` et rien de plus, causes non validées exclues ; mission clôturée ;
 * isolation entre cabinets, portail fermé, journal sans donnée sensible.
 */

let sc: ScenarioCloture;
let incomplet: { dossierId: string; missionId: string };
let associeDirecteur: { dossierId: string; missionId: string };
let aCloturer: { dossierId: string; missionId: string };
let vide: { dossierId: string; missionId: string };

const s = () => sc.s;
const d1 = () => sc.dossierId;
const dateJour = () => dans(0);
const signe = (n: number) => (n < 0 ? "degradation" : n > 0 ? "amelioration" : "stable");

beforeAll(async () => {
  sc = await preparerCloture();
  vide = await nouveauDossierCas(s(), "Dossier sans bilan");
  incomplet = await nouveauDossierCas(s(), "Dossier incomplet");
  attendre(
    201,
    await s().a.chef.post(urlD(incomplet.dossierId, "/urgences"), {
      reponses: { T1: "oui", T2: "oui", T3: "oui" },
    }),
    "urgence",
  );
  associeDirecteur = await dossierComplet(s(), "Associé directeur", {
    mission: { directeur_id: s().associe2.utilisateurId },
    directeur: s().associe2,
  });
  aCloturer = await dossierComplet(s(), "À clôturer", { signee: true });
}, 600_000);

afterAll(async () => {
  await sc.fermer();
});

describe("parité moteur et schémas partagés", () => {
  it("contrôles de complétude et sens des ratios identiques", () => {
    expect(RED_CONTROLES_CLOTURE).toEqual(CONTROLES_CLOTURE);
    expect(Object.keys(SENS_RATIO_CLOTURE)).toEqual([...RED_CLES_RATIO]);
  });
});

describe("construction d'un bilan : valeurs égales à celles des moteurs", () => {
  let bilan1: Json;

  it("avant tout bilan : résumé « absent »", async () => {
    const r = await sc.ctx.db.withTenant(s().a.cabinetId, (db) =>
      resumeCloture(db, vide.dossierId),
    );
    expect(r).toEqual({ statut: "absent", version: null, valide_le: null });
    const liste = await s().a.chef.get(urlCloturesD(vide.dossierId));
    expect(liste.statusCode).toBe(200);
    expect(liste.json().elements).toEqual([]);
  });

  it("brouillon v1 : ratios, alerte, urgence et trésorerie égaux aux services de lecture", async () => {
    bilan1 = await construireBilan(s().a.chef, d1());
    expect(bilan1).toMatchObject({
      version: 1,
      statut: "brouillon",
      complet: true,
      dossier_id: d1(),
      date_reference: dateJour(),
      valide_par: null,
      valide_le: null,
      motif: null,
      peut_valider: false,
    });
    expect(bilan1.cree_par.id).toBe(s().a.chef.utilisateurId);
    expect(bilan1.empreinte).toMatch(/^[0-9a-f]{64}$/);
    const c = bilan1.contenu;
    expect(redClotureContenuSchema.safeParse(c).success).toBe(true);
    expect(c).toMatchObject({
      version: 1,
      devise: "XOF",
      exercice_ouverture: 2024,
      exercice_fin: 2025,
    });

    // Ratios : le dernier exercice accepté (fin) et l'avant-dernier (ouverture).
    const ratios = (await s().a.chef.get(urlD(d1(), "/ratios"))).json();
    expect(ratios.exercices.map((e: Json) => e.exercice)).toEqual([2025, 2024]);
    expect(c.ratios.map((l: Json) => l.cle)).toEqual([...RED_CLES_RATIO]);
    for (const l of c.ratios) {
      expect(l.fin).toBe(ratios.exercices[0].ratios[l.cle].valeur);
      expect(l.ouverture).toBe(ratios.exercices[1].ratios[l.cle].valeur);
      expect(l.unite).toBe(l.cle === "bfr_jours" ? "jours" : "pb");
      if (l.fin !== null && l.ouverture !== null) {
        expect(l.variation).toBe(l.fin - l.ouverture);
      } else {
        expect(l.variation).toBeNull();
        expect(l.evolution).toBe("non_comparable");
      }
    }
    for (const [cle, valeur] of Object.entries(RATIOS_CAS_A)) {
      expect(c.ratios.find((l: Json) => l.cle === cle).fin).toBe(valeur);
    }
    expect(c.ratios.find((l: Json) => l.cle === "marge_brute")).toEqual({
      cle: "marge_brute",
      unite: "pb",
      ouverture: 3800,
      fin: 3500,
      variation: -300,
      evolution: "degradation",
    });

    // Scores d'alerte : premier (incidents) et dernier (sans incident).
    const scores = (await s().a.chef.get(urlD(d1(), "/scores"))).json().elements;
    expect(scores).toHaveLength(2);
    const [dernier, premier] = scores;
    expect(c.alerte.fin).toEqual({
      score: dernier.score,
      niveau: dernier.niveau,
      date_reference: dernier.date_reference,
    });
    expect(c.alerte.ouverture).toEqual({
      score: premier.score,
      niveau: premier.niveau,
      date_reference: premier.date_reference,
    });
    expect(c.alerte.variation_points).toBe(dernier.score - premier.score);
    expect(c.alerte.evolution).toBe(signe(premier.score - dernier.score));

    // Urgence : première (tous domaines au plus mal) et dernière évaluation.
    const urgences = (await s().a.chef.get(urlD(d1(), "/urgences"))).json().elements;
    expect(urgences).toHaveLength(2);
    expect(c.urgence.fin).toEqual({
      voyant: urgences[0].voyant,
      domaines_rouges: urgences[0].resultat.domaines_rouges.length,
    });
    expect(c.urgence.ouverture).toEqual({
      voyant: urgences[1].voyant,
      domaines_rouges: urgences[1].resultat.domaines_rouges.length,
    });
    expect(c.urgence.variation_domaines_rouges).toBe(
      c.urgence.fin.domaines_rouges - c.urgence.ouverture.domaines_rouges,
    );

    // Trésorerie : prévision initiale (version 1 sans réalisé) et projection courante.
    const initiale = projeterTresorerie({
      dateDebut: DEBUT,
      soldeInitial: 50 * M,
      seuilTension: 10 * M,
      lignes: LIGNES_TRESO as LigneTresorerie[],
      realises: [],
    });
    expect(c.tresorerie.ouverture).toEqual({
      semaines_tension: initiale.semainesTension.length,
      premiere_semaine_tension: initiale.premiereSemaineTension,
      besoin_financement: initiale.besoinFinancement,
      solde_minimum: initiale.soldeMinimum.montant,
    });
    const projection = (await s().a.chef.get(urlD(d1(), "/tresorerie"))).json().projection;
    expect(c.tresorerie.fin).toEqual({
      semaines_tension: projection.semaines_tension.length,
      premiere_semaine_tension: projection.premiere_semaine_tension,
      besoin_financement: projection.besoin_financement,
      solde_minimum: projection.solde_minimum.montant,
    });
    expect(c.tresorerie.variation_besoin_financement).toBe(
      projection.besoin_financement - initiale.besoinFinancement,
    );
  });

  it("plan, créanciers, covenants, check-lists, causes et re-notation égaux aux moteurs", async () => {
    const c = bilan1.contenu;
    const plan = (await s().a.chef.get(urlD(d1(), "/plan"))).json();
    expect(c.plan).toMatchObject({
      total: 3,
      terminees: 1,
      abandonnees: 0,
      en_retard: plan.evaluation.en_retard.length,
      avancement_pb: 3333,
      actions_au_plan_valide: 3,
    });
    expect(c.plan.par_volet.quick_win).toEqual({
      total: plan.evaluation.par_volet.quick_win.total,
      terminees: plan.evaluation.par_volet.quick_win.terminees,
      abandonnees: plan.evaluation.par_volet.quick_win.abandonnees,
      en_retard: plan.evaluation.par_volet.quick_win.en_retard,
      avancement_pb: plan.evaluation.par_volet.quick_win.avancement_pb,
    });
    // Leviers : délai clients 33 333 333 (trésorerie), charges fixes 30 M (résultat annuel).
    expect(c.plan.leviers).toEqual({
      actions_avec_levier: 2,
      impact_tresorerie_unique_retenu: plan.evaluation.impact_tresorerie_unique,
      impact_resultat_annuel_retenu: plan.evaluation.impact_resultat_annuel,
      impact_tresorerie_unique_realise: 33_333_333,
      impact_resultat_annuel_realise: 0,
    });
    expect(plan.evaluation.impact_tresorerie_unique).toBe(33_333_333);
    expect(plan.evaluation.impact_resultat_annuel).toBe(30 * M);

    const cr = (await s().a.chef.get(urlD(d1(), "/creanciers"))).json();
    expect(c.creanciers).toMatchObject({
      nombre: 2,
      encours_initial: 130 * M,
      encours_restant: cr.synthese.total_encours,
      echu: cr.synthese.total_echu,
      remises_obtenues: 40 * M,
    });
    expect(c.creanciers.accords).toMatchObject({ total: 1, tenus: 1, tenus_pb: 10_000 });

    const cov = (await s().a.chef.get(urlD(d1(), "/covenants"))).json();
    expect(c.covenants.en_defaut).toBe(cov.synthese.en_defaut);
    expect(c.covenants.en_defaut).toBe(2);

    const listes = (await s().a.chef.get(urlD(d1(), "/checklists"))).json().checklists;
    expect(listes).toHaveLength(1);
    expect(c.checklists).toEqual({
      nombre: 1,
      completes: 0,
      completude_moyenne_pb: listes[0].completude_pb,
      conformite_moyenne_pb: listes[0].conformite_pb,
      conformite_minimale_pb: listes[0].conformite_pb,
    });

    const causes = (await s().a.chef.get(urlD(d1(), "/causes"))).json().elements;
    const validee = causes.find((x: Json) => x.statut === "valide");
    expect(c.causes).toEqual({ validee: true, nombre: validee.causes.length });
    expect(c.renotation).toEqual({
      statut: "aucune_version_publiee",
      premiere: null,
      derniere: null,
      ecart_dixiemes: null,
      changement_classe: "non_comparable",
    });
  });

  it("contrôles : bloquants satisfaits, bilan complet ; la synthèse compte chaque évolution", () => {
    const c = bilan1.contenu;
    expect(c.complet).toBe(true);
    expect(c.controles.map((x: Json) => x.code)).toEqual(CONTROLES_CLOTURE.map((x) => x.code));
    for (const x of c.controles.filter((y: Json) => y.bloquant)) expect(x.satisfait).toBe(true);
    expect(c.controles.find((x: Json) => x.code === "notation_comparable").satisfait).toBe(false);
    const evolutions = [
      ...c.ratios.map((r: Json) => r.evolution),
      c.alerte.evolution,
      c.urgence.evolution,
      c.tresorerie.evolution,
    ];
    expect(c.synthese).toEqual({
      ameliorations: evolutions.filter((e: string) => e === "amelioration").length,
      degradations: evolutions.filter((e: string) => e === "degradation").length,
      stables: evolutions.filter((e: string) => e === "stable").length,
      non_comparables: evolutions.filter((e: string) => e === "non_comparable").length,
    });
  });

  it("liste (sans contenu) et lecture d'un bilan ; résumé « brouillon »", async () => {
    const liste = (await s().a.chef.get(urlCloturesD(d1()))).json();
    expect(liste.elements).toHaveLength(1);
    expect(liste.elements[0].contenu).toBeUndefined();
    expect(liste.elements[0]).toMatchObject({ id: bilan1.id, version: 1, statut: "brouillon" });
    const un = (await s().a.directeur.get(urlC(bilan1.id))).json();
    expect(un.contenu).toEqual(bilan1.contenu);
    expect(un.peut_valider).toBe(true); // complet, autre que le créateur, directeur de la mission
    const r = await sc.ctx.db.withTenant(s().a.cabinetId, (db) => resumeCloture(db, d1()));
    expect(r).toEqual({ statut: "brouillon", version: 1, valide_le: null });
  });

  it("journal : identifiants et indicateurs seulement", async () => {
    const lignes = await auditDe(bilan1.id);
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({ action: "creation", entite: "red_cloture" });
    expect(lignes[0]?.details).toEqual({ dossier_id: d1(), version: 1, complet: true });
  });

  it("entrées : le corps de la création est strict", async () => {
    expect((await s().a.chef.post(urlCloturesD(d1()), { contenu: {} })).statusCode).toBe(400);
    expect((await s().a.chef.post(urlCloturesD(d1()), { complet: true })).statusCode).toBe(400);
  });
});

describe("droits, isolation et portail", () => {
  const routes = (id: string, dossier: string) =>
    [
      ["GET", urlCloturesD(dossier)],
      ["POST", urlCloturesD(dossier)],
      ["GET", urlC(id)],
      ["POST", urlC(id, "/validation")],
      ["POST", urlC(id, "/rapports?format=docx")],
      ["GET", urlC(id, "/rapports")],
    ] as const;
  const appeler = (par: ReturnType<typeof api>, m: string, url: string) =>
    m === "GET" ? par.get(url) : par.post(url, {});
  let bilanId: string;

  beforeAll(async () => {
    bilanId = (await s().a.chef.get(urlCloturesD(d1()))).json().elements[0].id as string;
  });

  it("401 sans session sur les six routes", async () => {
    for (const [m, url] of routes(bilanId, d1())) {
      expect((await appeler(api(sc.ctx), m, url)).statusCode, `${m} ${url}`).toBe(401);
    }
  });

  it("403 : gestionnaire, ressources et expert externe", async () => {
    for (const u of [s().gestionnaire, s().ressources, s().expertExterne]) {
      for (const [m, url] of routes(bilanId, d1())) {
        expect((await appeler(u, m, url)).statusCode, `${m} ${url}`).toBe(403);
      }
    }
  });

  it("403 : l'expert métier (lecture seule) n'écrit ni ne valide ; le consultant n'est pas valideur", async () => {
    expect((await s().expert.post(urlCloturesD(d1()), {})).statusCode).toBe(403);
    expect((await s().expert.post(urlC(bilanId, "/validation"), {})).statusCode).toBe(403);
    expect((await s().consultantEquipe.post(urlC(bilanId, "/validation"), {})).statusCode).toBe(
      403,
    );
    expect((await s().a.chef.post(urlC(bilanId, "/validation"), {})).statusCode).toBe(403);
  });

  it("le consultant de l'équipe lit et construit un bilan", async () => {
    expect((await s().consultantEquipe.get(urlCloturesD(d1()))).statusCode).toBe(200);
    expect((await s().consultantEquipe.get(urlC(bilanId))).statusCode).toBe(200);
    // Le consultant n est membre que de la mission du dossier principal : il rejoint celle-ci.
    attendre(
      201,
      await s().a.chef.post(`/api/missions/${incomplet.missionId}/equipe`, {
        utilisateur_id: s().consultantEquipe.utilisateurId,
      }),
      "équipe",
    );
    const r = await s().consultantEquipe.post(urlCloturesD(incomplet.dossierId), {});
    expect(r.statusCode).toBe(201);
    expect(r.json().cree_par.id).toBe(s().consultantEquipe.utilisateurId);
  });

  it("404 : consultant hors équipe, bilan et dossier inconnus, autre cabinet", async () => {
    for (const [m, url] of routes(bilanId, d1())) {
      // Le consultant n'a pas le droit de valider : 403 avant toute recherche du bilan.
      const attendue = url.endsWith("/validation") ? 403 : 404;
      expect((await appeler(s().consultantHors, m, url)).statusCode, `hors ${url}`).toBe(attendue);
      expect((await appeler(s().b.associe, m, url)).statusCode, `autre cabinet ${url}`).toBe(404);
    }
    for (const [m, url] of routes(INCONNU, INCONNU)) {
      expect((await appeler(s().a.associe, m, url)).statusCode, `inconnu ${url}`).toBe(404);
    }
  });

  it("isolation : le cabinet B ne porte aucun bilan", async () => {
    const n = await proprietaire(
      async (c) =>
        (
          await c.query("SELECT count(*)::int AS n FROM red_clotures WHERE cabinet_id = $1", [
            s().b.cabinetId,
          ])
        ).rows[0].n,
    );
    expect(n).toBe(0);
    const dossierB = (
      await s().b.chef.post(`/api/missions/${s().missionB}/redressement`, { intitule: "Dossier B" })
    ).json().id as string;
    const liste = await s().b.chef.get(urlCloturesD(dossierB));
    expect(liste.statusCode).toBe(200);
    expect(liste.json().elements).toEqual([]);
  });

  it("le portail client n'a aucune de ces routes (403 PORTAIL_ROUTE_INTERDITE)", async () => {
    const dirigeant = await inviterClient(sc.ctx, s().a.associe, s().a.clientId, [
      "client_dirigeant",
    ]);
    for (const [m, url] of routes(bilanId, d1())) {
      const r = await appeler(dirigeant, m, url);
      expect(r.statusCode, `${m} ${url}`).toBe(403);
      expect(erreur(r)).toBe("PORTAIL_ROUTE_INTERDITE");
    }
  });

  it("entrées invalides : 400", async () => {
    const directeur = s().a.directeur;
    expect((await directeur.post(urlC(bilanId, "/validation"), { motif: 5 })).statusCode).toBe(400);
    expect(
      (await directeur.post(urlC(bilanId, "/validation"), { statut: "valide" })).statusCode,
    ).toBe(400);
    expect((await directeur.post(urlC(bilanId, "/rapports"), {})).statusCode).toBe(400);
    for (const q of ["format=pptx", "format=xlsx", "format=pdf&version=2"]) {
      expect((await directeur.post(urlC(bilanId, `/rapports?${q}`), {})).statusCode, q).toBe(400);
    }
    expect((await directeur.get(urlC(bilanId, "/rapports?limite=0"))).statusCode).toBe(400);
    expect((await directeur.get(urlC("pas-un-uuid"))).statusCode).toBe(400);
  });
});

describe("bilan incomplet : non validable (MPZ18)", () => {
  let bilan: Json;

  it("les contrôles bloquants manquants sont consignés", async () => {
    bilan = await construireBilan(s().a.chef, incomplet.dossierId);
    expect(bilan.complet).toBe(false);
    const manquants = bilan.contenu.controles
      .filter((x: Json) => x.bloquant && !x.satisfait)
      .map((x: Json) => x.code);
    expect(manquants).toEqual(["alerte_fin", "tresorerie_fin", "plan_present", "causes_validees"]);
    expect(bilan.contenu.causes).toEqual({ validee: false, nombre: 0 });
    expect(bilan.contenu.alerte).toMatchObject({
      ouverture: null,
      fin: null,
      evolution: "non_comparable",
    });
    expect(bilan.contenu.tresorerie.fin).toBeNull();
  });

  it("le directeur ne le valide pas : 409 RED_CLOTURE_INCOMPLETE avec les codes manquants", async () => {
    const r = await s().a.directeur.post(urlC(bilan.id, "/validation"), {});
    expect(r.statusCode).toBe(409);
    expect(erreur(r)).toBe("RED_CLOTURE_INCOMPLETE");
    expect(r.json().erreur.details.manquants).toEqual([
      "alerte_fin",
      "tresorerie_fin",
      "plan_present",
      "causes_validees",
    ]);
    const lu = (await s().a.directeur.get(urlC(bilan.id))).json();
    expect(lu.statut).toBe("brouillon");
    expect(lu.peut_valider).toBe(false);
  });

  it("la base refuse la validation d'un bilan incomplet (MPZ18) et un contrôle incohérent", async () => {
    expect(
      await refusSql(async (q) => {
        await q(
          `UPDATE red_clotures SET statut = 'valide', valide_par = $2, valide_le = now() WHERE id = $1`,
          [bilan.id, s().a.directeur.utilisateurId],
        );
      }),
    ).toBe("MPZ18");
    const insertion = (version: number, complet: boolean, contenu: unknown) =>
      refusSql(async (q) => {
        await q(
          `INSERT INTO red_clotures (cabinet_id, dossier_id, version, date_reference, contenu, empreinte,
             complet, cree_par) VALUES ($1, $2, $3, '2026-10-20', $4, $5, $6, $7)`,
          [
            s().a.cabinetId,
            vide.dossierId,
            version,
            JSON.stringify(contenu),
            "a".repeat(64),
            complet,
            s().a.chef.utilisateurId,
          ],
        );
      });
    const controles = [{ code: "x", bloquant: true, satisfait: false }];
    expect(await insertion(1, true, { complet: true, controles })).toBe("MPZ18");
    expect(await insertion(1, false, { complet: true, controles })).toBe("MPZ18");
    expect(await insertion(1, false, { controles })).toBe("MPZ18");
    expect(await insertion(1, true, { complet: true, controles: [] })).toBe("MPZ18");
    expect(await insertion(1, false, { complet: false, controles })).toBe("aucun");
  });

  it("plafond : 30 versions au plus par dossier (MPZ10)", async () => {
    const code = await refusSql(async (q) => {
      for (let v = 1; v <= 31; v++) {
        await q(
          `INSERT INTO red_clotures (cabinet_id, dossier_id, version, date_reference, contenu, empreinte,
             complet, cree_par) VALUES ($1, $2, $3, '2026-10-20', $4, $5, false, $6)`,
          [
            s().a.cabinetId,
            vide.dossierId,
            v,
            JSON.stringify({
              complet: false,
              controles: [{ code: "x", bloquant: true, satisfait: false }],
            }),
            "b".repeat(64),
            s().a.chef.utilisateurId,
          ],
        );
      }
    });
    expect(code).toBe("MPZ10");
  });
});

describe("validation : directeur de la mission, séparation des tâches, état et version", () => {
  let v1: Json;
  let v2: Json;
  let v3: Json;

  it("état périmé : un diagnostic ajouté depuis la construction refuse la validation (409)", async () => {
    v1 = (await s().a.chef.get(urlCloturesD(d1()))).json().elements[0];
    attendre(
      201,
      await s().a.chef.post(urlD(d1(), "/urgences"), {
        reponses: { T1: "partiellement", T2: "partiellement", T3: "partiellement" },
      }),
      "urgence supplémentaire",
    );
    const r = await s().a.directeur.post(urlC(v1.id, "/validation"), {});
    expect(r.statusCode).toBe(409);
    expect(erreur(r)).toBe("RED_CLOTURE_PERIMEE");
  });

  it("créateur non associé : le directeur qui a construit le bilan ne le valide pas (403)", async () => {
    v2 = await construireBilan(s().a.directeur, d1());
    expect(v2.version).toBe(2);
    expect(v2.peut_valider).toBe(false);
    const r = await s().a.directeur.post(urlC(v2.id, "/validation"), {});
    expect(r.statusCode).toBe(403);
    expect(erreur(r)).toBe("SEPARATION_DES_TACHES");
  });

  it("associé qui n'est pas le directeur de la mission : 403 VALIDATION_RESERVEE_DIRECTEUR", async () => {
    for (const par of [s().a.associe, s().associe2]) {
      const r = await par.post(urlC(v2.id, "/validation"), {});
      expect(r.statusCode).toBe(403);
      expect(erreur(r)).toBe("VALIDATION_RESERVEE_DIRECTEUR");
      expect(r.json().erreur.message).toContain("directeur de la mission");
    }
  });

  it("mission SANS directeur : 409 DIRECTEUR_REQUIS (API) et MPZ07 (base, 0492)", async () => {
    const sd = await nouveauDossierCas(s(), "Sans directeur", false, { directeur_id: null });
    const b = await construireBilan(s().a.chef, sd.dossierId);
    expect(b.peut_valider).toBe(false);
    for (const par of [s().a.associe, s().a.directeur]) {
      const r = await par.post(urlC(b.id, "/validation"), {});
      expect(r.statusCode).toBe(409);
      expect(erreur(r)).toBe("DIRECTEUR_REQUIS");
      expect(r.json().erreur.message).toContain("directeur de mission");
    }
    const refus = await proprietaire(async (cl) => {
      try {
        await cl.query(
          `UPDATE red_clotures SET statut = 'valide', valide_par = $2, valide_le = now() WHERE id = $1`,
          [b.id, s().a.associeId],
        );
        return "aucun";
      } catch (e) {
        return (e as { code?: string }).code ?? "inconnu";
      }
    });
    // MPZ18 (bilan incomplet) ou MPZ07 : la base refuse dans tous les cas ; MPZ07 est testé sur le plan.
    expect(["MPZ07", "MPZ18"]).toContain(refus);
  });

  it("seule la dernière version se valide (409) ; le directeur valide la version du chef", async () => {
    v3 = await construireBilan(s().a.chef, d1());
    expect(v3.version).toBe(3);
    expect(v3.peut_valider).toBe(false);
    const ancienne = await s().a.directeur.post(urlC(v1.id, "/validation"), {});
    expect(ancienne.statusCode).toBe(409);
    expect(erreur(ancienne)).toBe("RED_VERSION_NON_CONSECUTIVE");
    const dir = (await s().a.directeur.get(urlC(v3.id))).json();
    expect(dir.peut_valider).toBe(true);
    const ok = await s().a.directeur.post(urlC(v3.id, "/validation"), { motif: "Bilan relu" });
    attendre(200, ok, "validation du bilan");
    expect(ok.json()).toMatchObject({
      id: v3.id,
      statut: "valide",
      motif: "Bilan relu",
      peut_valider: false,
    });
    expect(ok.json().valide_par.id).toBe(s().a.directeur.utilisateurId);
    expect(ok.json().valide_le).toBeTruthy();
    expect(ok.json().contenu).toEqual(v3.contenu);
    const deja = await s().a.directeur.post(urlC(v3.id, "/validation"), {});
    expect(deja.statusCode).toBe(409);
    expect(erreur(deja)).toBe("RED_TRANSITION_INVALIDE");
  });

  it("résumé « valide » (version et date de validation) ; le journal ne porte aucune valeur", async () => {
    const r = await sc.ctx.db.withTenant(s().a.cabinetId, (db) => resumeCloture(db, d1()));
    expect(r).toMatchObject({ statut: "valide", version: 3 });
    expect(r.valide_le).toBeTruthy();
    const lignes = await auditDe(v3.id);
    expect(lignes.map((x) => x.action)).toEqual(["creation", "validation"]);
    expect(lignes[1]?.details).toEqual({ dossier_id: d1(), version: 3 });
    expect(Object.keys(lignes[0]?.details as object).sort()).toEqual([
      "complet",
      "dossier_id",
      "version",
    ]);
    expect(Object.keys(lignes[1]?.details as object).sort()).toEqual(["dossier_id", "version"]);
  });

  it("associé directeur de sa mission : il construit et valide lui-même (dispense), séparation des autres", async () => {
    const b = await construireBilan(s().associe2, associeDirecteur.dossierId);
    expect(b.complet).toBe(true);
    expect(b.peut_valider).toBe(true);
    const ok = await s().associe2.post(urlC(b.id, "/validation"), {});
    attendre(200, ok, "associé directeur");
    expect(ok.json().valide_par.id).toBe(s().associe2.utilisateurId);
  });

  it("contenu figé après validation : la base refuse toute modification (MPZ17) et toute suppression", async () => {
    const maj = (sql: string) =>
      refusSql(async (q) => {
        await q(sql, [v3.id]);
      });
    expect(await maj(`UPDATE red_clotures SET contenu = '{}' WHERE id = $1`)).toBe("MPZ17");
    expect(await maj(`UPDATE red_clotures SET motif_validation = 'autre' WHERE id = $1`)).toBe(
      "MPZ17",
    );
    expect(
      await maj(
        `UPDATE red_clotures SET statut = 'brouillon', valide_par = NULL, valide_le = NULL WHERE id = $1`,
      ),
    ).toBe("MPZ17");
    expect(await maj(`DELETE FROM red_clotures WHERE id = $1`)).toBe("MPZ01");
    // Le rôle applicatif n'a le droit de modifier que les colonnes de validation.
    expect(
      await codeSql(sc.ctx, s().a.cabinetId, (db) =>
        db.query("UPDATE red_clotures SET contenu = '{}' WHERE id = $1", [v3.id]),
      ),
    ).toBe("42501");
    expect(
      await codeSql(sc.ctx, s().a.cabinetId, (db) =>
        db.query("DELETE FROM red_clotures WHERE id = $1", [v3.id]),
      ),
    ).toBe("42501");
    const encore = (await s().a.directeur.get(urlC(v3.id))).json();
    expect(encore.contenu).toEqual(v3.contenu);
  });

  it("garde de la base avant validation : contenu (MPZ04), version (MPZ05), statut (MPZ06), valideur (MPZ07)", async () => {
    const v4 = await construireBilan(s().a.directeur, d1());
    expect(v4.version).toBe(4);
    const valider = (id: string, par: string, ensemble = "") =>
      refusSql(async (q) => {
        await q(
          `UPDATE red_clotures SET statut = 'valide', valide_par = $2, valide_le = now()${ensemble}
           WHERE id = $1`,
          [id, par],
        );
      });
    expect(await valider(v4.id, s().a.directeur.utilisateurId, `, contenu = '{}'`)).toBe("MPZ04");
    expect(await valider(v2.id, s().a.directeur.utilisateurId)).toBe("MPZ05");
    // Valideur sans rôle habilité (chef) puis créateur non associé (directeur) : MPZ07.
    expect(await valider(v4.id, s().a.chef.utilisateurId)).toBe("MPZ07");
    expect(await valider(v4.id, s().a.directeur.utilisateurId)).toBe("MPZ07");
    // Associés qui ne sont pas le directeur de la mission (0492) : MPZ07 (la validation réussie est testée par l'API).
    expect(await valider(v4.id, s().a.associeId)).toBe("MPZ07");
    expect(await valider(v4.id, s().associe2.utilisateurId)).toBe("MPZ07");
    expect(
      await refusSql(async (q) => {
        await q(`UPDATE red_clotures SET motif_validation = 'x' WHERE id = $1`, [v4.id]);
      }),
    ).toBe("MPZ06");
    const insertion = (statut: string, version: number) =>
      refusSql(async (q) => {
        await q(
          `INSERT INTO red_clotures (cabinet_id, dossier_id, version, date_reference, contenu, empreinte,
             complet, statut, cree_par, valide_par, valide_le)
           VALUES ($1, $2, $3, '2026-10-20', $4, $5, true, $6, $7, $8, $9)`,
          [
            s().a.cabinetId,
            d1(),
            version,
            JSON.stringify(v4.contenu),
            "c".repeat(64),
            statut,
            s().a.chef.utilisateurId,
            statut === "valide" ? s().a.associeId : null,
            statut === "valide" ? new Date().toISOString() : null,
          ],
        );
      });
    expect(await insertion("valide", 5)).toBe("MPZ06");
    expect(await insertion("brouillon", 9)).toBe("MPZ05");
    expect(await insertion("brouillon", 5)).toBe("aucun");
  });
});

describe("rapport de clôture", () => {
  let rapport: Json;
  let fichierId: string;
  let valide: Json;

  const xmlDe = async (par: ReturnType<typeof api>, id: string): Promise<string> => {
    const r = await par.get(`/api/fichiers/${id}`);
    expect(r.statusCode).toBe(200);
    return toutLeXml(dezipper(r.rawPayload));
  };

  beforeAll(async () => {
    valide = (await s().a.directeur.get(urlCloturesD(d1())))
      .json()
      .elements.find((e: Json) => e.statut === "valide");
  });

  it("un bilan non validé ne se rend pas en rapport (409 RED_CLOTURE_NON_VALIDEE)", async () => {
    const brouillon = (await s().a.directeur.get(urlCloturesD(d1())))
      .json()
      .elements.find((e: Json) => e.statut === "brouillon");
    const r = await s().a.chef.post(urlC(brouillon.id, "/rapports?format=docx"), {});
    expect(r.statusCode).toBe(409);
    expect(erreur(r)).toBe("RED_CLOTURE_NON_VALIDEE");
    const compte = await proprietaire(
      async (c) =>
        (
          await c.query(
            "SELECT count(*)::int AS n FROM rapports_mission WHERE modele = 'cloture_redressement' AND mission_id = $1",
            [s().missionId],
          )
        ).rows[0].n,
    );
    expect(compte).toBe(0);
  });

  it("génération (docx) : 201, ligne rapports_mission de niveau « red », source cohérente", async () => {
    const r = await s().a.chef.post(urlC(valide.id, "/rapports?format=docx"), {});
    attendre(201, r, "rapport de clôture");
    rapport = r.json();
    fichierId = rapport.fichier.id;
    expect(rapport.rapport).toMatchObject({
      mission_id: s().missionId,
      modele: "cloture_redressement",
      format: "docx",
      statut: "valide",
      niveau: "red",
      red_cloture_id: valide.id,
      version_source: 3,
      genere_par: s().a.chef.utilisateurId,
    });
    expect(rapport.fichier).toMatchObject({
      type_mime: expect.stringContaining("wordprocessingml"),
    });
    const ligne = await proprietaire((c) =>
      c.query(
        `SELECT niveau, modele, red_cloture_id, version_source, notation_id, plan_id, dd_note_id, variante, fichier_id
         FROM rapports_mission WHERE id = $1`,
        [rapport.rapport.id],
      ),
    );
    expect(ligne.rows[0]).toMatchObject({
      niveau: "red",
      modele: "cloture_redressement",
      red_cloture_id: valide.id,
      version_source: 3,
      notation_id: null,
      plan_id: null,
      dd_note_id: null,
      variante: null,
      fichier_id: fichierId,
    });
  });

  it("le fichier reproduit le contenu figé et les causes validées, sans calcul ni FIN-02", async () => {
    const xml = await xmlDe(s().a.chef, fichierId);
    for (const titre of [
      "Rapport de clôture du redressement",
      "Synthèse",
      "Ratios financiers",
      "Alerte et urgence",
      "Trésorerie à 13 semaines",
      "Plan de redressement",
      "Créanciers et accords",
      "Covenants et check-lists",
      "Re-notation",
      "Causes racines validées",
      "Contrôles de complétude",
    ]) {
      expect(xml, titre).toContain(titre);
    }
    // Marge brute : ouverture 3800 pb, fin 3500 pb, variation -300 pb.
    expect(xml).toContain("Marge brute");
    expect(xml).toContain("38 %");
    expect(xml).toContain("35 %");
    expect(xml).toContain("−3 %");
    const causes = (await s().a.chef.get(urlD(d1(), "/causes")))
      .json()
      .elements.find((x: Json) => x.statut === "valide");
    for (const cause of causes.causes) expect(xml).toContain(cause.libelle);
    expect(xml).not.toMatch(/cout_jour|taux_horaire|honoraire|marge de la mission/i);
    expect(xml).not.toMatch(/faillite|cessation des paiements|défaillance/i);
  });

  it("causes non validées exclues : une proposition en brouillon ne figure jamais au rapport", async () => {
    const b = (await s().associe2.get(urlCloturesD(associeDirecteur.dossierId))).json().elements[0];
    expect(b.statut).toBe("valide");
    const g = await s().a.chef.post(urlD(associeDirecteur.dossierId, "/causes/generation"), {});
    attendre(201, g, "nouvelle proposition");
    attendre(
      200,
      await s().a.chef.patch(`/api/redressement/causes/${g.json().id}`, {
        causes: [
          {
            domaine: "tresorerie",
            libelle: "Cause brouillon secrète",
            description: "Ne doit pas figurer au rapport.",
          },
        ],
      }),
      "modification",
    );
    const r = await s().associe2.post(urlC(b.id, "/rapports?format=docx"), {});
    attendre(201, r, "rapport");
    const xml = await xmlDe(s().associe2, r.json().fichier.id);
    expect(xml).not.toContain("Cause brouillon secrète");
    expect(xml).not.toContain("Ne doit pas figurer");
    expect(xml).toContain("Causes racines validées");
  });

  it("lecture du fichier : redressement.lire et rien de moins (comme tout fichier inaccessible : 404)", async () => {
    for (const u of [s().a.associe, s().a.directeur, s().a.chef, s().consultantEquipe]) {
      expect((await u.get(`/api/fichiers/${fichierId}`)).statusCode).toBe(200);
    }
    for (const u of [s().gestionnaire, s().ressources, s().expertExterne]) {
      expect([403, 404]).toContain((await u.get(`/api/fichiers/${fichierId}`)).statusCode);
    }
    expect((await s().consultantHors.get(`/api/fichiers/${fichierId}`)).statusCode).toBe(404);
    expect((await s().b.associe.get(`/api/fichiers/${fichierId}`)).statusCode).toBe(404);
    expect((await api(sc.ctx).get(`/api/fichiers/${fichierId}`)).statusCode).toBe(401);
    const dirigeant = await inviterClient(sc.ctx, s().a.associe, s().a.clientId, [
      "client_dirigeant",
    ]);
    expect([403, 404]).toContain((await dirigeant.get(`/api/fichiers/${fichierId}`)).statusCode);
  });

  it("listes : rapports du bilan et de la mission, filtrés par niveau lisible", async () => {
    const l = await s().a.directeur.get(urlC(valide.id, "/rapports"));
    expect(l.statusCode).toBe(200);
    expect(l.json().elements.map((x: Json) => x.id)).toEqual([rapport.rapport.id]);
    expect(l.json().elements[0]).toMatchObject({
      modele: "cloture_redressement",
      niveau: "red",
      red_cloture_id: valide.id,
      version_source: 3,
    });
    expect(JSON.stringify(l.json())).not.toMatch(/cle_stockage/);
    const mission = `/api/missions/${s().missionId}/rapports`;
    for (const u of [s().a.chef, s().a.directeur, s().a.associe]) {
      const m = await u.get(mission);
      expect(m.statusCode).toBe(200);
      expect(m.json().elements.some((x: Json) => x.niveau === "red")).toBe(true);
    }
    const parGestionnaire = await s().gestionnaire.get(mission);
    expect(parGestionnaire.statusCode).toBe(200);
    expect(parGestionnaire.json().elements.some((x: Json) => x.niveau === "red")).toBe(false);
    expect((await s().ressources.get(mission)).statusCode).toBeLessThan(500);
    expect((await s().ressources.get(urlC(valide.id, "/rapports"))).statusCode).toBe(403);
  });

  it("recherche unifiée : le rapport porte son libellé et suit son niveau", async () => {
    const q = "/api/capitalisation/recherche?q=cloture%20redressement&types=rapport&limite=30";
    const parAssocie = await s().a.associe.get(q);
    expect(parAssocie.statusCode).toBe(200);
    expect(JSON.stringify(parAssocie.json())).toContain("Rapport de clôture du redressement");
    const parGestionnaire = await s().gestionnaire.get(q);
    if (parGestionnaire.statusCode === 200) {
      expect(JSON.stringify(parGestionnaire.json())).not.toContain(
        "Rapport de clôture du redressement",
      );
    }
  });

  it("le suivi qualité du rapport est ouvert (R2) avec ses chiffres « moteur » ; la classe R3 se relève à la main", async () => {
    const suivi = await proprietaire((c) =>
      c.query(
        "SELECT id, type_livrable, classe_minimale, classe FROM qualite_suivis WHERE livrable_id = $1",
        [rapport.rapport.id],
      ),
    );
    expect(suivi.rows).toHaveLength(1);
    expect(suivi.rows[0]).toMatchObject({
      type_livrable: "rapport",
      classe_minimale: "R2",
      classe: "R2",
    });
    const chiffres = await proprietaire((c) =>
      c.query(
        "SELECT count(*)::int AS n FROM qualite_revue_elements WHERE suivi_id = $1 AND kind = 'chiffre'",
        [suivi.rows[0].id],
      ),
    );
    expect(chiffres.rows[0].n).toBeGreaterThan(0);
    const releve = await s().a.associe.post(`/api/qualite/suivis/${suivi.rows[0].id}/classe`, {
      classe: "R3",
      motif: "Livrable de clôture remis au client.",
    });
    expect(releve.statusCode).toBe(200);
  });

  it("le journal trace la génération sans contenu", async () => {
    const j = await proprietaire((c) =>
      c.query(
        "SELECT details FROM journal_audit WHERE action = 'generation_rapport' AND entite_id = $1 ORDER BY cree_le DESC LIMIT 1",
        [s().missionId],
      ),
    );
    expect(j.rows[0].details).toEqual({
      rapport_id: rapport.rapport.id,
      modele: "cloture_redressement",
      format: "docx",
      niveau: "red",
      fichier_id: fichierId,
      cloture_id: valide.id,
      version_source: 3,
    });
  });

  it("génération : rôles sans redressement.lire refusés (403) ; format PDF sans navigateur : 503", async () => {
    for (const u of [s().gestionnaire, s().ressources, s().expertExterne]) {
      expect((await u.post(urlC(valide.id, "/rapports?format=docx"), {})).statusCode).toBe(403);
    }
    // Sans CHROMIUM_PATH (la configuration refuse un chemin inexistant), le repli
    // « Chrome de développement sous Windows » lance un vrai navigateur : lent sous
    // charge. Hors environnement local, cheminNavigateur renvoie null : refus immédiat.
    const config = sc.ctx.config as { NODE_ENV: string; CHROMIUM_PATH?: string };
    const avant = { NODE_ENV: config.NODE_ENV, CHROMIUM_PATH: config.CHROMIUM_PATH };
    config.NODE_ENV = "production";
    delete config.CHROMIUM_PATH;
    try {
      const pdf = await s().a.chef.post(urlC(valide.id, "/rapports?format=pdf"), {});
      expect(pdf.statusCode).toBe(503);
    } finally {
      config.NODE_ENV = avant.NODE_ENV;
      if (avant.CHROMIUM_PATH !== undefined) config.CHROMIUM_PATH = avant.CHROMIUM_PATH;
    }
  }, 90_000);

  it("MPR05 en base : bilan d'une autre mission ou non validé, niveau ou source incohérents", async () => {
    const autre = (await s().associe2.get(urlCloturesD(associeDirecteur.dossierId))).json()
      .elements[0];
    const brouillon = (await s().a.directeur.get(urlCloturesD(d1())))
      .json()
      .elements.find((e: Json) => e.statut === "brouillon");
    const inserer = (
      bilanId: string,
      version: number,
      extra: { niveau?: string; modele?: string; mission?: string; planId?: string | null } = {},
    ) =>
      refusSql(async (q) => {
        const f = (await q(
          `INSERT INTO fichiers (cabinet_id, cle_stockage, nom_origine, type_mime, taille, sha256, envoye_par)
           VALUES ($1, $2, 'cloture.pdf', 'application/pdf', 100, $3, $4) RETURNING id`,
          [
            s().a.cabinetId,
            randomUUID().replaceAll("-", ""),
            "d".repeat(64),
            s().a.chef.utilisateurId,
          ],
        )) as { rows: { id: string }[] };
        await q(
          `INSERT INTO rapports_mission (cabinet_id, mission_id, fichier_id, modele, format, statut, niveau,
             genere_par, red_cloture_id, version_source)
           VALUES ($1, $2, $3, $4, 'pdf', 'valide', $5, $6, $7, $8)`,
          [
            s().a.cabinetId,
            extra.mission ?? s().missionId,
            f.rows[0]?.id,
            extra.modele ?? "cloture_redressement",
            extra.niveau ?? "red",
            s().a.chef.utilisateurId,
            bilanId,
            version,
          ],
        );
      });
    expect(await inserer(valide.id, 3)).toBe("aucun");
    // Bilan validé d'une AUTRE mission.
    expect(await inserer(autre.id, autre.version)).toBe("MPR05");
    // Bilan non validé de la même mission, ou version qui n'est pas celle du bilan.
    expect(await inserer(brouillon.id, brouillon.version)).toBe("MPR05");
    expect(await inserer(valide.id, 1)).toBe("MPR05");
    // Contraintes de forme : niveau, modèle.
    expect(await inserer(valide.id, 3, { niveau: "plan" })).toBe("23514");
    // Le déclencheur de source juge avant les contraintes : ce faux « note_comite » n a pas de note.
    expect(await inserer(valide.id, 3, { modele: "note_comite", niveau: "dd" })).toBe("MPR04");
    expect(await inserer(valide.id, 3, { niveau: "dd" })).toBe("23514");
  });
});

describe("modèles de rapport existants : la redéfinition de rapports_mission est transparente", () => {
  it("les contraintes en vigueur contiennent les six modèles et les sept niveaux", async () => {
    const c = await proprietaire((cl) =>
      cl.query(
        `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
         WHERE conrelid = 'rapports_mission'::regclass AND conname LIKE 'rapports_mission_%_check'`,
      ),
    );
    const defs = Object.fromEntries(c.rows.map((r) => [r.conname, r.def as string]));
    for (const m of [
      "etat_avancement",
      "notation",
      "plan_strategique",
      "dossier_bancaire",
      "note_comite",
      "cloture_redressement",
    ]) {
      expect(defs.rapports_mission_modele_check, m).toContain(m);
      expect(defs.rapports_mission_source_check, m).toContain(m);
    }
    for (const n of ["base", "jours", "finance", "notation", "plan", "dd", "red"]) {
      expect(defs.rapports_mission_niveau_check, n).toContain(`'${n}'`);
    }
  });
});

describe("dossier clos, mission clôturée", () => {
  it("dossier clos : plus de bilan ni de validation (409), mais le rapport d'un bilan validé reste générable", async () => {
    const b = (await s().a.directeur.get(urlCloturesD(d1())))
      .json()
      .elements.find((e: Json) => e.statut === "valide");
    const reste = (await s().a.directeur.get(urlCloturesD(d1())))
      .json()
      .elements.find((e: Json) => e.statut === "brouillon" && e.peut_valider);
    attendre(
      200,
      await s().a.directeur.post(urlD(d1(), "/statut"), {
        statut: "clos",
        motif: "Objectifs atteints",
      }),
      "clôture du dossier",
    );
    const creation = await s().a.chef.post(urlCloturesD(d1()), {});
    expect(creation.statusCode).toBe(409);
    expect(erreur(creation)).toBe("RED_DOSSIER_CLOS");
    if (reste) {
      const validation = await s().a.directeur.post(urlC(reste.id, "/validation"), {});
      expect(validation.statusCode).toBe(409);
      expect(erreur(validation)).toBe("RED_DOSSIER_CLOS");
    }
    expect(
      await refusSql(async (q) => {
        await q(
          `INSERT INTO red_clotures (cabinet_id, dossier_id, version, date_reference, contenu, empreinte,
             complet, cree_par) VALUES ($1, $2, 99, '2026-10-20', $3, $4, false, $5)`,
          [
            s().a.cabinetId,
            d1(),
            JSON.stringify({
              complet: false,
              controles: [{ code: "x", bloquant: true, satisfait: false }],
            }),
            "e".repeat(64),
            s().a.chef.utilisateurId,
          ],
        );
      }),
    ).toBe("MPZ03");
    expect((await s().a.chef.get(urlC(b.id))).statusCode).toBe(200);
    expect((await s().a.chef.post(urlC(b.id, "/rapports?format=docx"), {})).statusCode).toBe(201);
  });

  it("mission clôturée : bilan et rapport refusés (409), lectures conservées", async () => {
    const b = await construireBilan(s().a.chef, aCloturer.dossierId);
    attendre(200, await s().a.directeur.post(urlC(b.id, "/validation"), {}), "validation");
    const avant = await s().a.chef.post(urlC(b.id, "/rapports?format=docx"), {});
    expect(avant.statusCode).toBe(201);
    await proprietaire((c) =>
      c.query("UPDATE missions SET statut = 'cloturee', cloturee_le = now() WHERE id = $1", [
        aCloturer.missionId,
      ]),
    );
    const rapport = await s().a.chef.post(urlC(b.id, "/rapports?format=docx"), {});
    expect(rapport.statusCode).toBe(409);
    expect(rapport.json().erreur.message).toContain("clôturée");
    const creation = await s().a.chef.post(urlCloturesD(aCloturer.dossierId), {});
    expect(creation.statusCode).toBe(409);
    expect(erreur(creation)).toBe("RED_MISSION_CLOTUREE");
    expect(
      await refusSql(async (q) => {
        await q(
          `INSERT INTO red_clotures (cabinet_id, dossier_id, version, date_reference, contenu, empreinte,
             complet, cree_par) VALUES ($1, $2, 2, '2026-10-20', $3, $4, false, $5)`,
          [
            s().a.cabinetId,
            aCloturer.dossierId,
            JSON.stringify({
              complet: false,
              controles: [{ code: "x", bloquant: true, satisfait: false }],
            }),
            "f".repeat(64),
            s().a.chef.utilisateurId,
          ],
        );
      }),
    ).toBe("MPZ03");
    expect((await s().a.chef.get(urlC(b.id))).statusCode).toBe(200);
    expect((await s().a.chef.get(urlCloturesD(aCloturer.dossierId))).statusCode).toBe(200);
    expect((await s().a.chef.get(urlC(b.id, "/rapports"))).statusCode).toBe(200);
  });
});
