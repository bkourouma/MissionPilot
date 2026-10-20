import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { termesNomsPropres } from "../src/copilote/noms-propres.js";
import { appelerModele, preparerAppelIa } from "../src/copilote/routage-ia.js";
import { solderReservation } from "../src/ia/couts.js";
import { reponseCopiloteSchema } from "@missionpilot/shared";
import type { Api } from "./api.js";
import { MOT_DE_PASSE_TEST, proprietaire, type Contexte } from "./helpers.js";
import { authDe, demarrerIa, serveurFactice, type ServeurFactice } from "./ia-outils.js";
import { creerMissionSignee, preparerCabinet, type CabinetMissions } from "./missions-outils.js";

/*
 * Masquage des NOMS PROPRES connus du cabinet avant envoi au modèle (AGT-08) et routage du copilote
 * par l'orchestrateur IA. Fournisseur SIMULÉ qui capture ce qu'il reçoit (aucun appel réseau, aucune
 * vraie clé) ; vraie base PostgreSQL sous RLS.
 */

vi.setConfig({ testTimeout: 90_000 });

const CLIENT_A = "Sotra Abidjan Transports";
const PERSONNE_A = "Awa Koné";
const MISSION_A = "Refonte Zéphyr Kilimandjaro";
const CLIENT_B = "Banque Ébène des Lagunes";
const MISSION_B = "Programme Oryx Secret";
const PERMIS = ["mes_taches", "resume_mission", "recherche"] as const;
const MODELE = "google/gemini-2.5-flash";

let serveur: ServeurFactice;
let ctx: Contexte;
let a: CabinetMissions;
let b: CabinetMissions;
let utilisateurA: Api & { utilisateurId: string };

beforeAll(async () => {
  serveur = await serveurFactice();
  ctx = await demarrerIa(serveur.url);
  a = await preparerCabinet(ctx, "Cabinet Noms A");
  b = await preparerCabinet(ctx, "Cabinet Noms B");
  for (const c of [a, b]) {
    expect((await c.associe.put("/api/ia/parametres", { ia_activee: true })).statusCode).toBe(200);
  }
  await a.associe.post("/api/clients", { raison_sociale: CLIENT_A });
  await b.associe.post("/api/clients", { raison_sociale: CLIENT_B });
  await creerMissionSignee(a, { intitule: MISSION_A });
  await creerMissionSignee(b, { intitule: MISSION_B });
  // Le directeur de mission du cabinet A porte un nom de personne connu du cabinet.
  await proprietaire((cl) =>
    cl.query("UPDATE utilisateurs SET nom = $2 WHERE id = $1", [
      a.directeur.utilisateurId,
      PERSONNE_A,
    ]),
  );
  utilisateurA = a.chef;
});
afterAll(async () => {
  await ctx.fermer();
  await serveur.fermer();
});
beforeEach(() => {
  serveur.requetes.length = 0;
  serveur.repondre(() => ({ contenu: JSON.stringify({ outil: "aucun", parametres: {} }) }));
});

const modele = (choix: unknown, usage = { prompt_tokens: 800, completion_tokens: 20 }) =>
  serveur.repondre(() => ({
    contenu: typeof choix === "string" ? choix : JSON.stringify(choix),
    usage,
  }));

async function demander(u: Api, message: string) {
  const r = await u.post("/api/copilote/messages", { message });
  expect(r.statusCode, r.body).toBe(200);
  return reponseCopiloteSchema.parse(r.json());
}

const envoye = () => JSON.stringify(serveur.requetes.map((r) => r.corps));

const consommations = (cabinetId: string) =>
  proprietaire(
    async (cl) =>
      (
        await cl.query(
          `SELECT issue, tache, modele, copilote, demande_id, tokens_sortie, cout_micro_usd::int AS cout
           FROM ia_consommations WHERE cabinet_id = $1 ORDER BY id`,
          [cabinetId],
        )
      ).rows,
  );

const reservations = (cabinetId: string) =>
  proprietaire(
    async (cl) =>
      (
        await cl.query("SELECT count(*)::int AS n FROM ia_reservations WHERE cabinet_id = $1", [
          cabinetId,
        ])
      ).rows[0].n as number,
  );

describe("noms du cabinet : jamais envoyés au fournisseur", () => {
  it("client, collaborateur et mission tapés sont masqués ; le jeton revient démasqué et la mission est résolue", async () => {
    modele({ outil: "resume_mission", parametres: { mission: "[TERME_1]" } });
    const r = await demander(
      utilisateurA,
      `Où en est la mission ${MISSION_A} pour ${CLIENT_A}, suivie par ${PERSONNE_A} ?`,
    );
    expect(serveur.requetes).toHaveLength(1);
    const tout = envoye();
    for (const nom of ["Sotra", "Abidjan", "Awa", "Koné", "Zéphyr", "Zephyr", "Kilimandjaro"]) {
      expect(tout, nom).not.toContain(nom);
    }
    expect(tout).toContain("[ORGANISATION_1]");
    expect(tout).toContain("[PERSONNE_1]");
    expect(tout).toContain("[TERME_1]");
    // Le paramètre rendu sous forme de jeton est démasqué AVANT la résolution par le code.
    expect(r).toMatchObject({ mode: "ia", outil: "resume_mission", statut: "ok" });
    expect(r.texte).toContain(`« ${MISSION_A} »`);
    // Ni la consigne système ni le message ne contiennent de nom.
    const messages = serveur.requetes[0]?.corps.messages ?? [];
    expect(messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(messages[1]?.content).toContain("<<<DONNEES_CLIENT_NON_FIABLES");
  });

  it("casse et accents différents sont masqués aussi", async () => {
    modele({ outil: "resume_mission", parametres: { mission: "[TERME_1]" } });
    const r = await demander(
      utilisateurA,
      "ou en est la mission REFONTE ZEPHYR KILIMANDJARO de sotra abidjan transports, avec awa kone",
    );
    const tout = envoye();
    for (const nom of ["sotra", "SOTRA", "zephyr", "ZEPHYR", "kilimandjaro", "awa", "kone"]) {
      expect(tout, nom).not.toContain(nom);
    }
    // Le démasquage restitue ce que l'utilisateur a TAPÉ (pas la fiche) ; la résolution l'accepte.
    expect(r).toMatchObject({ mode: "ia", outil: "resume_mission", statut: "ok" });
    expect(r.texte).toContain(`« ${MISSION_A} »`);
  });

  it("un nom d'un AUTRE cabinet n'est ni lu ni masqué ; un mot courant reste intact", async () => {
    const message = `Cherche ${CLIENT_B} et ${MISSION_B} dans les transports de la mission`;
    modele({ outil: "recherche", parametres: { texte: "x" } });
    await demander(utilisateurA, message);
    const user = serveur.requetes[0]?.corps.messages?.[1]?.content ?? "";
    // Ces noms n'existent pas dans le cabinet A : ils partent tels quels (limite documentée), sans jeton.
    expect(user).toContain(CLIENT_B);
    expect(user).toContain(MISSION_B);
    expect(user).not.toMatch(/\[(PERSONNE|ORGANISATION|TERME)_\d+\]/);
    // Un fragment d'un nom connu (« transports ») n'est pas un nom : mot courant intact.
    expect(user).toContain("transports");
    // Et à l'inverse, le cabinet B masque ses propres noms.
    serveur.requetes.length = 0;
    await demander(b.associe, `Cherche ${CLIENT_B} et ${MISSION_B}`);
    const toutB = envoye();
    expect(toutB).not.toContain("Ébène");
    expect(toutB).not.toContain("Oryx");
    expect(toutB).toContain("[ORGANISATION_1]");
  });

  it("le modèle ne peut pas inventer un jeton absent : il reste littéral et ne résout rien", async () => {
    modele({ outil: "resume_mission", parametres: { mission: "[ORGANISATION_7]" } });
    const r = await demander(utilisateurA, "résume la mission, merci");
    expect(r.mode).toBe("ia");
    expect(r.texte).not.toContain(MISSION_A);
    expect(r.texte).not.toContain(CLIENT_A);
    expect(r.statut).toBe("precision_requise");
  });

  it("le journal d'échange ne contient aucun nom ; le nombre de noms masqués remonte à l'admission", async () => {
    modele({ outil: "resume_mission", parametres: { mission: "[TERME_1]" } });
    await demander(utilisateurA, `Point sur ${MISSION_A} de ${CLIENT_A} avec ${PERSONNE_A}`);
    const lignes = await proprietaire(async (cl) =>
      (
        await cl.query(
          `SELECT details::text AS d FROM journal_audit
             WHERE cabinet_id = $1 AND action IN ('copilote.echange', 'copilote.message')`,
          [a.cabinetId],
        )
      ).rows.map((x) => x.d as string),
    );
    expect(lignes.length).toBeGreaterThan(0);
    const journal = lignes.join("\n");
    for (const nom of ["Sotra", "Koné", "Kone", "Zéphyr", "Kilimandjaro"]) {
      expect(journal, nom).not.toContain(nom);
    }
    // Le compte (pas les noms) est disponible dans le résultat d'admission.
    const auth = await authDe(ctx, a.cabinetId, utilisateurA.utilisateurId);
    const admission = await ctx.db.withTenant(a.cabinetId, async (db) => {
      const adm = await preparerAppelIa(
        db,
        { database: ctx.db, config: ctx.config },
        auth,
        PERMIS,
        `Point sur ${MISSION_A} de ${CLIENT_A} avec ${PERSONNE_A}, et ${CLIENT_A} encore`,
        new Date(),
      );
      if (adm.type === "appel") await solderReservation(db, adm.reservationId);
      return adm;
    });
    expect(admission.type).toBe("appel");
    if (admission.type === "appel") expect(admission.termes_masques).toBe(3);
  });
});

describe("bornes de la lecture des noms", () => {
  it("plus de 200 noms présents : 200 termes au plus, sans erreur ; termes courts ignorés", async () => {
    await proprietaire((cl) =>
      cl.query(
        `INSERT INTO clients (cabinet_id, raison_sociale)
         SELECT $1, 'Zorglub' || lpad(g::text, 4, '0') FROM generate_series(1, 250) g`,
        [a.cabinetId],
      ),
    );
    await proprietaire((cl) =>
      cl.query("INSERT INTO clients (cabinet_id, raison_sociale) VALUES ($1, 'AB')", [a.cabinetId]),
    );
    const noms = Array.from({ length: 250 }, (_, i) => `Zorglub${String(i + 1).padStart(4, "0")}`);
    const message = `${noms.join(" ")} AB`;
    const { termes } = await ctx.db.withTenant(a.cabinetId, (db) =>
      termesNomsPropres(db, a.cabinetId, message),
    );
    expect(termes).toHaveLength(200);
    expect(JSON.stringify(termes)).not.toContain('"AB"');
  });

  it("plus de 2 000 noms partageant un mot du message : borne respectée, sans erreur", async () => {
    await proprietaire((cl) =>
      cl.query(
        `INSERT INTO clients (cabinet_id, raison_sociale)
         SELECT $1, 'Gargamelle numero ' || g FROM generate_series(1, 2100) g`,
        [a.cabinetId],
      ),
    );
    const { termes } = await ctx.db.withTenant(a.cabinetId, (db) =>
      termesNomsPropres(db, a.cabinetId, "Que sait-on de Gargamelle ?"),
    );
    // Aucun nom complet n'apparaît dans le message : rien à masquer, et rien n'a échoué.
    expect(termes).toEqual([]);
  });

  it("la lecture ne sort jamais du cabinet (RLS) ", async () => {
    const { termes } = await ctx.db.withTenant(a.cabinetId, (db) =>
      termesNomsPropres(db, a.cabinetId, `${CLIENT_B} ${MISSION_B}`),
    );
    expect(termes).toEqual([]);
  });
});

describe("l'orchestrateur est le seul chemin vers le fournisseur", () => {
  it("aucun fichier de src/copilote n'importe ou n'appelle le fournisseur directement", () => {
    const dossier = join(__dirname, "..", "src", "copilote");
    const fichiers = readdirSync(dossier).filter((f) => f.endsWith(".ts"));
    expect(fichiers).toContain("routage-ia.ts");
    for (const f of fichiers) {
      const source = readFileSync(join(dossier, f), "utf8");
      expect(source, f).not.toMatch(/fournisseurDepuisConfig|creerFournisseurOpenRouter/);
      expect(source, f).not.toMatch(/\.completer\(/);
    }
    const routage = readFileSync(join(dossier, "routage-ia.ts"), "utf8");
    expect(routage).toContain("appelerSansDemande");
    expect(routage).toContain("admettreSansDemande");
  });
});

describe("coût, plafond et replis par l'orchestrateur", () => {
  it("coût inscrit : copilote = true, modèle de la tâche, sans demande ; réservation soldée", async () => {
    const avant = (await consommations(a.cabinetId)).length;
    modele({ outil: "mes_taches", parametres: {} });
    await demander(utilisateurA, `mes tâches ${CLIENT_A}`);
    const c = (await consommations(a.cabinetId)).slice(avant);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({
      issue: "succes",
      tache: "classification",
      modele: MODELE,
      copilote: true,
      demande_id: null,
    });
    expect(c[0]?.cout).toBeGreaterThan(0);
    expect(await reservations(a.cabinetId)).toBe(0);
  });

  it("sortie invalide : coût RÉEL inscrit", async () => {
    const avant = (await consommations(a.cabinetId)).length;
    modele("Bien sûr ! Voici vos tâches", { prompt_tokens: 1000, completion_tokens: 7 });
    const r = await demander(utilisateurA, "mes tâches");
    expect(r).toMatchObject({ mode: "deterministe", repli: "indisponible" });
    const c = (await consommations(a.cabinetId)).slice(avant);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ issue: "sortie_invalide", tokens_sortie: 7, copilote: true });
  });

  it("délai dépassé : coût ESTIMÉ inscrit, une seule requête", async () => {
    const court = await demarrerIa(serveur.url, { IA_TIMEOUT_MS: 150 });
    try {
      const c = await preparerCabinet(court, "Cabinet Noms Délai");
      await c.associe.put("/api/ia/parametres", { ia_activee: true });
      serveur.repondre(() => ({ silence: true }));
      const r = await c.associe.post("/api/copilote/messages", { message: "mes tâches" });
      expect(reponseCopiloteSchema.parse(r.json())).toMatchObject({
        mode: "deterministe",
        repli: "indisponible",
      });
      expect(serveur.requetes).toHaveLength(1);
      expect(await consommations(c.cabinetId)).toMatchObject([
        { issue: "delai_depasse", tokens_sortie: 500, copilote: true },
      ]);
      expect(await reservations(c.cabinetId)).toBe(0);
    } finally {
      await court.fermer();
    }
  });

  it("plafond mensuel atteint : repli, aucun appel", async () => {
    const c = await preparerCabinet(ctx, "Cabinet Noms Plafond");
    const u = await c.avecRoles(["chef_mission"]);
    await c.associe.put("/api/ia/parametres", { ia_activee: true });
    const r0 = await c.associe.put("/api/ia/parametres", {
      plafond_mensuel_micro_usd: 0,
      confirmation: { mot_de_passe: MOT_DE_PASSE_TEST },
    });
    expect(r0.statusCode, r0.body).toBe(200);
    expect(await demander(u, `mes tâches ${CLIENT_A}`)).toMatchObject({
      mode: "deterministe",
      repli: "indisponible",
    });
    expect(serveur.requetes).toHaveLength(0);
    expect(await consommations(c.cabinetId)).toEqual([]);
    expect(await reservations(c.cabinetId)).toBe(0);
  });

  it("IA désactivée, sans droit « ia.utiliser » ou sans clé : repli, aucun appel", async () => {
    // IA désactivée (par défaut).
    const d = await preparerCabinet(ctx, "Cabinet Noms Sans IA");
    const u = await d.avecRoles(["chef_mission"]);
    expect(await demander(u, `mes tâches ${CLIENT_A}`)).toMatchObject({
      mode: "deterministe",
      repli: "ia_desactivee",
    });
    // Sans droit : le gestionnaire du cabinet A.
    const gestionnaire = await a.avecRoles(["gestionnaire"]);
    expect(await demander(gestionnaire, "mes tâches")).toMatchObject({
      mode: "deterministe",
      repli: "non_autorisee",
    });
    // Sans clé.
    const sansCle = await demarrerIa(serveur.url, { OPENROUTER_API_KEY: "" });
    try {
      const c = await preparerCabinet(sansCle, "Cabinet Noms Sans clé");
      await c.associe.put("/api/ia/parametres", { ia_activee: true });
      const r = await c.associe.post("/api/copilote/messages", { message: "mes tâches" });
      expect(reponseCopiloteSchema.parse(r.json())).toMatchObject({
        mode: "deterministe",
        repli: "indisponible",
      });
    } finally {
      await sansCle.fermer();
    }
    expect(serveur.requetes).toHaveLength(0);
  });
});

describe("au niveau du routage (admission puis appel par l'orchestrateur)", () => {
  async function router(message: string, cabinet = a, utilisateurId = a.chef.utilisateurId) {
    const auth = await authDe(ctx, cabinet.cabinetId, utilisateurId);
    const deps = { database: ctx.db, config: ctx.config };
    const maintenant = new Date();
    const adm = await ctx.db.withTenant(cabinet.cabinetId, (db) =>
      preparerAppelIa(db, deps, auth, PERMIS, message, maintenant),
    );
    if (adm.type === "repli") return { adm, appel: null };
    return { adm, appel: await appelerModele(deps, auth, adm, PERMIS, maintenant) };
  }

  it("le paramètre rendu en jeton est démasqué avant résolution ; la valeur est celle que l'utilisateur a tapée", async () => {
    modele({ outil: "resume_mission", parametres: { mission: "[TERME_1]" } });
    const { appel } = await router(`point sur la mission ${MISSION_A.toUpperCase()}`);
    expect(envoye()).not.toContain("KILIMANDJARO");
    expect(appel?.sortie).toEqual({
      type: "choix",
      choix: { outil: "resume_mission", parametres: { mission: MISSION_A.toUpperCase() } },
    });
  });

  it("un jeton absent du masque n'est jamais démasqué", async () => {
    modele({ outil: "resume_mission", parametres: { mission: "[ORGANISATION_3]" } });
    const { appel } = await router(`mission ${MISSION_A}`);
    expect(appel?.sortie).toEqual({
      type: "choix",
      choix: { outil: "resume_mission", parametres: { mission: "[ORGANISATION_3]" } },
    });
  });

  it("coût inscrit avec le modèle, sans demande ; réservation soldée", async () => {
    const avant = (await consommations(a.cabinetId)).length;
    modele({ outil: "mes_taches", parametres: {} });
    const { appel } = await router(`mes tâches de ${CLIENT_A}`);
    expect(appel?.sortie.type).toBe("choix");
    const c = (await consommations(a.cabinetId)).slice(avant);
    expect(c).toMatchObject([
      {
        issue: "succes",
        tache: "classification",
        modele: MODELE,
        copilote: true,
        demande_id: null,
      },
    ]);
    expect(appel?.cout).toBe(c[0]?.cout);
    expect(await reservations(a.cabinetId)).toBe(0);
  });

  it("sortie invalide : coût réel ; fournisseur en erreur : rien d'inscrit", async () => {
    const avant = (await consommations(a.cabinetId)).length;
    modele("pas du json", { prompt_tokens: 900, completion_tokens: 9 });
    const r1 = await router("mes tâches");
    expect(r1.appel?.sortie).toEqual({ type: "invalide", motif: "json" });
    serveur.repondre(() => ({ statut: 500, brut: "{}" }));
    const r2 = await router("mes tâches");
    expect(r2.appel?.sortie.type).toBe("echec");
    expect(r2.appel?.cout).toBeNull();
    expect(await consommations(a.cabinetId)).toHaveLength(avant + 1);
    expect((await consommations(a.cabinetId)).at(-1)).toMatchObject({
      issue: "sortie_invalide",
      tokens_sortie: 9,
    });
  });
});
