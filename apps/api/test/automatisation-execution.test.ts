import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { detecterEvenements } from "../src/automatisation/detection.js";
import { brancherDiagnostic } from "../src/automatisation/diagnostic.js";
import { publierEvenement } from "../src/automatisation/evenements.js";
import { traiterEvenement } from "../src/automatisation/execution.js";
import { WorkerJobs } from "../src/jobs/worker.js";
import type { Auth } from "../src/auth/contexte.js";
import type { Mailer } from "../src/notifications/mailer.js";
import type { Api } from "./api.js";
import {
  attendre,
  missionAvecEcheancier,
  preparerFacturation,
  type CabinetFacturation,
} from "./facturation-outils.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import { creerKpi, mesurer } from "./kpi-outils.js";
import { creerMission, preparerCabinet, type CabinetMissions } from "./missions-outils.js";
import { inviterClient } from "./portail-outils.js";
import { envoyer, versionValidee } from "./questionnaires-outils.js";

/*
 * Exécution des automatisations (AUT-01, AUT-02, AUT-05, AUT-06) : publication idempotente et
 * non bloquante, événement publié par la base (jalon atteint), traitement asynchrone par la
 * file `jobs`, garde des actions (N4 réservé à R0 et coupe-circuits, niveau des agents),
 * journal, annulation, brouillons tracés, détection des événements nés du temps.
 */

let ctx: Contexte;
let f: CabinetFacturation;
let autre: CabinetMissions;

beforeAll(async () => {
  ctx = await demarrer();
  f = await preparerFacturation(ctx, "Automatisation exécution");
  autre = await preparerCabinet(ctx, "Automatisation autre");
});

afterAll(async () => {
  await ctx.fermer();
});

/**
 * Exécute tous les jobs prêts (e-mails en file compris), dans l'ordre de la file. L'horloge du
 * worker avance d'une minute : un job mis en file par la base (`now()` du serveur PostgreSQL)
 * est prêt même si l'horloge du conteneur devance celle de la machine.
 */
async function viderFile(): Promise<void> {
  const worker = new WorkerJobs(ctx.db, {
    mailer: ctx.app.mailer as Mailer,
    horloge: () => new Date(Date.now() + 60_000),
  });
  for (let i = 0; i < 2000; i++) if (!(await worker.traiterUn())) return;
  throw new Error("File de jobs non vidée.");
}

/** Traite les jobs jusqu'au traitement d'un événement inclus (les appels d'agents restent en file). */
async function traiterJusquAuxEvenements(): Promise<void> {
  const worker = new WorkerJobs(ctx.db, {
    mailer: ctx.app.mailer as Mailer,
    horloge: () => new Date(Date.now() + 60_000),
  });
  for (let i = 0; i < 2000; i++) {
    const r = await worker.traiterUn();
    if (!r) throw new Error("Aucun job d'événement trouvé.");
    if (r.type === "automatisation_evenement") return;
  }
  throw new Error("File de jobs non vidée.");
}

function authDe(id: string, roles: Auth["roles"], cabinetId = f.cabinetId): Auth {
  return { utilisateurId: id, cabinetId, email: "x@exemple.test", nom: "Test", roles };
}

async function activerStandard(par: Api, code: string): Promise<string> {
  const r = await par.post(`/api/automatisations/standard/${code}`);
  attendre(201, r, "standard");
  attendre(200, await par.post(`/api/automatisations/${r.json().id}/activer`), "activation");
  return r.json().id as string;
}

async function executions(par: Api, automatisationId: string) {
  const r = await par.get(`/api/automatisations/executions?automatisation_id=${automatisationId}`);
  attendre(200, r, "journal");
  return r.json().elements as {
    id: string;
    issue: string;
    actions: {
      id: string;
      type: string;
      statut: string;
      code: string | null;
      refus: string[];
      entite_id: string | null;
    }[];
  }[];
}

describe("publication d'un événement", () => {
  it("idempotente, contenu validé, non bloquante, jamais depuis le portail", async () => {
    const m = await creerMission(f);
    const auth = authDe(f.associeId, ["associe"]);
    const r = await ctx.db.withTenant(f.cabinetId, async (db) => {
      const e = {
        code: "mission.cloture_demandee" as const,
        payload: { mission_id: m.id },
        cle: m.id,
      };
      const premier = await publierEvenement(db, auth, e);
      const second = await publierEvenement(db, "systeme", e);
      const invalide = await publierEvenement(db, auth, {
        code: "mission.cloture_demandee",
        payload: { mission_id: m.id, montant: 12 },
        cle: "x",
      });
      const inconnu = await publierEvenement(db, auth, {
        code: "facture.payee" as never,
        payload: {},
        cle: "x",
      });
      const cle = await publierEvenement(db, auth, { ...e, cle: "a b" });
      // Mission d'un autre cabinet : la référence échoue, la transaction du module continue.
      const etrangere = await publierEvenement(db, auth, {
        ...e,
        payload: { mission_id: "00000000-0000-4000-8000-000000000000" },
        cle: "etrangere",
      });
      const encore = await db.query("SELECT 1 AS ok");
      return { premier, second, invalide, inconnu, cle, etrangere, ok: encore.rows[0].ok };
    });
    expect(r.premier).toMatchObject({ nouveau: true, en_file: false, erreur: null });
    expect(r.second).toEqual({ ...r.premier, nouveau: false });
    expect(r.invalide.erreur).toBe("PAYLOAD_INVALIDE");
    expect(r.inconnu.erreur).toBe("EVENEMENT_INCONNU");
    expect(r.cle.erreur).toBe("CLE_INVALIDE");
    expect(r.etrangere.erreur).toBe("ERREUR_PUBLICATION");
    expect(r.ok).toBe(1);
    const lignes = await proprietaire((c) =>
      c.query("SELECT source, acteur_id FROM automatisation_evenements WHERE cle = $1", [
        `mission.cloture_demandee:${m.id}`,
      ]),
    );
    expect(lignes.rows).toEqual([{ source: "utilisateur", acteur_id: f.associeId }]);
    await expect(
      ctx.db.withTenant(f.cabinetId, (db) =>
        db.query("UPDATE automatisation_evenements SET cle = 'x' WHERE cle = $1", [
          `mission.cloture_demandee:${m.id}`,
        ]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });
});

describe("diagnostic des incidents", () => {
  it("consigne côté serveur le motif d'une publication en erreur, sans le contenu", async () => {
    const m = await creerMission(f);
    const inconnue = "00000000-0000-4000-8000-0000000000aa";
    const entrees: Record<string, unknown>[] = [];
    const debrancher = brancherDiagnostic((entree) => entrees.push(entree));
    try {
      const r = await ctx.db.withTenant(f.cabinetId, (db) =>
        publierEvenement(db, "systeme", {
          code: "mission.cloture_demandee",
          payload: { mission_id: inconnue },
          cle: `diagnostic:${m.id}`,
        }),
      );
      expect(r.erreur).toBe("ERREUR_PUBLICATION");
    } finally {
      debrancher();
    }
    expect(entrees).toHaveLength(1);
    expect(entrees[0]).toMatchObject({
      contexte: "publication",
      evenement: "mission.cloture_demandee",
      code: "23503",
    });
    expect(entrees[0]?.constraint).toEqual(expect.any(String));
    // Ni l'identifiant reçu (le `detail` de PostgreSQL le citerait), ni le contenu.
    expect(JSON.stringify(entrees[0])).not.toContain(inconnue);
  });
});

describe("jalon atteint → facture en brouillon (standard), journal et annulation", () => {
  it("de bout en bout, dans les droits du compte d'automatisation", async () => {
    const autoId = await activerStandard(f.associe, "jalon_facture_brouillon");
    const m = await missionAvecEcheancier(f);
    const j = await f.chef.post(`/api/missions/${m.id}/jalons`, {
      libelle: "Rapport de diagnostic",
    });
    attendre(201, j, "jalon");
    const echeance = m.echeances[0] as { id: string };
    attendre(
      200,
      await f.gestionnaire.patch(`/api/echeances/${echeance.id}`, { jalon_id: j.json().id }),
      "rattachement",
    );
    attendre(
      200,
      await f.chef.patch(`/api/missions/${m.id}/jalons/${j.json().id}`, { atteint: true }),
      "jalon atteint",
    );
    // Publié par la base, traité par la file.
    await viderFile();
    const [x] = await executions(f.associe, autoId);
    expect(x?.issue).toBe("declenchee");
    expect(x?.actions.map((a) => [a.type, a.statut])).toEqual([
      ["facture_brouillon", "reussie"],
      ["notifier", "reussie"],
    ]);
    const factureId = x?.actions[0]?.entite_id as string;
    const facture = (await f.gestionnaire.get(`/api/factures/${factureId}`)).json();
    expect(facture).toMatchObject({
      statut: "brouillon",
      objet: "Jalon « Rapport de diagnostic »",
    });
    const notes = (await f.associe.get("/api/notifications?limite=100")).json().elements as {
      type: string;
      titre: string;
    }[];
    expect(
      notes.some((n) => n.type === "automatisation" && n.titre.includes("Rapport de diagnostic")),
    ).toBe(true);

    // Idempotence : rejouer l'événement, ou rebasculer le jalon, ne refait rien.
    const evenement = await proprietaire((c) =>
      c.query("SELECT id FROM automatisation_evenements WHERE cle = $1", [
        `mission.jalon_atteint:${j.json().id}`,
      ]),
    );
    await ctx.db.withTenant(f.cabinetId, (db) =>
      traiterEvenement(db, f.cabinetId, evenement.rows[0].id, new Date()),
    );
    await f.chef.patch(`/api/missions/${m.id}/jalons/${j.json().id}`, { atteint: false });
    await f.chef.patch(`/api/missions/${m.id}/jalons/${j.json().id}`, { atteint: true });
    await viderFile();
    expect(await executions(f.associe, autoId)).toHaveLength(1);

    // Autre cabinet : rien de visible.
    expect(
      (
        await autre.associe.get(`/api/automatisations/executions?automatisation_id=${autoId}`)
      ).json().elements,
    ).toEqual([]);
    expect(
      (
        await autre.associe.post(`/api/automatisations/actions/${x?.actions[0]?.id}/annuler`, {
          motif: "x",
        })
      ).statusCode,
    ).toBe(404);

    // Annulation : action non annulable refusée ; facture supprimée, échéance revenue « prévue ».
    expect(
      (
        await f.associe.post(`/api/automatisations/actions/${x?.actions[1]?.id}/annuler`, {
          motif: "Erreur",
        })
      ).json().erreur.code,
    ).toBe("ANNULATION_IMPOSSIBLE");
    expect(
      (
        await f.chef.post(`/api/automatisations/actions/${x?.actions[0]?.id}/annuler`, {
          motif: "Erreur",
        })
      ).statusCode,
    ).toBe(403);
    const ann = await f.associe.post(`/api/automatisations/actions/${x?.actions[0]?.id}/annuler`, {
      motif: "Jalon validé par erreur",
    });
    expect(ann.statusCode, ann.body).toBe(200);
    expect((await f.gestionnaire.get(`/api/factures/${factureId}`)).statusCode).toBe(404);
    const e = (await f.gestionnaire.get(`/api/missions/${m.id}/echeancier`)).json().echeances as {
      id: string;
      statut: string;
    }[];
    expect(e.find((l) => l.id === echeance.id)?.statut).toBe("prevue");
    expect(
      (
        await f.associe.post(`/api/automatisations/actions/${x?.actions[0]?.id}/annuler`, {
          motif: "Encore",
        })
      ).json().erreur.code,
    ).toBe("ANNULATION_IMPOSSIBLE");
    // Doublé en base : pas d'annulation d'une action non annulable (MPU03).
    await expect(
      ctx.db.withTenant(f.cabinetId, (db) =>
        db.query(
          `INSERT INTO automatisation_annulations (cabinet_id, action_id, motif, auteur_id)
           VALUES ($1, $2, 'x', $3)`,
          [f.cabinetId, x?.actions[1]?.id, f.associeId],
        ),
      ),
    ).rejects.toMatchObject({ code: "MPU03" });
    // Garde doublée en base : une action vers le client autorisée hors R0 (MPU04).
    await expect(
      ctx.db.withTenant(f.cabinetId, (db) =>
        db.query(
          `INSERT INTO automatisation_actions (cabinet_id, execution_id, indice, type, parametres,
             classe_risque, vers_client, annulable, cle, autorisee)
           VALUES ($1, $2, 9, 'relance_questionnaire', '{}', 'R2', true, false, 'essai-mpu04', true)`,
          [f.cabinetId, x?.id],
        ),
      ),
    ).rejects.toMatchObject({ code: "MPU04" });
  });

  it("coupe-circuit de l'automatisation : exécution bloquée, sans action", async () => {
    const autoId = (
      (await f.associe.get("/api/automatisations?limite=100")).json().elements as {
        id: string;
        standard_code: string;
      }[]
    ).find((x) => x.standard_code === "jalon_facture_brouillon")?.id as string;
    attendre(
      200,
      await f.associe.post(`/api/automatisations/${autoId}/coupe-circuit`, {
        actif: true,
        motif: "Pause de fin d'année",
      }),
      "coupure",
    );
    const m = await missionAvecEcheancier(f);
    const j = await f.chef.post(`/api/missions/${m.id}/jalons`, { libelle: "Atelier" });
    await f.chef.patch(`/api/missions/${m.id}/jalons/${j.json().id}`, { atteint: true });
    await viderFile();
    const journal = await executions(f.associe, autoId);
    expect(journal[0]).toMatchObject({ issue: "bloquee", actions: [] });
    attendre(
      200,
      await f.associe.post(`/api/automatisations/${autoId}/coupe-circuit`, {
        actif: false,
        motif: "Reprise",
      }),
      "levée",
    );
  });
});

describe("questionnaire sans réponse : détection, relance N4 et garde", () => {
  it("détecte le palier J+10, relance R0 vers le client sauf coupe-circuit N4", async () => {
    const m = await creerMission(f, { intitule: "Notation à relancer" });
    const consultant = await f.avecRoles(["consultant"]);
    attendre(
      201,
      await f.chef.post(`/api/missions/${m.id}/equipe`, {
        utilisateur_id: consultant.utilisateurId,
      }),
      "équipe",
    );
    const dirigeant = await inviterClient(ctx, f.associe, f.clientId, ["client_dirigeant"]);
    const { versionId } = await versionValidee(consultant, "automatisation_relance");
    const envoiId = await envoyer(consultant, m.id, versionId, [
      { utilisateur_id: dirigeant.utilisateurId },
    ]);
    const r = await f.associe.post("/api/automatisations", {
      nom: "Relance J+10",
      definition: {
        evenement_code: "questionnaire.sans_reponse",
        condition: {
          type: "comparaison",
          champ: "jours_sans_reponse",
          operateur: "superieur_ou_egal",
          valeur: 10,
        },
        actions: [
          { type: "relance_questionnaire" },
          {
            type: "creer_tache",
            titre: "Appeler le client : « {{titre}} »",
            assigne: "chef_mission",
            echeance_jours: 2,
          },
        ],
      },
    });
    attendre(201, r, "automatisation");
    attendre(
      200,
      await f.associe.post(`/api/automatisations/${r.json().id}/activer`),
      "activation",
    );
    // Coupe-circuit N4 des agents : plus aucun envoi automatique au client.
    attendre(
      200,
      await f.associe.put("/api/agents/coupe-circuit", { actif: true, motif: "Audit" }),
      "coupe-circuit N4",
    );
    const dans = (jours: number) => new Date(Date.now() + jours * 86_400_000 + 3_600_000);
    const d1 = await ctx.db.withTenant(f.cabinetId, (db) => detecterEvenements(db, dans(10)));
    expect(d1.questionnaires).toBe(1);
    await viderFile();
    let [x] = await executions(f.associe, r.json().id);
    expect(x?.actions.map((a) => [a.type, a.statut])).toEqual([
      ["relance_questionnaire", "refusee"],
      ["creer_tache", "reussie"],
    ]);
    expect(x?.actions[0]?.refus).toEqual(["COUPE_CIRCUIT_N4"]);
    const taches = (await f.chef.get("/api/taches-collaboration")).json().elements as {
      titre: string;
      mission_id: string;
    }[];
    expect(
      taches.some((t) => t.mission_id === m.id && t.titre.startsWith("Appeler le client")),
    ).toBe(true);

    // Levée : le palier suivant (J+14) relance le client.
    attendre(
      200,
      await f.associe.put("/api/agents/coupe-circuit", { actif: false, motif: "Fin d'audit" }),
      "levée N4",
    );
    const d2 = await ctx.db.withTenant(f.cabinetId, (db) => detecterEvenements(db, dans(14)));
    expect(d2.questionnaires).toBe(1);
    // Même jour : rien de nouveau (clé idempotente).
    expect(
      (await ctx.db.withTenant(f.cabinetId, (db) => detecterEvenements(db, dans(14))))
        .questionnaires,
    ).toBe(0);
    await viderFile();
    [x] = await executions(f.associe, r.json().id);
    expect(x?.actions[0]).toMatchObject({ type: "relance_questionnaire", statut: "reussie" });
    const relances = await proprietaire((c) =>
      c.query("SELECT nature FROM questionnaire_relances WHERE envoi_id = $1", [envoiId]),
    );
    expect(relances.rows.map((l) => l.nature)).toContain("manuelle");
  });
});

describe("KPI au rouge deux périodes : note d'alerte en brouillon (standard)", () => {
  it("détecte la série, crée le brouillon, la décision revient au chef de mission", async () => {
    const autoId = await activerStandard(f.associe, "kpi_rouge_note_alerte");
    const m = await creerMission(f, { intitule: "Pilotage KPI" });
    const kpi = await creerKpi(f.chef, m.id);
    await mesurer(f.chef, kpi.id, "2026-01-20", 500);
    await mesurer(f.chef, kpi.id, "2026-02-20", 500);
    const d = await ctx.db.withTenant(f.cabinetId, (db) =>
      detecterEvenements(db, new Date("2026-03-15T08:00:00Z")),
    );
    expect(d.kpi).toBe(1);
    await viderFile();
    const [x] = await executions(f.associe, autoId);
    expect(x?.actions.map((a) => [a.type, a.statut])).toEqual([
      ["brouillon", "reussie"],
      ["notifier", "reussie"],
    ]);
    const brouillons = (await f.chef.get("/api/automatisations/brouillons?a_valider=true")).json()
      .elements as { id: string; nature: string; corps: string; mission_id: string }[];
    const note = brouillons.find((b) => b.mission_id === m.id);
    expect(note).toMatchObject({ nature: "note_alerte" });
    expect(note?.corps).toContain("2 périodes consécutives");
    // Simulation de l'automatisation sur cet événement passé.
    const sim = (await f.chef.post(`/api/automatisations/${autoId}/simulation`, {})).json();
    expect(sim).toMatchObject({ evenements: 1, declenchements: 1, actions_autorisees: 2 });

    const consultant = await f.avecRoles(["consultant"]);
    expect(
      (
        await consultant.post(`/api/automatisations/brouillons/${note?.id}/decision`, {
          decision: "validee",
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await autre.associe.post(`/api/automatisations/brouillons/${note?.id}/decision`, {
          decision: "validee",
        })
      ).statusCode,
    ).toBe(404);
    const v = await f.chef.post(`/api/automatisations/brouillons/${note?.id}/decision`, {
      decision: "modifiee",
      texte_final: "Note revue par le chef de mission.",
    });
    expect(v.statusCode, v.body).toBe(200);
    expect(v.json()).toMatchObject({
      decision: "modifiee",
      texte_final: "Note revue par le chef de mission.",
    });
    expect(
      (
        await f.chef.post(`/api/automatisations/brouillons/${note?.id}/decision`, {
          decision: "validee",
        })
      ).json().erreur.code,
    ).toBe("DECISION_EXISTE");
    // Brouillon décidé : son annulation est refusée.
    expect(
      (
        await f.associe.post(`/api/automatisations/actions/${x?.actions[0]?.id}/annuler`, {
          motif: "Trop tard",
        })
      ).json().erreur.code,
    ).toBe("ANNULATION_IMPOSSIBLE");
  });
});

describe("appel d'un agent : niveau d'autonomie effectif et file propre", () => {
  it("refuse sous N2, sinon met en file et trace l'échec du service sans appel externe", async () => {
    const m = await creerMission(f, { intitule: "Mission à analyser" });
    const r = await f.associe.post("/api/automatisations", {
      nom: "Analyse à la clôture demandée",
      definition: {
        evenement_code: "mission.cloture_demandee",
        actions: [
          {
            type: "appeler_agent",
            agent_code: "redacteur",
            prompt_nom: "prompt_inexistant",
            variables: { mission: "{{mission_id}}" },
          },
        ],
      },
    });
    attendre(201, r, "automatisation");
    attendre(
      200,
      await f.associe.post(`/api/automatisations/${r.json().id}/activer`),
      "activation",
    );
    attendre(
      200,
      await f.associe.put("/api/agents/redacteur/restriction", {
        actif: true,
        niveau_max: "N1",
        motif: "Essai",
      }),
      "restriction",
    );
    const publier = (cle: string) =>
      ctx.db.withTenant(f.cabinetId, (db) =>
        publierEvenement(db, authDe(f.associeId, ["associe"]), {
          code: "mission.cloture_demandee",
          payload: { mission_id: m.id },
          cle,
        }),
      );
    expect((await publier(`${m.id}:1`)).en_file).toBe(true);
    await viderFile();
    let [x] = await executions(f.associe, r.json().id);
    expect(x?.actions[0]).toMatchObject({ statut: "refusee", refus: ["NIVEAU_AGENT_INSUFFISANT"] });

    attendre(
      200,
      await f.associe.put("/api/agents/redacteur/restriction", {
        actif: true,
        niveau_max: null,
        motif: "Fin d'essai",
      }),
      "levée de la restriction",
    );
    await publier(`${m.id}:2`);
    await viderFile();
    [x] = await executions(f.associe, r.json().id);
    expect(x?.actions[0]?.statut).toBe("echec");
    expect(x?.actions[0]?.code).toMatch(/^[A-Z_]+$/);
  });

  it("n'appelle pas l'agent si un coupe-circuit ou la désactivation survient avant son tour", async () => {
    const m = await creerMission(f, { intitule: "Mission coupée avant l'appel" });
    const r = await f.associe.post("/api/automatisations", {
      nom: "Analyse coupée avant l'appel",
      definition: {
        evenement_code: "mission.cloture_demandee",
        actions: [
          {
            type: "appeler_agent",
            agent_code: "redacteur",
            prompt_nom: "prompt_inexistant",
            variables: { mission: "{{mission_id}}" },
          },
        ],
      },
    });
    attendre(201, r, "automatisation");
    const id = r.json().id as string;
    attendre(200, await f.associe.post(`/api/automatisations/${id}/activer`), "activation");
    const coupe = (cible: string, actif: boolean) =>
      f.associe.post(cible, { actif, motif: actif ? "Pause avant l'appel" : "Reprise" });
    /** Publie, traite l'événement (l'appel part en file), applique `avant`, puis vide la file. */
    const jouer = async (cle: string, avant: () => Promise<void>) => {
      const publie = await ctx.db.withTenant(f.cabinetId, (db) =>
        publierEvenement(db, authDe(f.associeId, ["associe"]), {
          code: "mission.cloture_demandee",
          payload: { mission_id: m.id },
          cle,
        }),
      );
      expect(publie.en_file).toBe(true);
      await traiterJusquAuxEvenements();
      await avant();
      await viderFile();
      const [x] = await executions(f.associe, id);
      return x?.actions[0];
    };
    const attendu = { type: "appeler_agent", statut: "ignoree", code: "COUPE_CIRCUIT" };

    // Coupe-circuit du cabinet.
    expect(
      await jouer(`${m.id}:cabinet`, async () =>
        attendre(200, await coupe("/api/automatisations/coupe-circuit", true), "coupe cabinet"),
      ),
    ).toMatchObject(attendu);
    attendre(200, await coupe("/api/automatisations/coupe-circuit", false), "levée cabinet");

    // Coupe-circuit de l'automatisation.
    expect(
      await jouer(`${m.id}:automatisation`, async () =>
        attendre(200, await coupe(`/api/automatisations/${id}/coupe-circuit`, true), "coupe"),
      ),
    ).toMatchObject(attendu);
    attendre(200, await coupe(`/api/automatisations/${id}/coupe-circuit`, false), "levée");

    // Désactivation.
    expect(
      await jouer(`${m.id}:desactivee`, async () =>
        attendre(200, await f.associe.post(`/api/automatisations/${id}/desactiver`), "off"),
      ),
    ).toMatchObject(attendu);

    // Le résultat est une ignorance enregistrée (jamais un appel) : aucune exécution d'agent.
    const lignes = await proprietaire((c) =>
      c.query(
        `SELECT r.statut, r.code, r.details->>'raison' AS raison
         FROM automatisation_action_resultats r
         JOIN automatisation_actions a ON a.id = r.action_id
         JOIN automatisation_executions x ON x.id = a.execution_id
         WHERE x.automatisation_id = $1 ORDER BY r.cree_le`,
        [id],
      ),
    );
    expect(lignes.rows).toEqual([
      { statut: "ignoree", code: "COUPE_CIRCUIT", raison: "COUPE_CIRCUIT_CABINET" },
      { statut: "ignoree", code: "COUPE_CIRCUIT", raison: "COUPE_CIRCUIT_AUTOMATISATION" },
      { statut: "ignoree", code: "COUPE_CIRCUIT", raison: "AUTOMATISATION_INACTIVE" },
    ]);
  });
});
