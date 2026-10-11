import { randomUUID } from "node:crypto";
import { briefSchema, type BriefApi, type ElementBriefApi } from "@missionpilot/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  FENETRE_BRIEF_MINUTES,
  REQUETES_BRIEF_PAR_FENETRE,
  reinitialiserDebitBrief,
  verifierDebitBrief,
} from "../src/brief/debit.js";
import { api, type Api } from "./api.js";
import {
  aFacturer,
  attendre,
  factureEmise,
  missionAvecEcheancier,
  preparerFacturation,
  type CabinetFacturation,
} from "./facturation-outils.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import { creerKpi, mesurer } from "./kpi-outils.js";
import { creerMissionSignee, preparerCabinet } from "./missions-outils.js";
import { inviterClient } from "./portail-outils.js";
import { utilisateurCollaborateur } from "./planification-outils.js";
import { affecter, lignesSemaine, missionTemps, saisirEtSoumettre } from "./temps-outils.js";

/*
 * Brief quotidien par rôle (AUT-07) : GET /api/brief. Calcul déterministe, dans les droits de
 * l'utilisateur : chaque rôle ne voit QUE ses sources (par permission), la visibilité des
 * missions s'applique, aucun montant sans `finance.lire` (FIN-02), jamais une validation que
 * l'utilisateur a rédigée, jamais de contenu client, isolation entre cabinets.
 */

const DATE_KPI = "2026-05-15";
const DATE_ECHUE = "2027-06-01";

let ctx: Contexte;
let a: CabinetFacturation;
let b: CabinetFacturation;
let m1: string;
let m2: string;
let m3: string; // atterrissage
let consultant: Awaited<ReturnType<typeof utilisateurCollaborateur>>;
let consultantHors: Api & { utilisateurId: string };
let ressources: Api & { utilisateurId: string };
let expertMetier: Api & { utilisateurId: string };
let expertExterne: Api & { utilisateurId: string };
let associe2: Awaited<ReturnType<typeof utilisateurCollaborateur>>;

const ids: Record<string, string> = {};

async function lire(par: Api, date?: string): Promise<BriefApi> {
  const r = await par.get(date ? `/api/brief?date=${date}` : "/api/brief");
  expect(r.statusCode, r.body).toBe(200);
  expect(briefSchema.safeParse(r.json()).success, r.body).toBe(true);
  return r.json() as BriefApi;
}
const tous = (br: BriefApi): ElementBriefApi[] => [
  ...br.familles.decider.elements,
  ...br.familles.deriver.elements,
  ...br.familles.envoyer.elements,
];
const duType = (br: BriefApi, type: string) => tous(br).filter((e) => e.type === type);
const idsDuType = (br: BriefApi, type: string) => duType(br, type).map((e) => e.entite_id);
const types = (br: BriefApi) => [...new Set(tous(br).map((e) => e.type))].sort();

const DEBOURS = {
  date: "2026-10-05",
  categorie: "transport",
  libelle: "Billet Abidjan-Bouaké LIBELLE-DEBOURS-INTERNE",
  montant: 45_000,
  refacturable: true,
};

async function deboursSoumis(par: Api, missionId: string): Promise<string> {
  const r = await par.post(`/api/missions/${missionId}/debours`, DEBOURS);
  attendre(201, r, "débours");
  attendre(200, await par.post(`/api/debours/${r.json().id}/soumettre`), "soumission");
  return r.json().id as string;
}

async function factureEnCours(
  c: CabinetFacturation,
  createur: Api,
  etat: "a_approuver" | "approuvee",
): Promise<{ id: string; missionId: string }> {
  const m = await missionAvecEcheancier(c);
  const echeance = m.echeances[0]?.id as string;
  await aFacturer(c.gestionnaire, echeance);
  const f = await createur.post(`/api/missions/${m.id}/factures`, { echeance_ids: [echeance] });
  attendre(201, f, "brouillon");
  attendre(200, await createur.post(`/api/factures/${f.json().id}/soumettre`), "soumission");
  if (etat === "approuvee") {
    attendre(200, await a.associe.post(`/api/factures/${f.json().id}/approuver`), "approbation");
  }
  return { id: f.json().id as string, missionId: m.id };
}

/** Opportunité ouverte et proposition en brouillon créée par le chef ; renvoie la proposition. */
async function opportuniteEtProposition(c: CabinetFacturation, intitule: string): Promise<string> {
  const o = await c.chef.post("/api/opportunites", {
    client_id: c.clientId,
    intitule,
    type_mission_id: c.typePlanId,
    montant_estime: 25_000_000,
  });
  attendre(201, o, "opportunité");
  const p = await c.chef.post(`/api/opportunites/${o.json().id}/propositions`, {});
  attendre(201, p, "proposition");
  return p.json().id as string;
}

/** Mission signée dont une tâche budgétée à 4 jours a 5 jours réalisés et validés (+25 %). */
async function missionEnDepassement(
  c: CabinetFacturation,
  par: Awaited<ReturnType<typeof utilisateurCollaborateur>>,
): Promise<string> {
  const m = await missionTemps(
    c,
    { Diagnostic: { senior: 4 } },
    { intitule: "Mission en dépassement" },
  );
  attendre(
    200,
    await c.directeur.post(`/api/missions/${m.id}/signer`, { date_signature: "2026-10-01" }),
    "signature",
  );
  await affecter(c, m, par.collaborateurId, { Diagnostic: 4 });
  const lundi = "2026-11-02";
  const feuille = await saisirEtSoumettre(
    par,
    lundi,
    lignesSemaine(lundi, [{ tache_id: m.taches.Diagnostic as string, jours: 5 }]),
  );
  attendre(200, await c.chef.post(`/api/feuilles-temps/${feuille}/valider`, {}), "validation");
  return m.id;
}

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerFacturation(ctx, "Brief A");
  b = await preparerFacturation(ctx, "Brief B");
  m1 = (await creerMissionSignee(a, { intitule: "Mission Brief Un" })).id;
  m2 = (await creerMissionSignee(a, { intitule: "Mission Brief Deux" })).id;
  consultant = await utilisateurCollaborateur(a, ["consultant"]);
  consultantHors = await a.avecRoles(["consultant"]);
  ressources = await a.avecRoles(["ressources"]);
  expertMetier = await a.avecRoles(["expert_metier"]);
  expertExterne = await a.avecRoles(["expert_externe"]);
  associe2 = await utilisateurCollaborateur(a, ["associe"]);
  attendre(
    201,
    await a.chef.post(`/api/missions/${m1}/equipe`, { utilisateur_id: consultant.utilisateurId }),
    "équipe",
  );

  // Débours : un du consultant, un du second associé (séparation des tâches).
  ids.debConsultant = await deboursSoumis(consultant, m1);
  ids.debAssocie2 = await deboursSoumis(associe2, m1);

  // Jalons en retard, un par mission.
  const jalons = await proprietaire(async (c) => {
    const sortie: string[] = [];
    for (const m of [m1, m2]) {
      const r = await c.query(
        `INSERT INTO mission_jalons (cabinet_id, mission_id, libelle, date_prevue, atteint)
         VALUES ($1, $2, 'Livraison du diagnostic', '2026-01-15', false) RETURNING id`,
        [a.cabinetId, m],
      );
      sortie.push(r.rows[0].id as string);
    }
    return sortie;
  });
  [ids.jalon1, ids.jalon2] = jalons as [string, string];

  // Tâche en retard du consultant ; sa description ne doit jamais ressortir.
  const tache = await a.chef.post("/api/taches-collaboration", {
    titre: "Relire le dossier",
    description: "VERBATIM-CLIENT-SECRET : le dirigeant dit que tout va mal",
    assignee_id: consultant.utilisateurId,
    echeance: "2026-03-01",
  });
  attendre(201, tache, "tâche");
  ids.tache = tache.json().id as string;

  // KPI : rouge en avril 2026 (700 pour une cible de 1200).
  const kpi = await creerKpi(a.chef, m1, { proprietaire_id: a.directeur.utilisateurId });
  attendre(
    201,
    await a.chef.post(`/api/kpi/${kpi.id}/cibles`, { valeur: 1200, a_partir_de: "2026-04-01" }),
    "cible",
  );
  for (const [date, valeur] of [
    ["2026-01-10", 1000],
    ["2026-02-28", 900],
    ["2026-03-31", 800],
    ["2026-04-30", 700],
  ] as const) {
    await mesurer(a.chef, kpi.id as string, date, valeur);
  }
  ids.kpi = kpi.id as string;

  // Factures : à approuver (soumise par le gestionnaire), à approuver soumise par l'associé,
  // approuvée à émettre, émise (à envoyer, puis échue à une date ultérieure).
  const f1 = await factureEnCours(a, a.gestionnaire, "a_approuver");
  ids.factureAApprouver = f1.id;
  const f2 = await factureEnCours(a, a.associe, "a_approuver");
  ids.factureDeAssocie = f2.id;
  const f3 = await factureEnCours(a, a.gestionnaire, "approuvee");
  ids.factureAEmettre = f3.id;
  const emise = await factureEmise(a);
  ids.factureEmise = emise.facture.id as string;

  // Congé demandé par le consultant.
  const conge = await consultant.post("/api/absences", {
    type: "conge_paye",
    date_debut: "2027-03-01",
    date_fin: "2027-03-02",
  });
  attendre(201, conge, "congé");
  ids.conge = conge.json().id as string;

  // Proposition à valider (chef) puis proposition validée à envoyer.
  const p1 = await opportuniteEtProposition(a, "Proposition Brief 1");
  attendre(200, await a.chef.post(`/api/propositions/${p1}/statut`, { statut: "a_valider" }), "p1");
  ids.propositionAValider = p1;
  const p2 = await opportuniteEtProposition(a, "Proposition Brief 2");
  attendre(200, await a.chef.post(`/api/propositions/${p2}/statut`, { statut: "a_valider" }), "p2");
  attendre(
    200,
    await a.associe.post(`/api/propositions/${p2}/statut`, { statut: "validee" }),
    "p2",
  );
  ids.propositionAEnvoyer = p2;

  // Clôture en attente et retour d'expérience en brouillon sur la mission 2 ; livrable en revue
  // (R3, auteur : le chef) sur la mission 1.
  await proprietaire(async (c) => {
    await c.query("UPDATE missions SET statut = 'a_cloturer' WHERE id = $1", [m2]);
    const r = await c.query(
      `INSERT INTO retours_experience (cabinet_id, mission_id, ouvert_par)
       VALUES ($1, $2, $3) RETURNING id`,
      [a.cabinetId, m2, a.chef.utilisateurId],
    );
    ids.retour = r.rows[0].id as string;
    const s = await c.query(
      `INSERT INTO qualite_suivis (cabinet_id, mission_id, type_livrable, livrable_id, libelle,
         classe_minimale, classe, statut, auteur_id, ouvert_par)
       VALUES ($1, $2, 'rapport', $3, 'Rapport de diagnostic', 'R3', 'R3', 'en_revue', $4, $4)
       RETURNING id`,
      [a.cabinetId, m1, randomUUID(), a.chef.utilisateurId],
    );
    ids.livrable = s.rows[0].id as string;
  });

  // Livrables : validé (à signer) et signé (à transmettre), auteur : le chef ; relance préparée.
  await proprietaire(async (c) => {
    for (const [cle, statut] of [
      ["livrableASigner", "valide"],
      ["livrableSigne", "signe"],
    ] as const) {
      const r = await c.query(
        `INSERT INTO qualite_suivis (cabinet_id, mission_id, type_livrable, livrable_id, libelle,
           classe_minimale, classe, statut, auteur_id, ouvert_par)
         VALUES ($1, $2, 'rapport', $3, 'Rapport final', 'R3', 'R3', $4, $5, $5)
         RETURNING id`,
        [a.cabinetId, m1, randomUUID(), statut, a.chef.utilisateurId],
      );
      ids[cle] = r.rows[0].id as string;
    }
    const relance = await c.query(
      `INSERT INTO relances_factures (cabinet_id, facture_id, niveau, mode, date_relance,
         jours_retard, destinataire_email, email_sujet, email_texte, email_envoye)
       VALUES ($1, $2, 1, 'automatique', '2026-12-15', 5, 'client@exemple.test',
         'Sujet RELANCE-SUJET', 'Texte RELANCE-CORPS', false) RETURNING id`,
      [a.cabinetId, ids.factureEmise],
    );
    ids.relance = relance.rows[0].id as string;
  });

  // Demande de pièces préparée (brouillon avec une pièce), pas encore envoyée.
  const demande = await a.chef.post(`/api/missions/${m1}/salle/demandes`, {
    titre: "Pièces du diagnostic",
  });
  attendre(201, demande, "demande de salle");
  ids.demandeSalle = demande.json().id as string;
  attendre(
    201,
    await a.chef.post(`/api/missions/${m1}/salle/demandes/${ids.demandeSalle}/pieces`, {
      libelle: "Bilans 2025",
    }),
    "pièce",
  );

  // Atterrissage : 4 jours budgétés, 5 jours réalisés et validés.
  m3 = await missionEnDepassement(a, consultant);
}, 240_000);
afterAll(() => ctx.fermer());

describe("accès à la route", () => {
  it("401 sans session", async () => {
    expect((await api(ctx).get("/api/brief")).statusCode).toBe(401);
  });

  it("403 pour un utilisateur du portail client", async () => {
    const dirigeant = await inviterClient(ctx, a.associe, a.clientId, ["client_dirigeant"]);
    const r = await dirigeant.get("/api/brief");
    expect(r.statusCode).toBe(403);
    expect(r.body).not.toContain("Mission Brief");
  });

  it("la réponse n'est jamais mise en cache et son schéma est strict", async () => {
    const r = await a.associe.get("/api/brief");
    expect(r.headers["cache-control"]).toBe("private, no-store");
    expect(briefSchema.safeParse(r.json()).success).toBe(true);
  });

  it("?date= est borné et validé ; un paramètre inconnu est refusé", async () => {
    for (const q of [
      "date=1999-12-31",
      "date=2101-01-01",
      "date=demain",
      "date=2026-02-30",
      "x=1",
    ]) {
      const r = await a.associe.get(`/api/brief?${q}`);
      expect(r.statusCode, q).toBe(400);
    }
    expect((await a.associe.get("/api/brief?date=2026-10-12")).statusCode).toBe(200);
  });
});

describe("par rôle : chacun ne voit que ses sources", () => {
  it("associé : décisions du cabinet, dérives et envois", async () => {
    const br = await lire(a.associe);
    const t = types(br);
    expect(t).toEqual(
      expect.arrayContaining([
        "facture_a_approuver",
        "debours_a_valider",
        "conge_a_valider",
        "proposition_a_valider",
        "cloture_en_attente",
        "retour_a_valider",
        "livrable_a_relire",
        "jalon_en_retard",
        "facture_a_emettre",
        "facture_a_envoyer",
        "proposition_a_envoyer",
      ]),
    );
    expect(idsDuType(br, "facture_a_approuver")).toEqual(
      expect.arrayContaining([ids.factureAApprouver]),
    );
    expect(idsDuType(br, "conge_a_valider")).toEqual([ids.conge]);
    expect(idsDuType(br, "proposition_a_valider")).toEqual([ids.propositionAValider]);
    expect(idsDuType(br, "proposition_a_envoyer")).toEqual([ids.propositionAEnvoyer]);
    expect(idsDuType(br, "cloture_en_attente")).toEqual([m2]);
    expect(idsDuType(br, "retour_a_valider")).toEqual([ids.retour]);
    expect(idsDuType(br, "livrable_a_relire")).toEqual([ids.livrable]);
    expect(idsDuType(br, "facture_a_emettre")).toEqual([ids.factureAEmettre]);
    expect(idsDuType(br, "facture_a_envoyer")).toContain(ids.factureEmise);
    expect(br.vide).toBe(false);
    expect(br.total).toBe(
      br.familles.decider.total + br.familles.deriver.total + br.familles.envoyer.total,
    );
  });

  it("chef de mission : débours à valider, jalons, KPI ; ni facture à approuver ni clôture", async () => {
    const br = await lire(a.chef);
    const t = types(br);
    expect(t).toEqual(
      expect.arrayContaining(["debours_a_valider", "jalon_en_retard", "retour_a_valider"]),
    );
    for (const absent of ["facture_a_approuver", "cloture_en_attente", "conge_a_valider"]) {
      expect(t).not.toContain(absent);
    }
    // Il a rédigé le livrable en revue : on ne lui demande pas de le relire.
    expect(t).not.toContain("livrable_a_relire");
    expect(idsDuType(br, "debours_a_valider").sort()).toEqual(
      [ids.debConsultant, ids.debAssocie2].sort(),
    );
  });

  it("directeur de mission : clôture à décider et retour d'expérience", async () => {
    const br = await lire(a.directeur);
    expect(idsDuType(br, "cloture_en_attente")).toEqual([m2]);
    expect(idsDuType(br, "retour_a_valider")).toEqual([ids.retour]);
    expect(types(br)).not.toContain("conge_a_valider");
  });

  it("consultant de l'équipe : sa tâche, les jalons et KPI de sa mission seulement", async () => {
    const br = await lire(consultant);
    expect(idsDuType(br, "tache_en_retard")).toEqual([ids.tache]);
    expect(idsDuType(br, "jalon_en_retard")).toEqual([ids.jalon1]);
    for (const e of tous(br)) {
      if (e.mission_id !== null) expect([m1, m3]).toContain(e.mission_id);
    }
    // Il n'a décidé de rien : ni débours, ni facture, ni congé à valider.
    for (const absent of [
      "debours_a_valider",
      "facture_a_approuver",
      "conge_a_valider",
      "cloture_en_attente",
      "retour_a_valider",
      "proposition_a_valider",
    ]) {
      expect(types(br)).not.toContain(absent);
    }
  });

  it("gestionnaire : factures à émettre, à envoyer ; ni KPI ni débours à valider", async () => {
    const br = await lire(a.gestionnaire);
    const t = types(br);
    expect(t).toEqual(expect.arrayContaining(["facture_a_emettre", "facture_a_envoyer"]));
    for (const absent of ["kpi_rouge", "debours_a_valider", "facture_a_approuver"]) {
      expect(t).not.toContain(absent);
    }
    expect(idsDuType(br, "facture_a_emettre")).toEqual([ids.factureAEmettre]);
  });

  it("ressources : congés à valider seulement (ni finance, ni mission, ni KPI)", async () => {
    const br = await lire(ressources);
    expect(idsDuType(br, "conge_a_valider")).toEqual([ids.conge]);
    for (const absent of [
      "facture_a_emettre",
      "debours_a_valider",
      "kpi_rouge",
      "tache_en_retard",
    ]) {
      expect(types(br)).not.toContain(absent);
    }
  });

  it("expert externe : ses tâches seulement", async () => {
    const t = await a.chef.post("/api/taches-collaboration", {
      titre: "Relecture externe",
      assignee_id: expertExterne.utilisateurId,
      echeance: "2026-03-01",
    });
    attendre(201, t, "tâche externe");
    const br = await lire(expertExterne);
    expect(types(br)).toEqual(["tache_en_retard"]);
    expect(idsDuType(br, "tache_en_retard")).toEqual([t.json().id]);
    expect(br.familles.decider.total).toBe(0);
    expect(br.familles.envoyer.total).toBe(0);
  });

  it("expert métier hors de la mission : ne voit rien de la mission 1", async () => {
    const br = await lire(expertMetier);
    expect(types(br)).not.toContain("livrable_a_relire");
    for (const e of tous(br)) expect(e.mission_id).not.toBe(m1);
  });
});

describe("visibilité des missions", () => {
  it("un consultant hors équipe ne voit rien des missions 1 et 2", async () => {
    const br = await lire(consultantHors);
    for (const e of tous(br)) {
      expect([m1, m2, m3]).not.toContain(e.mission_id);
    }
    expect(types(br)).not.toContain("jalon_en_retard");
    expect(types(br)).not.toContain("kpi_rouge");
    expect(br.vide).toBe(true);
  });

  it("le consultant de l'équipe ne voit pas le jalon de la mission 2", async () => {
    const br = await lire(consultant);
    expect(idsDuType(br, "jalon_en_retard")).not.toContain(ids.jalon2);
  });
});

describe("séparation des tâches", () => {
  it("on ne propose pas de valider un débours qu'on a soumis", async () => {
    const br = await lire(associe2);
    expect(idsDuType(br, "debours_a_valider")).toEqual([ids.debConsultant]);
    // L'autre associé voit les deux.
    const premier = await lire(a.associe);
    expect(idsDuType(premier, "debours_a_valider").sort()).toEqual(
      [ids.debConsultant, ids.debAssocie2].sort(),
    );
  });

  it("on ne propose pas d'approuver une facture qu'on a créée et soumise", async () => {
    const br = await lire(a.associe);
    expect(idsDuType(br, "facture_a_approuver")).not.toContain(ids.factureDeAssocie);
    expect(idsDuType(br, "facture_a_approuver")).toContain(ids.factureAApprouver);
    const second = await lire(associe2);
    expect(idsDuType(second, "facture_a_approuver").sort()).toEqual(
      [ids.factureAApprouver, ids.factureDeAssocie].sort(),
    );
  });

  it("l'auteur du livrable en revue ne le relit pas, un autre associé oui", async () => {
    expect(idsDuType(await lire(a.chef), "livrable_a_relire")).toEqual([]);
    expect(idsDuType(await lire(associe2), "livrable_a_relire")).toEqual([ids.livrable]);
  });
});

describe("dérives", () => {
  it("KPI au rouge, ordonné par gravité puis ancienneté (le moteur ordonne)", async () => {
    const br = await lire(a.chef, DATE_KPI);
    const kpi = duType(br, "kpi_rouge");
    expect(kpi).toHaveLength(1);
    expect(kpi[0]).toMatchObject({
      entite_id: ids.kpi,
      mission_id: m1,
      gravite: "haute",
      anciennete_jours: 15,
      lien: `/missions/${m1}/kpi/${ids.kpi}`,
    });
    const derive = br.familles.deriver.elements;
    const rangs = { haute: 3, moyenne: 2, basse: 1 };
    for (let i = 1; i < derive.length; i++) {
      const prec = derive[i - 1] as ElementBriefApi;
      const cour = derive[i] as ElementBriefApi;
      expect(rangs[prec.gravite]).toBeGreaterThanOrEqual(rangs[cour.gravite]);
      if (prec.gravite === cour.gravite) {
        expect(prec.anciennete_jours).toBeGreaterThanOrEqual(cour.anciennete_jours);
      }
    }
    // Un KPI à l'orange deux périodes de suite (février et mars) à la mi-avril.
    const avril = await lire(a.chef, "2026-04-15");
    expect(duType(avril, "kpi_orange_consecutif")).toHaveLength(1);
    expect(duType(avril, "kpi_rouge")).toHaveLength(0);
  });

  it("atterrissage au-delà de 5 % : en jours, sans aucun montant", async () => {
    const br = await lire(a.chef);
    const e = duType(br, "atterrissage_depasse");
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ mission_id: m3, gravite: "haute", ecart_pct: 25 });
    expect(e[0]?.libelle).toContain("+25 %");
    expect("montant" in (e[0] as object)).toBe(false);
  });

  it("jalon et tâche en retard : retard calculé à la date de référence", async () => {
    const br = await lire(consultant, "2026-03-05");
    const tache = duType(br, "tache_en_retard")[0] as ElementBriefApi;
    expect(tache.anciennete_jours).toBe(4);
    expect(tache.gravite).toBe("moyenne");
    // Avant l'échéance : rien.
    expect(duType(await lire(consultant, "2026-02-28"), "tache_en_retard")).toHaveLength(0);
  });

  it("facture échue : montant avec finance.lire seulement (FIN-02), jamais déduit", async () => {
    const [gestionnaire, associe, chef, directeur] = await Promise.all([
      lire(a.gestionnaire, DATE_ECHUE),
      lire(a.associe, DATE_ECHUE),
      lire(a.chef, DATE_ECHUE),
      lire(a.directeur, DATE_ECHUE),
    ]);
    for (const br of [gestionnaire, associe]) {
      const e = duType(br, "facture_echue").find((x) => x.entite_id === ids.factureEmise);
      expect(e, "facture échue").toBeDefined();
      expect(e?.gravite).toBe("haute");
      expect(e?.montant).toBeGreaterThan(0);
      expect(e?.devise).toBe("XOF");
    }
    for (const br of [chef, directeur]) {
      const e = duType(br, "facture_echue").find((x) => x.entite_id === ids.factureEmise);
      expect(e, "le nombre reste visible").toBeDefined();
      expect("montant" in (e as object)).toBe(false);
      expect("devise" in (e as object)).toBe(false);
    }
    // Aucun champ financier nulle part dans la réponse sans finance.lire.
    const brut = (await a.chef.get(`/api/brief?date=${DATE_ECHUE}`)).body;
    expect(brut).not.toMatch(/"montant"|"devise"|"cout|"taux|"marge/);
    // Avant l'échéance, la facture n'est pas échue.
    expect(
      duType(await lire(a.associe), "facture_echue").find((x) => x.entite_id === ids.factureEmise),
    ).toBeUndefined();
  });
});

describe("prêt à envoyer", () => {
  it("relance préparée, demande de pièces, livrable signé : selon les droits, sans texte d'e-mail", async () => {
    const gestionnaire = await lire(a.gestionnaire);
    expect(idsDuType(gestionnaire, "relance_prete")).toEqual([ids.relance]);
    expect(duType(gestionnaire, "relance_prete")[0]).toMatchObject({
      famille: "envoyer",
      montant: expect.any(Number),
      devise: "XOF",
    });
    const chef = await lire(a.chef);
    expect(types(chef)).not.toContain("relance_prete");
    expect(idsDuType(chef, "demande_salle_a_envoyer")).toEqual([ids.demandeSalle]);
    expect(idsDuType(chef, "livrable_signe")).toEqual([ids.livrableSigne]);
    expect(idsDuType(await lire(consultant), "demande_salle_a_envoyer")).toEqual([
      ids.demandeSalle,
    ]);
    expect(types(await lire(consultant))).not.toContain("livrable_signe");
    expect(types(await lire(consultantHors))).not.toContain("demande_salle_a_envoyer");
    for (const par of [a.gestionnaire, a.chef, a.associe]) {
      const brut = (await par.get("/api/brief")).body;
      expect(brut).not.toContain("RELANCE-SUJET");
      expect(brut).not.toContain("RELANCE-CORPS");
      expect(brut).not.toContain("client@exemple.test");
    }
  });

  it("une relance préparée reste signalée tant que la facture est due, à la date de rejeu", async () => {
    expect(idsDuType(await lire(a.gestionnaire, DATE_ECHUE), "relance_prete")).toEqual([
      ids.relance,
    ]);
  });

  it("livrable validé à signer : directeur et associé, jamais le chef (pas 'qualite.signer')", async () => {
    expect(idsDuType(await lire(a.directeur), "livrable_a_signer")).toEqual([ids.livrableASigner]);
    expect(idsDuType(await lire(a.associe), "livrable_a_signer")).toEqual([ids.livrableASigner]);
    expect(types(await lire(a.chef))).not.toContain("livrable_a_signer");
  });

  it("montants des factures à émettre : finance.lire seulement", async () => {
    const gestionnaire = await lire(a.gestionnaire);
    expect(duType(gestionnaire, "facture_a_emettre")[0]?.montant).toBeGreaterThan(0);
    const directeur = await lire(a.directeur);
    for (const e of duType(directeur, "facture_a_emettre")) {
      expect("montant" in e).toBe(false);
    }
  });
});

describe("contenu client", () => {
  it("aucun texte libre ni verbatim n'est recopié dans le brief", async () => {
    for (const par of [a.associe, a.chef, consultant, a.gestionnaire]) {
      const brut = (await par.get("/api/brief")).body;
      expect(brut).not.toContain("VERBATIM-CLIENT-SECRET");
      expect(brut).not.toContain("LIBELLE-DEBOURS-INTERNE");
      expect(brut).not.toContain("Billet Abidjan");
    }
  });
});

describe("bornage", () => {
  it("10 éléments par famille, total réel et indicateur tronque", async () => {
    const u = await a.avecRoles(["expert_externe"]);
    for (let i = 0; i < 12; i++) {
      attendre(
        201,
        await a.chef.post("/api/taches-collaboration", {
          titre: `Tâche en retard ${i}`,
          assignee_id: u.utilisateurId,
          echeance: "2026-03-01",
        }),
        "tâche",
      );
    }
    const br = await lire(u);
    expect(br.familles.deriver.elements).toHaveLength(10);
    expect(br.familles.deriver.total).toBe(12);
    expect(br.familles.deriver.tronque).toBe(true);
    expect(br.total).toBe(12);
    expect(br.familles.decider).toEqual({ total: 0, tronque: false, elements: [] });
  });
});

describe("brief vide et isolation entre cabinets", () => {
  it("un cabinet sans rien à signaler : brief vide, explicite", async () => {
    const br = await lire(b.associe);
    expect(br.vide).toBe(true);
    expect(br.total).toBe(0);
    for (const f of ["decider", "deriver", "envoyer"] as const) {
      expect(br.familles[f]).toEqual({ total: 0, tronque: false, elements: [] });
    }
  });

  it("un autre cabinet ne voit rien du cabinet A, même à une date de rejeu", async () => {
    for (const date of [undefined, DATE_KPI, DATE_ECHUE]) {
      const br = await lire(b.associe, date);
      const brut = JSON.stringify(br);
      for (const id of [m1, m2, m3, ...Object.values(ids)]) expect(brut).not.toContain(id);
      expect(br.total).toBe(0);
    }
  });
});

describe("feuille de temps non soumise", () => {
  it("les deux dernières semaines non soumises, depuis l'arrivée du collaborateur", async () => {
    const ancien = await utilisateurCollaborateur(a, ["consultant"]);
    const recent = await utilisateurCollaborateur(a, ["consultant"]);
    await proprietaire(async (c) => {
      await c.query("UPDATE collaborateurs SET cree_le = '2026-01-01' WHERE id = $1", [
        ancien.collaborateurId,
      ]);
      await c.query("UPDATE collaborateurs SET cree_le = '2026-10-08' WHERE id = $1", [
        recent.collaborateurId,
      ]);
    });
    // Un lundi : les semaines du 28 septembre et du 5 octobre ne sont pas soumises.
    const br = await lire(ancien, "2026-10-12");
    const feuilles = duType(br, "feuille_non_soumise").sort((x, y) =>
      x.entite_id.localeCompare(y.entite_id),
    );
    expect(feuilles.map((f) => f.entite_id)).toEqual([
      `${ancien.collaborateurId}:2026-09-28`,
      `${ancien.collaborateurId}:2026-10-05`,
    ]);
    expect(feuilles.map((f) => f.anciennete_jours)).toEqual([10, 3]);
    expect(feuilles.map((f) => f.gravite)).toEqual(["moyenne", "moyenne"]);
    expect(feuilles[1]).toMatchObject({
      famille: "deriver",
      mission_id: null,
      lien: "/temps?semaine=2026-10-05",
      libelle: "Feuille de temps non soumise : semaine du 05/10/2026 (3 jours de retard)",
    });
    // Arrivé le jeudi 8 octobre : la semaine du 28 septembre ne le concerne pas.
    const arrive = duType(await lire(recent, "2026-10-12"), "feuille_non_soumise");
    expect(arrive.map((f) => f.entite_id)).toEqual([`${recent.collaborateurId}:2026-10-05`]);
    // Deux semaines plus tard, la semaine du 28 septembre n'est plus examinée.
    const plus = duType(await lire(ancien, "2026-10-26"), "feuille_non_soumise");
    expect(plus.map((f) => f.entite_id)).toEqual(
      [`${ancien.collaborateurId}:2026-10-12`, `${ancien.collaborateurId}:2026-10-19`].sort(),
    );
  });
});

describe("clôture : séparation des tâches MPX03 (la clôture proposée est une clôture permise)", () => {
  async function missionACloturer(intitule: string): Promise<string> {
    const m = (await creerMissionSignee(a, { intitule })).id;
    await proprietaire((c) =>
      c.query("UPDATE missions SET statut = 'a_cloturer' WHERE id = $1", [m]),
    );
    return m;
  }
  const deroger = (mission: string, action: "accordee" | "retiree", par: string) =>
    proprietaire((c) =>
      c.query(
        `INSERT INTO cloture_derogations (cabinet_id, mission_id, controle, action, motif, par)
         VALUES ($1, $2, 'temps_valides', $3, 'Motif de test suffisamment long', $4)`,
        [a.cabinetId, mission, action, par],
      ),
    );

  it("le directeur non associé qui a accordé une dérogation en vigueur ne se voit pas proposer la clôture ; l'associé, si", async () => {
    const m = await missionACloturer("Clôture avec dérogation du directeur");
    await deroger(m, "accordee", a.directeur.utilisateurId);
    const directeur = await lire(a.directeur);
    expect(idsDuType(directeur, "cloture_en_attente")).not.toContain(m);
    // L'autre mission à clôturer (sans dérogation) lui reste proposée.
    expect(idsDuType(directeur, "cloture_en_attente")).toContain(m2);
    const associe = await lire(a.associe);
    expect(idsDuType(associe, "cloture_en_attente")).toEqual(expect.arrayContaining([m, m2]));
  });

  it("une dérogation retirée n'est plus en vigueur : la clôture est de nouveau proposée", async () => {
    const m = await missionACloturer("Clôture avec dérogation retirée");
    await deroger(m, "accordee", a.directeur.utilisateurId);
    expect(idsDuType(await lire(a.directeur), "cloture_en_attente")).not.toContain(m);
    await deroger(m, "retiree", a.associeId);
    expect(idsDuType(await lire(a.directeur), "cloture_en_attente")).toContain(m);
  });

  it("la dérogation d'un associé n'empêche pas le directeur de clore", async () => {
    const m = await missionACloturer("Clôture avec dérogation de l'associé");
    await deroger(m, "accordee", a.associeId);
    expect(idsDuType(await lire(a.directeur), "cloture_en_attente")).toContain(m);
  });
});

describe("totaux « restants » des sources filtrées en code ou bornées", () => {
  it("250 missions actives sans dérive : aucun élément fantôme, la famille est seulement tronquée", async () => {
    const c = await preparerCabinet(ctx, "Brief masse");
    const modele = (await creerMissionSignee(c, { intitule: "Mission modèle" })).id;
    await proprietaire((cl) =>
      cl.query(
        `INSERT INTO missions (cabinet_id, intitule, client_id, directeur_id, chef_id,
           mode_facturation, statut, date_signature, signee_par, taux_change, devise_reference,
           cree_par)
         SELECT cabinet_id, 'Mission de masse ' || g, client_id, directeur_id, chef_id,
           mode_facturation, 'en_cours', date_signature, signee_par, taux_change,
           devise_reference, cree_par
         FROM missions, generate_series(1, 250) g WHERE id = $1`,
        [modele],
      ),
    );
    const br = await lire(c.associe);
    // 251 missions actives, 100 lues : aucune n'est une dérive, aucune ne doit être comptée.
    expect(br.familles.deriver.total).toBe(0);
    expect(br.familles.deriver.elements).toEqual([]);
    expect(br.familles.deriver.tronque).toBe(true);
    expect(br.total).toBe(0);
    // Les familles dont toutes les sources sont lues en entier ne sont pas tronquées.
    expect(br.familles.decider.tronque).toBe(false);
    expect(br.familles.envoyer.tronque).toBe(false);
  });

  it("une source lue en entier ne marque pas la famille tronquée (cabinet A, dérives réelles)", async () => {
    const br = await lire(a.associe);
    expect(br.familles.deriver.tronque).toBe(false);
  });
});

describe("plafond de débit de GET /api/brief (429)", () => {
  it("au plus REQUETES_BRIEF_PAR_FENETRE appels par utilisateur et par fenêtre, par utilisateur", async () => {
    const u = await a.avecRoles(["expert_externe"]);
    for (let i = 0; i < REQUETES_BRIEF_PAR_FENETRE; i++) {
      const r = await u.get("/api/brief");
      expect(r.statusCode, `appel ${i + 1} : ${r.body}`).toBe(200);
    }
    const refuse = await u.get("/api/brief");
    expect(refuse.statusCode).toBe(429);
    expect(refuse.json().erreur.code).toBe("TROP_DE_REQUETES_BRIEF");
    expect(refuse.json().erreur.message).toMatch(/consultations du brief/);
    // Un autre utilisateur (même cabinet) n'est pas touché.
    expect((await a.chef.get("/api/brief")).statusCode).toBe(200);
    // Le refus ne compte pas : après remise à zéro, l'utilisateur lit de nouveau.
    reinitialiserDebitBrief();
    expect((await u.get("/api/brief")).statusCode).toBe(200);
  }, 120_000);

  it("fenêtre glissante : un appel sort de la fenêtre après FENETRE_BRIEF_MINUTES minutes", () => {
    reinitialiserDebitBrief();
    const id = randomUUID();
    const t0 = Date.UTC(2026, 9, 12, 8, 0, 0);
    for (let i = 0; i < REQUETES_BRIEF_PAR_FENETRE; i++) verifierDebitBrief(id, t0 + i);
    expect(() => verifierDebitBrief(id, t0 + 1_000)).toThrow(/consultations du brief/);
    // Dix minutes plus tard (et une milliseconde), la fenêtre a glissé au-delà des premiers appels.
    const apres = t0 + FENETRE_BRIEF_MINUTES * 60_000 + REQUETES_BRIEF_PAR_FENETRE;
    expect(() => verifierDebitBrief(id, apres)).not.toThrow();
    reinitialiserDebitBrief();
  });
});
