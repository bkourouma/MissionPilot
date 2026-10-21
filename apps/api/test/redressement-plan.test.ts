import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, type Api } from "./api.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import { creerMission } from "./missions-outils.js";
import { attendre, inviterClient } from "./portail-outils.js";
import {
  erreur,
  INCONNU,
  lignesCasA,
  ouvrirDossierRed,
  preparerCasA,
  preparerRed,
  semerEtat,
  type ScenarioRed,
} from "./redressement-outils.js";

/*
 * Plan, actions, versions de plan et leviers (routes 29 à 37) : création d'action avec levier (L1 à L6
 * par l'API), tâche liée (403 sans `tache.assigner`), notification sans montant, responsable du portail
 * ou invisible (400), déplacements et transitions, action terminée figée, versions de plan : séparation
 * des tâches (créateur 403, directeur autre 200, associé créateur 200, chef 403), RED_PLAN_MODIFIE,
 * RED_PLAN_INCOMPLET, déplacement de kanban sans effet sur la validité, passage du dossier à `plan_valide`.
 */

let ctx: Contexte;
let s: ScenarioRed;
let dossierId: string;

const M = 1_000_000;
const urlD = (suffixe: string, id = dossierId) => `/api/redressement/dossiers/${id}${suffixe}`;
const urlA = (id: string, suffixe = "") => `/api/redressement/actions/${id}${suffixe}`;
const urlV = (id: string, suffixe = "") => `/api/redressement/plan/versions/${id}${suffixe}`;

/** Date civile (UTC) à `n` jours d'aujourd'hui : les fenêtres du plan dépendent du jour courant. */
const dans = (n: number): string =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const action = (extra: Record<string, unknown> = {}) => ({
  titre: "Relancer les clients en retard",
  description: "Appels et relances écrites",
  volet: "quick_win",
  domaine: "tresorerie",
  echeance: dans(30),
  responsable_id: s.a.directeur.utilisateurId,
  ...extra,
});

async function creerAction(
  par: Api,
  extra: Record<string, unknown> = {},
  d = dossierId,
): Promise<Json> {
  const r = await par.post(urlD("/actions", d), action(extra));
  attendre(201, r, "action");
  return r.json();
}

beforeAll(async () => {
  ctx = await demarrer();
  s = await preparerRed(ctx, "RED plan");
  dossierId = (await preparerCasA(s)).dossierId;
}, 120_000);

afterAll(async () => {
  await ctx.fermer();
});

describe("accès (routes 29 à 37)", () => {
  it("401, 403, 404 et autre cabinet pour chaque route", async () => {
    const a = await creerAction(s.a.chef, { titre: "Pour les accès" });
    const v = (await s.a.chef.post(urlD("/plan/versions"), {})).json();
    const defs: [
      "GET" | "POST" | "PATCH",
      string,
      unknown,
      "lecture" | "ecriture" | "validation",
    ][] = [
      ["GET", urlD("/plan"), undefined, "lecture"],
      ["POST", urlD("/actions"), action({ titre: "Autre" }), "ecriture"],
      ["PATCH", urlA(a.id), { titre: "Nouveau" }, "ecriture"],
      ["POST", urlA(a.id, "/deplacement"), { statut: "en_cours" }, "ecriture"],
      ["POST", urlA(a.id, "/commentaires"), { commentaire: "Note" }, "ecriture"],
      ["GET", urlA(a.id), undefined, "lecture"],
      ["POST", urlD("/plan/versions"), {}, "ecriture"],
      ["POST", urlV(v.id, "/validation"), {}, "validation"],
      [
        "POST",
        urlD("/leviers/simulation"),
        { code: "reduction_stocks", parametres: { reductionPb: 100 } },
        "lecture",
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
      if (d[3] !== "lecture")
        expect((await appeler(s.expert, d)).statusCode, `403 expert ${d[1]}`).toBe(403);
      if (d[3] === "validation")
        expect((await appeler(s.a.chef, d)).statusCode, `403 chef ${d[1]}`).toBe(403);
      expect((await appeler(s.consultantHors, d)).statusCode, `404 ${d[1]}`).toBe(
        d[3] === "validation" ? 403 : 404,
      );
      expect((await appeler(s.b.associe, d)).statusCode, `404 autre cabinet ${d[1]}`).toBe(404);
    }
    expect((await s.a.associe.get(urlA(INCONNU))).statusCode).toBe(404);
    expect((await s.a.associe.post(urlV(INCONNU, "/validation"), {})).statusCode).toBe(404);
  });
});

describe("leviers (route 37 et création d'action) : cas L1 à L8", () => {
  const sim = (code: string, parametres: Record<string, number>, d = dossierId) =>
    s.a.chef.post(urlD("/leviers/simulation", d), { code, parametres });

  it("L1 à L6 rendus par l'API depuis le dernier état accepté (CA 1,2 G, stocks 120 M, coût des ventes 780 M)", async () => {
    const l1 = (await sim("reduction_delai_clients", { joursGagnes: 10 })).json();
    expect(l1).toMatchObject({
      code: "reduction_delai_clients",
      devise: "XOF",
      tresorerie_unique: 33_333_333,
      resultat_annuel: 0,
      tresorerie_annee1: 33_333_333,
      version_catalogue: 1,
    });
    expect(l1.base).toEqual({ chiffre_affaires: 1_200 * M });
    expect(l1.hypotheses.length).toBeGreaterThan(0);
    expect((await sim("reduction_stocks", { reductionPb: 1500 })).json().tresorerie_unique).toBe(
      18 * M,
    );
    expect(
      (await sim("allongement_delai_fournisseurs", { joursGagnes: 15 })).json().tresorerie_unique,
    ).toBe(32_500_000);
    const l4 = (
      await sim("reduction_charges_fixes", {
        chargesFixesAnnuelles: 300 * M,
        reductionPb: 1000,
        moisMiseEnOeuvre: 3,
      })
    ).json();
    expect(l4).toMatchObject({
      tresorerie_unique: 0,
      resultat_annuel: 30 * M,
      tresorerie_annee1: 22_500_000,
    });
    expect(
      (await sim("hausse_prix", { hausseParPb: 500, perteVolumePb: 200 })).json().resultat_annuel,
    ).toBe(50_400_000);
    const l6 = (
      await sim("cession_actif", {
        prixCession: 80 * M,
        valeurComptableNette: 50 * M,
        fraisEtImpots: 4 * M,
      })
    ).json();
    expect(l6).toMatchObject({ tresorerie_unique: 76 * M, plus_ou_moins_value: 30 * M });
  });

  it("bornes, code inconnu, corps strict : 400 ; base absente : 409 ; devise différente : 409 ; aucun journal", async () => {
    for (const j of [0, 181, 1.5]) {
      const r = await sim("reduction_delai_clients", { joursGagnes: j });
      expect(r.statusCode, `jours ${j}`).toBe(400);
    }
    const bornes = await sim("reduction_delai_clients", { joursGagnes: 181 });
    expect(erreur(bornes)).toBe("RED_PARAMETRES_LEVIER_INVALIDES");
    expect(erreur(await sim("reduction_delai_clients", {}))).toBe(
      "RED_PARAMETRES_LEVIER_INVALIDES",
    );
    expect((await sim("levier_inconnu", { joursGagnes: 1 })).statusCode).toBe(400);
    expect(
      (
        await s.a.chef.post(urlD("/leviers/simulation"), {
          code: "reduction_stocks",
          parametres: { reductionPb: 1 },
          exces: 1,
        })
      ).statusCode,
    ).toBe(400);
    // Sans état accepté : un levier qui exige une base est refusé ; un levier sans base passe.
    const c = await s.a.associe.post("/api/clients", {
      raison_sociale: "Client sans états (fictif)",
    });
    const m = await creerMission(s.a, { intitule: "Sans états", client_id: c.json().id });
    const vide = (await ouvrirDossierRed(s, m.id)).id;
    const sans = await sim("reduction_delai_clients", { joursGagnes: 10 }, vide);
    expect(sans.statusCode).toBe(409);
    expect(erreur(sans)).toBe("RED_BASE_INCOMPLETE");
    expect(sans.json().erreur.details.manquants).toEqual(["chiffre_affaires"]);
    expect(
      (
        await sim(
          "cession_actif",
          { prixCession: 10, valeurComptableNette: 5, fraisEtImpots: 1 },
          vide,
        )
      ).statusCode,
    ).toBe(200);
    // Devise de l'état accepté différente de celle du dossier.
    const c2 = await s.a.associe.post("/api/clients", {
      raison_sociale: "Client en euros (fictif)",
    });
    const m2 = await creerMission(s.a, { intitule: "État en euros", client_id: c2.json().id });
    await semerEtat(s.a.chef, c2.json().id, 2025, lignesCasA(), "EUR");
    const euro = (await ouvrirDossierRed(s, m2.id)).id;
    attendre(
      201,
      await s.a.chef.post(urlD("/correspondances", euro), {
        postes: { chiffre_affaires: { codes: ["XB"], sans_objet: false } },
      }),
      "correspondance",
    );
    const diff = await sim("reduction_delai_clients", { joursGagnes: 10 }, euro);
    expect(diff.statusCode).toBe(409);
    expect(erreur(diff)).toBe("RED_DEVISE_ETAT_DIFFERENTE");
    const avant = await proprietaire((cl) =>
      cl.query("SELECT count(*)::int AS n FROM journal_audit WHERE entite LIKE 'red_%'"),
    );
    await sim("reduction_stocks", { reductionPb: 100 });
    const apres = await proprietaire((cl) =>
      cl.query("SELECT count(*)::int AS n FROM journal_audit WHERE entite LIKE 'red_%'"),
    );
    expect(apres.rows[0].n).toBe(avant.rows[0].n);
  });
});

describe("création d'une action (route 30)", () => {
  it("corps invalide : titre vide, volet, domaine, date hors bornes, champ inconnu (400)", async () => {
    for (const corps of [
      action({ titre: "" }),
      action({ volet: "long_terme" }),
      action({ domaine: "juridique" }),
      action({ echeance: "1999-01-01" }),
      action({ exces: 1 }),
      action({ responsable_id: "pas-un-uuid" }),
      action({ levier: { code: "inconnu", parametres: {} } }),
    ]) {
      expect(
        (await s.a.chef.post(urlD("/actions"), corps)).statusCode,
        JSON.stringify(corps).slice(0, 60),
      ).toBe(400);
    }
  });

  it("nominal avec levier L1 : numérotée, impact conservé avec ses paramètres, notification sans montant", async () => {
    const a = await creerAction(s.a.chef, {
      titre: "Réduire le délai clients",
      responsable_id: s.consultantEquipe.utilisateurId,
      levier: { code: "reduction_delai_clients", parametres: { joursGagnes: 10 } },
    });
    expect(a).toMatchObject({
      numero: expect.any(Number),
      statut: "a_faire",
      volet: "quick_win",
      domaine: "tresorerie",
      en_retard: false,
      tache_collaboration_id: null,
      motif: null,
      termine_le: null,
    });
    expect(a.responsable.id).toBe(s.consultantEquipe.utilisateurId);
    expect(a.levier).toMatchObject({
      code: "reduction_delai_clients",
      parametres: { joursGagnes: 10 },
    });
    expect(a.levier.impact).toMatchObject({ tresorerie_unique: 33_333_333, devise: "XOF" });
    // Notification interne du responsable : jamais un montant.
    const n = await proprietaire((cl) =>
      cl.query(
        "SELECT titre, corps, lien FROM notifications WHERE type = 'redressement_action_assignee' AND destinataire_id = $1",
        [s.consultantEquipe.utilisateurId],
      ),
    );
    expect(n.rows.length).toBeGreaterThanOrEqual(1);
    for (const ligne of n.rows) {
      expect(`${ligne.titre} ${ligne.corps}`).not.toMatch(/\d{5,}/);
      expect(ligne.lien).toBe(`/missions/${s.missionId}/redressement/plan`);
    }
    // Numéros consécutifs.
    const b = await creerAction(s.a.chef, { titre: "Deuxième" });
    expect(b.numero).toBe(a.numero + 1);
    // Relecture : l'impact est un instantané (pas de recalcul) ; détail avec événement de création.
    const d = (await s.a.chef.get(urlA(a.id))).json();
    expect(d.levier.impact).toEqual(a.levier.impact);
    expect(d.evenements).toHaveLength(1);
    expect(d.evenements[0]).toMatchObject({
      type: "creation",
      statut_apres: "a_faire",
      statut_avant: null,
    });
    // Journal : identifiants et codes, jamais le titre.
    const j = await proprietaire((cl) =>
      cl.query(
        "SELECT details::text AS d FROM journal_audit WHERE entite = 'red_action' AND entite_id = $1",
        [a.id],
      ),
    );
    expect(j.rows[0].d).not.toContain("délai clients");
  });

  it("levier sans base : 409 RED_BASE_INCOMPLETE ; paramètres hors bornes : 400 ; aucune action créée", async () => {
    const c = await s.a.associe.post("/api/clients", {
      raison_sociale: "Autre client sans états (fictif)",
    });
    const m = await creerMission(s.a, { intitule: "Levier sans base", client_id: c.json().id });
    const d = (await ouvrirDossierRed(s, m.id)).id;
    const r = await s.a.chef.post(
      urlD("/actions", d),
      action({ levier: { code: "reduction_stocks", parametres: { reductionPb: 500 } } }),
    );
    expect(r.statusCode).toBe(409);
    expect(erreur(r)).toBe("RED_BASE_INCOMPLETE");
    const bornes = await s.a.chef.post(
      urlD("/actions", d),
      action({ levier: { code: "reduction_stocks", parametres: { reductionPb: 0 } } }),
    );
    expect(erreur(bornes)).toBe("RED_PARAMETRES_LEVIER_INVALIDES");
    const plan = (await s.a.chef.get(urlD("/plan", d))).json();
    expect(plan.kanban.colonnes.a_faire).toHaveLength(0);
  });

  it("responsable : compte du portail, mission invisible, sans droit de lecture, inconnu : 400", async () => {
    const portail = await inviterClient(ctx, s.a.associe, s.a.clientId, ["client_dirigeant"]);
    const inactif = await s.a.avecRoles(["consultant"]);
    await proprietaire((cl) =>
      cl.query("UPDATE utilisateurs SET actif = false WHERE id = $1", [inactif.utilisateurId]),
    );
    for (const [nom, id] of [
      ["portail", portail.utilisateurId],
      ["hors équipe", s.consultantHors.utilisateurId],
      ["gestionnaire (sans redressement.lire)", s.gestionnaire.utilisateurId],
      ["inactif", inactif.utilisateurId],
      ["inconnu", INCONNU],
    ] as const) {
      const r = await s.a.chef.post(urlD("/actions"), action({ responsable_id: id }));
      expect(r.statusCode, nom).toBe(400);
    }
    // L'expert métier lit le redressement mais ne voit pas la mission hors équipe : refusé aussi.
    expect(
      (await s.a.chef.post(urlD("/actions"), action({ responsable_id: s.expert.utilisateurId })))
        .statusCode,
    ).toBe(400);
  });

  it("tâche « Mes tâches » liée : exige tache.assigner (403 pour un consultant), pas de montant dans la tâche", async () => {
    expect(
      (await s.consultantEquipe.post(urlD("/actions"), action({ creer_tache: true }))).statusCode,
    ).toBe(403);
    const a = await creerAction(s.a.chef, {
      titre: "Négocier avec la banque",
      responsable_id: s.consultantEquipe.utilisateurId,
      creer_tache: true,
      levier: { code: "reduction_stocks", parametres: { reductionPb: 1500 } },
    });
    expect(a.tache_collaboration_id).toBeTruthy();
    const t = await proprietaire((cl) =>
      cl.query(
        "SELECT titre, description, entite_type, mission_id, assignee_id FROM taches_collaboration WHERE id = $1",
        [a.tache_collaboration_id],
      ),
    );
    expect(t.rows[0]).toMatchObject({
      // Titre neutre : le titre libre de l'action ne sort pas du module.
      titre: `Action de redressement n° ${a.numero}`,
      entite_type: "mission",
      mission_id: s.missionId,
      assignee_id: s.consultantEquipe.utilisateurId,
    });
    // Le chemin de la mission contient son UUID (parfois six chiffres de suite) : on l'écarte avant
    // de chercher un montant.
    const sansChemin = `${t.rows[0].titre} ${t.rows[0].description}`.replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
      "",
    );
    expect(sansChemin).not.toMatch(/\d{6,}/);
    // Le responsable est l'appelant : aucune notification d'action.
    const soi = await creerAction(s.a.chef, {
      titre: "Pour moi",
      responsable_id: s.a.chef.utilisateurId,
    });
    expect(soi.responsable.id).toBe(s.a.chef.utilisateurId);
  });
});

describe("kanban : modification, déplacements et transitions (routes 31 à 34)", () => {
  it("transitions : motif exigé pour bloquer ; date de fin pour terminer ; terminée figée ; commentaires", async () => {
    const a = await creerAction(s.a.chef, { titre: "Cycle de vie" });
    const dep = (id: string, corps: Record<string, unknown>) =>
      s.consultantEquipe.post(urlA(id, "/deplacement"), corps);
    expect((await dep(a.id, { statut: "en_cours", rang: 3 })).json()).toMatchObject({
      statut: "en_cours",
      rang: 3,
    });
    expect((await dep(a.id, { statut: "bloquee" })).statusCode).toBe(400);
    const bloquee = await dep(a.id, { statut: "bloquee", motif: "Attente du relevé bancaire" });
    expect(bloquee.json()).toMatchObject({
      statut: "bloquee",
      motif: "Attente du relevé bancaire",
    });
    const impossible = await dep(a.id, { statut: "terminee", termine_le: dans(-1) });
    expect(impossible.statusCode).toBe(409);
    expect(erreur(impossible)).toBe("RED_TRANSITION_INVALIDE");
    expect((await dep(a.id, { statut: "en_cours" })).json().statut).toBe("en_cours");
    expect((await dep(a.id, { statut: "terminee" })).statusCode).toBe(400);
    const finie = await dep(a.id, { statut: "terminee", termine_le: dans(-1) });
    expect(finie.json()).toMatchObject({ statut: "terminee", termine_le: dans(-1) });
    // Terminée : ne bouge plus, ne se modifie plus ; un commentaire reste admis.
    const rouvre = await dep(a.id, { statut: "en_cours" });
    expect(rouvre.statusCode).toBe(409);
    expect(erreur(rouvre)).toBe("RED_TRANSITION_INVALIDE");
    expect(
      (await dep(a.id, { statut: "terminee", rang: 9, termine_le: dans(-1) })).statusCode,
    ).toBe(409);
    expect((await s.a.chef.patch(urlA(a.id), { titre: "Autre" })).statusCode).toBe(409);
    const com = await s.a.chef.post(urlA(a.id, "/commentaires"), {
      commentaire: "Dossier clos avec la banque",
    });
    attendre(201, com, "commentaire");
    expect((await s.a.chef.post(urlA(a.id, "/commentaires"), { commentaire: "" })).statusCode).toBe(
      400,
    );
    const detail = (await s.a.chef.get(urlA(a.id))).json();
    expect(detail.evenements.map((e: { type: string }) => e.type)).toEqual([
      "commentaire",
      "statut",
      "statut",
      "statut",
      "statut",
      "creation",
    ]);
    // Abandon : motif exigé, état terminal.
    const b = await creerAction(s.a.chef, { titre: "À abandonner" });
    expect((await dep(b.id, { statut: "abandonnee" })).statusCode).toBe(400);
    expect((await dep(b.id, { statut: "abandonnee", motif: "Plus pertinent" })).json().statut).toBe(
      "abandonnee",
    );
    expect((await dep(b.id, { statut: "a_faire" })).statusCode).toBe(409);
    // Les événements ne se modifient pas (ajout seul).
    const refus = await proprietaire(async (cl) => {
      try {
        await cl.query("DELETE FROM red_action_evenements WHERE action_id = $1", [a.id]);
        return "aucun";
      } catch (e) {
        return (e as { code?: string }).code;
      }
    });
    expect(refus).toBe("MPZ01");
  });

  it("modification du contenu : champs, levier recalculé ou retiré, responsable revalidé, corps strict", async () => {
    const a = await creerAction(s.a.chef, {
      titre: "À modifier",
      levier: { code: "reduction_stocks", parametres: { reductionPb: 1500 } },
    });
    expect((await s.a.chef.patch(urlA(a.id), {})).statusCode).toBe(400);
    expect((await s.a.chef.patch(urlA(a.id), { exces: 1 })).statusCode).toBe(400);
    expect(
      (await s.a.chef.patch(urlA(a.id), { responsable_id: s.gestionnaire.utilisateurId }))
        .statusCode,
    ).toBe(400);
    const m = await s.consultantEquipe.patch(urlA(a.id), {
      titre: "Titre revu",
      echeance: dans(60),
      domaine: "activite",
      levier: { code: "reduction_stocks", parametres: { reductionPb: 500 } },
    });
    attendre(200, m, "modification");
    expect(m.json()).toMatchObject({
      titre: "Titre revu",
      echeance: dans(60),
      domaine: "activite",
    });
    expect(m.json().levier.impact.tresorerie_unique).toBe(6 * M);
    const sans = await s.a.chef.patch(urlA(a.id), { levier: null, description: "" });
    expect(sans.json().levier).toBeNull();
    expect(sans.json().description).toBeNull();
    expect((await s.consultantHors.patch(urlA(a.id), { titre: "x" })).statusCode).toBe(404);
  });
});

describe("plan, avancement et versions (routes 29, 35 et 36)", () => {
  let d: string;

  it("lecture : kanban par colonnes, avancement et anomalies par le moteur", async () => {
    d = (await preparerCasA(s, (await creerMission(s.a, { intitule: "Plan complet" })).id))
      .dossierId;
    const qw1 = await creerAction(s.a.chef, { titre: "QW terminé", echeance: dans(10) }, d);
    const qw2 = await creerAction(s.a.chef, { titre: "QW en retard", echeance: dans(-5) }, d);
    const re = await creerAction(
      s.a.chef,
      {
        titre: "Restructuration proche",
        volet: "restructuration",
        domaine: "financement",
        echeance: dans(40),
      },
      d,
    );
    await s.a.chef.post(urlA(qw1.id, "/deplacement"), { statut: "en_cours" });
    await s.a.chef.post(urlA(qw1.id, "/deplacement"), { statut: "terminee", termine_le: dans(-1) });
    const p = (await s.a.chef.get(urlD("/plan", d))).json();
    expect(p.kanban.colonnes.terminee.map((a: Json) => a.id)).toEqual([qw1.id]);
    expect(p.kanban.colonnes.a_faire.map((a: Json) => a.id).sort()).toEqual([qw2.id, re.id].sort());
    expect(p.kanban.colonnes.a_faire.find((a: Json) => a.id === qw2.id).en_retard).toBe(true);
    expect(p.kanban.abandonnees).toEqual([]);
    expect(p.evaluation.par_volet.quick_win).toMatchObject({
      total: 2,
      terminees: 1,
      abandonnees: 0,
      en_retard: 1,
      avancement_pb: 5000,
    });
    expect(p.evaluation.par_volet.restructuration).toMatchObject({
      total: 1,
      terminees: 0,
      avancement_pb: 0,
    });
    expect(p.evaluation.en_retard).toEqual([qw2.numero]);
    // Restructuration à 40 jours : avant la borne basse de six mois : avertissement non bloquant.
    expect(p.evaluation.anomalies).toEqual([
      { code: "RESTRUCTURATION_HORS_FENETRE", numero: re.numero, bloquante: false },
    ]);
    expect(p.evaluation.bloquants_validation).toEqual([]);
    expect(p.date_reference).toBe(dans(0));
    expect(p.versions).toEqual([]);
    expect(p.version_validee).toBeNull();
    expect(p.ecart_avec_version_validee).toBeNull();
  });

  it("version : contenu construit par le moteur, jamais reçu ; corps strict", async () => {
    expect((await s.a.chef.post(urlD("/plan/versions", d), { contenu: {} })).statusCode).toBe(400);
    const r = await s.a.chef.post(urlD("/plan/versions", d), {});
    attendre(201, r, "version");
    const v = r.json();
    expect(v).toMatchObject({
      version: 1,
      statut: "brouillon",
      date_reference: dans(0),
      valide_par: null,
      peut_valider: false,
    });
    expect(v.cree_par.id).toBe(s.a.chef.utilisateurId);
    expect(v.contenu.version).toBe(1);
    expect(v.contenu.actions).toHaveLength(3);
    expect(Object.keys(v.contenu.actions[0]).sort()).toEqual(
      [
        "domaine",
        "echeance",
        "impact_resultat_annuel",
        "impact_tresorerie_unique",
        "levier_code",
        "numero",
        "responsable_id",
        "titre",
        "volet",
      ].sort(),
    );
    // Ni statut ni rang dans le contenu : le kanban bouge librement.
    expect(JSON.stringify(v.contenu)).not.toContain("statut");
    const dir = (await s.a.directeur.get(urlD("/plan", d))).json();
    expect(dir.versions[0]).toMatchObject({ version: 1, peut_valider: true });
    expect(dir.versions[0].contenu).toBeUndefined();
    expect((await s.a.chef.get(urlD("/plan", d))).json().versions[0].peut_valider).toBe(false);
  });

  it("validation : réservée au directeur de la mission (chef 403, associé non directeur 403, créateur directeur 403, directeur 200) ; dossier plan validé", async () => {
    const d2 = (await creerMission(s.a, { intitule: "Plan validé" })).id;
    const dos = (await preparerCasA(s, d2)).dossierId;
    await creerAction(s.a.chef, { titre: "QW", echeance: dans(20) }, dos);
    const v = (await s.a.chef.post(urlD("/plan/versions", dos), {})).json();
    expect((await s.a.chef.post(urlV(v.id, "/validation"), {})).statusCode).toBe(403);
    expect((await s.consultantEquipe.post(urlV(v.id, "/validation"), {})).statusCode).toBe(403);
    expect((await s.a.directeur.post(urlV(v.id, "/validation"), { exces: 1 })).statusCode).toBe(
      400,
    );
    // Hypothèse métier à valider : un associé qui n'est pas le directeur de la mission ne valide pas.
    const associe = await s.a.associe.post(urlV(v.id, "/validation"), {});
    expect(associe.statusCode).toBe(403);
    expect(erreur(associe)).toBe("VALIDATION_RESERVEE_DIRECTEUR");
    expect(associe.json().erreur.message).toContain("directeur de la mission");
    expect((await s.associe2.post(urlV(v.id, "/validation"), {})).statusCode).toBe(403);
    const dir = (await s.a.directeur.get(urlD("/plan", dos))).json();
    expect(dir.versions[0].peut_valider).toBe(true);
    // Le confort d'affichage suit la même règle : faux pour l'associé non directeur.
    expect((await s.a.associe.get(urlD("/plan", dos))).json().versions[0].peut_valider).toBe(false);
    const ok = await s.a.directeur.post(urlV(v.id, "/validation"), {
      motif: "Plan relu avec le dirigeant",
    });
    attendre(200, ok, "validation");
    expect(ok.json()).toMatchObject({
      statut: "valide",
      motif: "Plan relu avec le dirigeant",
      peut_valider: false,
    });
    expect(ok.json().valide_par.id).toBe(s.a.directeur.utilisateurId);
    const dossier = (await s.a.chef.get(`/api/redressement/dossiers/${dos}`)).json();
    expect(dossier.statut).toBe("plan_valide");
    expect(dossier.plan).toMatchObject({ version_courante: 1, modifie_depuis_validation: false });
    const deja = await s.a.directeur.post(urlV(v.id, "/validation"), {});
    expect(deja.statusCode).toBe(409);
    expect(erreur(deja)).toBe("RED_TRANSITION_INVALIDE");
    // Mise en œuvre possible, une fois le plan validé.
    const mo = await s.a.chef.post(`/api/redressement/dossiers/${dos}/statut`, {
      statut: "mise_en_oeuvre",
    });
    expect(mo.statusCode).toBe(200);
    expect(mo.json().statut).toBe("mise_en_oeuvre");
    // Le plan validé reste comparable : un titre modifié apparaît dans l'écart.
    const actions = (await s.a.chef.get(urlD("/plan", dos))).json().kanban.colonnes.a_faire;
    await s.a.chef.patch(urlA(actions[0].id), { titre: "Titre modifié après validation" });
    const p = (await s.a.chef.get(urlD("/plan", dos))).json();
    expect(p.version_validee).toBe(v.id);
    expect(p.ecart_avec_version_validee).toEqual({
      ajoutees: [],
      retirees: [],
      modifiees: [actions[0].numero],
    });
    expect(
      (await s.a.chef.get(`/api/redressement/dossiers/${dos}`)).json().plan
        .modifie_depuis_validation,
    ).toBe(true);
  });

  it("le directeur créateur ne valide pas sa version (séparation) ; l'associé directeur est dispensé ; le journal ne porte aucun titre", async () => {
    // Directeur de mission non associé et créateur : séparation des tâches.
    const dosDir = (await preparerCasA(s, (await creerMission(s.a, { intitule: "Directeur" })).id))
      .dossierId;
    await creerAction(s.a.chef, { titre: "QW directeur", echeance: dans(20) }, dosDir);
    const vd = (await s.a.directeur.post(urlD("/plan/versions", dosDir), {})).json();
    const propre = await s.a.directeur.post(urlV(vd.id, "/validation"), {});
    expect(propre.statusCode).toBe(403);
    expect(erreur(propre)).toBe("SEPARATION_DES_TACHES");
    expect((await s.a.directeur.get(urlD("/plan", dosDir))).json().versions[0].peut_valider).toBe(
      false,
    );
    // Directeur de la mission = associé : créateur de sa version, il la valide (dispense).
    const dos = (
      await preparerCasA(
        s,
        (await creerMission(s.a, { intitule: "Associé", directeur_id: s.associe2.utilisateurId }))
          .id,
      )
    ).dossierId;
    await creerAction(s.a.chef, { titre: "Titre confidentiel du plan", echeance: dans(20) }, dos);
    const v = (await s.associe2.post(urlD("/plan/versions", dos), {})).json();
    attendre(200, await s.associe2.post(urlV(v.id, "/validation"), {}), "associé créateur");
    const j = await proprietaire((cl) =>
      cl.query("SELECT details::text AS d FROM journal_audit WHERE entite = 'red_plan_version'"),
    );
    for (const l of j.rows) expect(l.d).not.toContain("confidentiel");
  });

  it("mission sans directeur : 409 DIRECTEUR_REQUIS (API) et MPZ07 (base, 0492), même pour un associé", async () => {
    const dos = (
      await preparerCasA(
        s,
        (await creerMission(s.a, { intitule: "Sans directeur", directeur_id: null })).id,
      )
    ).dossierId;
    await creerAction(s.a.chef, { titre: "QW sans directeur", echeance: dans(20) }, dos);
    const v = (await s.a.chef.post(urlD("/plan/versions", dos), {})).json();
    // Rôle non habilité : 403 d'abord ; associé : 409 explicite.
    expect((await s.a.chef.post(urlV(v.id, "/validation"), {})).statusCode).toBe(403);
    expect((await s.a.associe.get(urlD("/plan", dos))).json().versions[0].peut_valider).toBe(false);
    const r = await s.a.associe.post(urlV(v.id, "/validation"), {});
    expect(r.statusCode).toBe(409);
    expect(erreur(r)).toBe("DIRECTEUR_REQUIS");
    expect(r.json().erreur.message).toContain("directeur de mission");
    const code = await proprietaire(async (cl) => {
      try {
        await cl.query(
          "UPDATE red_plan_versions SET statut = 'valide', valide_par = $2, valide_le = now() WHERE id = $1",
          [v.id, s.a.associeId],
        );
        return "aucun";
      } catch (e) {
        return (e as { code?: string }).code ?? "inconnu";
      }
    });
    expect(code).toBe("MPZ07");
  });

  it("RED_PLAN_MODIFIE : un changement des actions après la création invalide la version ; un déplacement de kanban, non", async () => {
    const dos = (await preparerCasA(s, (await creerMission(s.a, { intitule: "Plan modifié" })).id))
      .dossierId;
    const a = await creerAction(s.a.chef, { titre: "Action du plan", echeance: dans(20) }, dos);
    const v = (await s.a.chef.post(urlD("/plan/versions", dos), {})).json();
    // Statut et rang ne font pas partie du plan.
    await s.a.chef.post(urlA(a.id, "/deplacement"), { statut: "en_cours", rang: 7 });
    // Le titre en fait partie.
    await s.a.chef.patch(urlA(a.id), { titre: "Titre changé" });
    const r = await s.a.directeur.post(urlV(v.id, "/validation"), {});
    expect(r.statusCode).toBe(409);
    expect(erreur(r)).toBe("RED_PLAN_MODIFIE");
    // Version recréée : les déplacements postérieurs ne l'invalident pas.
    const v2 = (await s.a.chef.post(urlD("/plan/versions", dos), {})).json();
    expect(v2.version).toBe(2);
    await s.a.chef.post(urlA(a.id, "/deplacement"), {
      statut: "bloquee",
      rang: 1,
      motif: "Attente",
    });
    // L'ancienne version n'est plus la dernière.
    const obsolete = await s.a.directeur.post(urlV(v.id, "/validation"), {});
    expect(obsolete.statusCode).toBe(409);
    expect(erreur(obsolete)).toBe("RED_VERSION_NON_CONSECUTIVE");
    attendre(200, await s.a.directeur.post(urlV(v2.id, "/validation"), {}), "validation v2");
  });

  it("RED_PLAN_INCOMPLET : sans action, ou sans quick win, la version ne se valide pas", async () => {
    const dos = (await preparerCasA(s, (await creerMission(s.a, { intitule: "Plan vide" })).id))
      .dossierId;
    const vide = (await s.a.chef.post(urlD("/plan/versions", dos), {})).json();
    expect(vide.contenu.actions).toEqual([]);
    const r = await s.a.directeur.post(urlV(vide.id, "/validation"), {});
    expect(r.statusCode).toBe(409);
    expect(erreur(r)).toBe("RED_PLAN_INCOMPLET");
    expect(r.json().erreur.details.manquants).toEqual(["AUCUNE_ACTION", "AUCUN_QUICK_WIN"]);
    // Restructuration seule : AUCUN_QUICK_WIN.
    await creerAction(
      s.a.chef,
      { titre: "Restructurer", volet: "restructuration", echeance: dans(300) },
      dos,
    );
    const v2 = (await s.a.chef.post(urlD("/plan/versions", dos), {})).json();
    const r2 = await s.a.directeur.post(urlV(v2.id, "/validation"), {});
    expect(erreur(r2)).toBe("RED_PLAN_INCOMPLET");
    expect(r2.json().erreur.details.manquants).toEqual(["AUCUN_QUICK_WIN"]);
    // Un dossier sans plan validé ne passe pas en mise en œuvre.
    expect(
      (
        await s.a.chef.post(`/api/redressement/dossiers/${dos}/statut`, {
          statut: "mise_en_oeuvre",
        })
      ).statusCode,
    ).toBe(409);
  });

  it("dossier clos ou mission clôturée : plus d'écriture (409), lecture admise", async () => {
    const dos = (await preparerCasA(s, (await creerMission(s.a, { intitule: "Plan clos" })).id))
      .dossierId;
    const a = await creerAction(s.a.chef, { titre: "Avant clôture", echeance: dans(20) }, dos);
    attendre(
      200,
      await s.a.directeur.post(`/api/redressement/dossiers/${dos}/statut`, {
        statut: "clos",
        motif: "Abandon du dossier",
      }),
      "clos",
    );
    expect((await s.a.chef.post(urlD("/actions", dos), action())).statusCode).toBe(409);
    expect(
      (await s.a.chef.post(urlA(a.id, "/deplacement"), { statut: "en_cours" })).statusCode,
    ).toBe(409);
    expect((await s.a.chef.post(urlD("/plan/versions", dos), {})).statusCode).toBe(409);
    expect((await s.a.chef.get(urlD("/plan", dos))).statusCode).toBe(200);
    expect((await s.a.chef.get(urlA(a.id))).statusCode).toBe(200);
  });
});
