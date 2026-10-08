import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Role } from "@missionpilot/shared";
import { trousseauDepuisConfig, versionDeCle } from "../src/auth/chiffrement.js";
import { base32Decoder, totp } from "../src/auth/totp.js";
import type { Config } from "../src/config.js";
import { estimerCoutAppel, QUOTA_GENERATIONS_UTILISATEUR_JOUR } from "../src/ia/couts.js";
import { ErreurLlm } from "../src/ia/fournisseur.js";
import { blocChiffres } from "../src/ia/gabarits.js";
import { MAX_TOKENS_SORTIE } from "../src/ia/modeles.js";
import { genererContenu, type DemandeContenu } from "../src/ia/orchestrateur.js";
import { chiffrerCle, resoudreCle } from "../src/ia/parametres.js";
import { PROMPTS_EXEMPLE } from "../src/ia/prompts.js";
import { api, cabinetTest, type CabinetTest } from "./api.js";
import { MOT_DE_PASSE_TEST, proprietaire, type Contexte } from "./helpers.js";
import {
  attendreQue,
  authDe,
  CLE_CABINET_FACTICE,
  CLE_PLATEFORME_FACTICE,
  demarrerIa,
  serveurFactice,
  verrou,
  type ServeurFactice,
} from "./ia-outils.js";
import { preparerCabinet, TOUS_LES_ROLES, type CabinetMissions } from "./missions-outils.js";

/*
 * Socle IA (ADR-003) : routes /api/ia/*, sur vrai PostgreSQL, fournisseur
 * FACTICE local (aucun appel réseau externe, aucune vraie clé). Les tests
 * « constat N » sont les non-régressions de l'audit de sécurité du socle IA.
 */

// Matrice des 8 rôles et appels simultanés : plusieurs dizaines de connexions et de requêtes.
vi.setConfig({ testTimeout: 60_000 });

let serveur: ServeurFactice;
let ctx: Contexte;
let a: CabinetMissions;
let b: CabinetTest;

const CONFIRMATION = { confirmation: { mot_de_passe: MOT_DE_PASSE_TEST } };

beforeAll(async () => {
  serveur = await serveurFactice();
  ctx = await demarrerIa(serveur.url);
  a = await preparerCabinet(ctx, "Cabinet IA A");
  b = await cabinetTest(ctx, "Cabinet IA B");
  // L'IA est désactivée tant que le cabinet ne l'a pas activée (constat 2).
  attendre(200, await a.associe.put("/api/ia/parametres", { ia_activee: true }));
  attendre(200, await b.associe.put("/api/ia/parametres", { ia_activee: true }));
  // Prompt d'un « service » (non exemple) : appelé par le code serveur, jamais par HTTP.
  attendre(
    201,
    await a.associe.post("/api/ia/prompts", {
      nom: "service_synthese",
      tache: "redaction",
      gabarit_systeme: "Consigne du service.",
      gabarit_utilisateur: "CHIFFRES :\n{{chiffres}}\n\nTEXTE :\n{{texte}}",
      schema_sortie: { type: "texte" },
    }),
  );
});
afterAll(async () => {
  await ctx.fermer();
  await serveur.fermer();
});

const TEXTE =
  "Awa Koné (awa.kone@exemple.ci, 07 07 12 34 56) a présenté le diagnostic. Le climat est bon.";

/** Génération manuelle de test (HTTP) : prompt « exemple », sans chiffres ni mission. */
const generation = (extra: Record<string, unknown> = {}) => ({
  prompt_nom: "resume_neutre",
  mode: "immediat",
  variables: { texte: TEXTE },
  termes_sensibles: ["Awa Koné"],
  ...extra,
});

function attendre(statut: number, r: { statusCode: number; body: string }) {
  if (r.statusCode !== statut)
    throw new Error(`Attendu ${statut}, reçu ${r.statusCode} : ${r.body}`);
  return JSON.parse(r.body);
}

/** Génération demandée par le CODE d'un service (orchestrateur), prompt non exemple. */
async function service(
  utilisateurId: string,
  extra: Partial<DemandeContenu> = {},
  cabinet: { cabinetId: string } = a,
): Promise<string> {
  const { demandeId } = await genererContenu(
    ctx.db,
    { config: ctx.config },
    {
      promptNom: "service_synthese",
      variables: { texte: TEXTE },
      termesSensibles: ["Awa Koné"],
      utilisateur: await authDe(ctx, cabinet.cabinetId, utilisateurId),
      ...extra,
    },
  );
  return demandeId;
}

/** Coût estimé (réservé) d'un appel avec un prompt « exemple » et ce texte. */
function estimer(modele: string, texte: string, nom = "resume_neutre"): number {
  const p = PROMPTS_EXEMPLE.find((x) => x.nom === nom)!;
  return estimerCoutAppel(
    modele,
    p.gabarit_systeme.length +
      p.gabarit_utilisateur.length +
      texte.length +
      blocChiffres([]).length,
    MAX_TOKENS_SORTIE[p.tache],
  );
}

const lignes = <T>(sql: string, params: unknown[]) =>
  proprietaire(async (c) => (await c.query(sql, params)).rows as T[]);

const ROLES_IA_UTILISER: Role[] = [
  "associe",
  "directeur_mission",
  "chef_mission",
  "consultant",
  "expert_metier",
];

describe("droits (8 rôles)", () => {
  it("401 sans session", async () => {
    const anonyme = api(ctx);
    for (const [m, url] of [
      ["get", "/api/ia/parametres"],
      ["get", "/api/ia/generations"],
      ["get", "/api/ia/prompts"],
      ["get", "/api/ia/couts"],
    ] as const) {
      expect((await anonyme[m](url)).statusCode).toBe(401);
    }
    expect((await anonyme.post("/api/ia/generations", generation())).statusCode).toBe(401);
    expect((await anonyme.put("/api/ia/parametres", { ia_activee: true })).statusCode).toBe(401);
  });

  it("matrice : ia.utiliser lit et génère, ia.configurer paramètre, coûts réservés aux associés", async () => {
    serveur.repondre(() => ({ contenu: "Synthèse neutre." }));
    for (const role of TOUS_LES_ROLES) {
      const u = await a.avecRoles([role]);
      const utilise = ROLES_IA_UTILISER.includes(role);
      const configure = role === "associe";
      expect((await u.get("/api/ia/parametres")).statusCode, role).toBe(utilise ? 200 : 403);
      expect((await u.get("/api/ia/prompts")).statusCode, role).toBe(utilise ? 200 : 403);
      expect((await u.get("/api/ia/generations")).statusCode, role).toBe(utilise ? 200 : 403);
      expect((await u.post("/api/ia/generations", generation())).statusCode, role).toBe(
        utilise ? 201 : 403,
      );
      expect((await u.put("/api/ia/parametres", { ia_activee: true })).statusCode, role).toBe(
        configure ? 200 : 403,
      );
      expect((await u.post("/api/ia/parametres/tester", {})).statusCode, role).toBe(
        configure ? 200 : 403,
      );
      expect(
        (
          await u.post("/api/ia/prompts", {
            nom: `prompt_${role}`,
            tache: "redaction",
            gabarit_utilisateur: "{{texte}}",
            schema_sortie: { type: "texte" },
          })
        ).statusCode,
        role,
      ).toBe(configure ? 201 : 403);
      // Coûts IA : ia.configurer ET finance.lire (le gestionnaire n'a que finance.lire).
      expect((await u.get("/api/ia/couts")).statusCode, role).toBe(configure ? 200 : 403);
      expect((await u.get("/api/ia/couts/missions")).statusCode, role).toBe(configure ? 200 : 403);
    }
  });
});

describe("paramètres et clé API du cabinet", () => {
  it("constats 2 et 11 : IA désactivée par défaut ; test du fournisseur refusé (409) tant qu'elle l'est", async () => {
    const c = await cabinetTest(ctx, "Cabinet IA neuf");
    expect(attendre(200, await c.associe.get("/api/ia/parametres"))).toMatchObject({
      ia_activee: false,
      source_cle: "plateforme",
      mode: "gabarit",
    });
    serveur.requetes.length = 0;
    const essai = await c.associe.post("/api/ia/parametres/tester", {});
    expect(essai.statusCode).toBe(409);
    expect(essai.json().erreur.code).toBe("IA_DESACTIVEE");
    const g = attendre(201, await c.associe.post("/api/ia/generations", generation()));
    expect(g).toMatchObject({ gabarit: true, trace: { fournisseur: "gabarit" } });
    expect(serveur.requetes).toHaveLength(0);
    // Activation explicite : l'IA fonctionne.
    serveur.repondre(() => ({ contenu: "OK" }));
    attendre(200, await c.associe.put("/api/ia/parametres", { ia_activee: true }));
    attendre(200, await c.associe.post("/api/ia/parametres/tester", {}));
    expect(serveur.requetes).toHaveLength(1);
  });

  it("état sans clé : source plateforme, modèles recommandés, plafonds réservés à ia.configurer", async () => {
    const consultant = await a.avecRoles(["consultant"]);
    const vue = attendre(200, await consultant.get("/api/ia/parametres"));
    expect(vue).toMatchObject({
      fournisseur: "openrouter",
      ia_activee: true,
      cle_configuree: false,
      cle_plateforme_disponible: true,
      source_cle: "plateforme",
      mode: "ia",
    });
    for (const champ of [
      "plafond_mensuel_micro_usd",
      "plafond_plateforme_micro_usd",
      "plafond_effectif_micro_usd",
      "modeles_autorises",
    ]) {
      expect(vue).not.toHaveProperty(champ);
    }
    expect(vue.modeles).toContainEqual({
      tache: "redaction",
      modele: "anthropic/claude-sonnet-4.5",
      recommande: "anthropic/claude-sonnet-4.5",
      personnalise: false,
    });
    const associe = attendre(200, await a.associe.get("/api/ia/parametres"));
    expect(associe).toMatchObject({
      plafond_mensuel_micro_usd: 50_000_000,
      plafond_plateforme_micro_usd: 50_000_000,
      plafond_effectif_micro_usd: 50_000_000,
    });
    expect(associe.modeles_autorises).toContain("openai/gpt-4o-mini");
  });

  it("constat 6 : clé du cabinet reconfirmée (mot de passe), chiffrée, jamais renvoyée ni journalisée, alerte aux associés", async () => {
    // Sans reconfirmation, ou avec un mauvais mot de passe : refus, rien n'est enregistré.
    const sans = await a.associe.put("/api/ia/parametres", { cle_api: CLE_CABINET_FACTICE });
    expect(sans.statusCode).toBe(403);
    expect(sans.json().erreur.code).toBe("CONFIRMATION_REQUISE");
    const faux = await a.associe.put("/api/ia/parametres", {
      cle_api: CLE_CABINET_FACTICE,
      confirmation: { mot_de_passe: "mauvais-mot-de-passe" },
    });
    expect(faux.statusCode).toBe(401);
    expect(attendre(200, await a.associe.get("/api/ia/parametres")).cle_configuree).toBe(false);

    const r = await a.associe.put("/api/ia/parametres", {
      cle_api: CLE_CABINET_FACTICE,
      ...CONFIRMATION,
    });
    const vue = attendre(200, r);
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(r.body).not.toContain(CLE_CABINET_FACTICE);
    expect(vue).toMatchObject({ cle_configuree: true, source_cle: "cabinet" });
    const enBase = await proprietaire(async (c) => {
      const p = await c.query(
        "SELECT cle_chiffree, cle_version FROM ia_parametres_cabinet WHERE cabinet_id = $1",
        [a.cabinetId],
      );
      const j = await c.query(
        "SELECT details::text AS d FROM journal_audit WHERE cabinet_id = $1 AND action = 'modification_parametres_ia'",
        [a.cabinetId],
      );
      const n = await c.query(
        "SELECT type FROM notifications WHERE cabinet_id = $1 AND destinataire_id = $2 AND type = 'ia_cle_modifiee'",
        [a.cabinetId, a.associeId],
      );
      return { p: p.rows[0], journal: j.rows.map((x) => x.d as string), notifications: n.rows };
    });
    expect(Buffer.from(enBase.p.cle_chiffree).toString("utf8")).not.toContain(CLE_CABINET_FACTICE);
    expect(Buffer.from(enBase.p.cle_chiffree).toString("latin1")).not.toContain("factice");
    expect(enBase.journal.join(" ")).toContain("definie");
    // Facteur de la reconfirmation journalisé (2FA inactive : mot de passe seul).
    expect(enBase.journal.join(" ")).toContain('"facteur": "mot_de_passe"');
    expect(enBase.journal.join(" ")).not.toContain(CLE_CABINET_FACTICE);
    expect(enBase.journal.join(" ")).not.toContain(MOT_DE_PASSE_TEST);
    expect(enBase.notifications).toHaveLength(1);

    serveur.requetes.length = 0;
    serveur.repondre(() => ({ contenu: "Synthèse." }));
    const g = attendre(201, await a.associe.post("/api/ia/generations", generation()));
    expect(JSON.stringify(g)).not.toContain(CLE_CABINET_FACTICE);
    expect(serveur.requetes[0]!.entetes.authorization).toBe(`Bearer ${CLE_CABINET_FACTICE}`);

    // Plafond : un relèvement est reconfirmé, une baisse ne l'est pas.
    const releve = await a.associe.put("/api/ia/parametres", {
      plafond_mensuel_micro_usd: 60_000_000,
    });
    expect(releve.statusCode).toBe(403);
    expect(releve.json().erreur.code).toBe("CONFIRMATION_REQUISE");
    attendre(
      200,
      await a.associe.put("/api/ia/parametres", {
        plafond_mensuel_micro_usd: 60_000_000,
        ...CONFIRMATION,
      }),
    );
    attendre(
      200,
      await a.associe.put("/api/ia/parametres", { plafond_mensuel_micro_usd: 50_000_000 }),
    );

    // Retrait : reconfirmé aussi, puis repli sur la clé de plateforme.
    expect((await a.associe.put("/api/ia/parametres", { cle_api: null })).statusCode).toBe(403);
    attendre(200, await a.associe.put("/api/ia/parametres", { cle_api: null, ...CONFIRMATION }));
    serveur.requetes.length = 0;
    attendre(201, await a.associe.post("/api/ia/generations", generation()));
    expect(serveur.requetes[0]!.entetes.authorization).toBe(`Bearer ${CLE_PLATEFORME_FACTICE}`);
  });

  it("constat 6 : avec la 2FA active, la clé exige aussi le code de vérification", async () => {
    const c = await cabinetTest(ctx, "Cabinet IA 2FA");
    const init = attendre(
      200,
      await c.associe.post("/api/auth/2fa/initialiser", { mot_de_passe: MOT_DE_PASSE_TEST }),
    );
    const secret = init.secret as string;
    const code = () => totp(base32Decoder(secret), Date.now());
    attendre(200, await c.associe.post("/api/auth/2fa/activer", { code: code() }));
    // Anti-rejeu : le pas de temps de l'activation est réutilisable dans ce test.
    await proprietaire((x) =>
      x.query("UPDATE utilisateurs_2fa SET dernier_pas = NULL WHERE utilisateur_id = $1", [
        c.associeId,
      ]),
    );
    const sansCode = await c.associe.put("/api/ia/parametres", {
      cle_api: CLE_CABINET_FACTICE,
      ...CONFIRMATION,
    });
    expect(sansCode.statusCode).toBe(403);
    expect(sansCode.json().erreur.code).toBe("CONFIRMATION_REQUISE");
    const mauvais = await c.associe.put("/api/ia/parametres", {
      cle_api: CLE_CABINET_FACTICE,
      confirmation: { mot_de_passe: MOT_DE_PASSE_TEST, code: "000000" },
    });
    expect(mauvais.statusCode).toBe(401);
    expect(attendre(200, await c.associe.get("/api/ia/parametres")).cle_configuree).toBe(false);
    const ok = attendre(
      200,
      await c.associe.put("/api/ia/parametres", {
        cle_api: CLE_CABINET_FACTICE,
        confirmation: { mot_de_passe: MOT_DE_PASSE_TEST, code: code() },
      }),
    );
    expect(ok.cle_configuree).toBe(true);
    const journal = await lignes<{ d: string }>(
      "SELECT details::text AS d FROM journal_audit WHERE cabinet_id = $1 AND action = 'modification_parametres_ia'",
      [c.cabinetId],
    );
    expect(journal.map((x) => x.d).join(" ")).toContain('"facteur": "totp"');
  });

  it("constat 9 : modèle par tâche : seuls les modèles au tarif connu, retour au recommandé par null", async () => {
    expect(
      (await a.associe.put("/api/ia/parametres", { modeles: { redaction: "../../x" } })).statusCode,
    ).toBe(400);
    for (const inconnu of ["inconnu/modele", "anthropic/claude-sonnet-4.5:online"]) {
      const r = await a.associe.put("/api/ia/parametres", { modeles: { redaction: inconnu } });
      expect(r.statusCode, inconnu).toBe(400);
    }
    attendre(
      200,
      await a.associe.put("/api/ia/parametres", { modeles: { redaction: "openai/gpt-4o-mini" } }),
    );
    serveur.requetes.length = 0;
    attendre(201, await a.associe.post("/api/ia/generations", generation()));
    expect(serveur.requetes[0]!.corps.model).toBe("openai/gpt-4o-mini");
    const vue = attendre(
      200,
      await a.associe.put("/api/ia/parametres", { modeles: { redaction: null } }),
    );
    expect(vue.modeles.find((m: { tache: string }) => m.tache === "redaction")).toMatchObject({
      modele: "anthropic/claude-sonnet-4.5",
      personnalise: false,
    });
  });

  it("test du fournisseur : appel minimal, compté ; clé refusée → 502 sans la clé, réservation soldée", async () => {
    serveur.repondre(() => ({ contenu: "OK", usage: { prompt_tokens: 10, completion_tokens: 1 } }));
    const ok = attendre(
      200,
      await a.associe.post("/api/ia/parametres/tester", { tache: "redaction" }),
    );
    expect(ok).toMatchObject({
      ok: true,
      source_cle: "plateforme",
      modele: "anthropic/claude-sonnet-4.5",
    });
    serveur.repondre(() => ({ statut: 401, brut: "{}" }));
    const ko = await a.associe.post("/api/ia/parametres/tester", {});
    expect(ko.statusCode).toBe(502);
    expect(ko.json().erreur.code).toBe("CLE_REFUSEE");
    expect(ko.body).not.toContain(CLE_PLATEFORME_FACTICE);
    expect(
      await lignes("SELECT id FROM ia_reservations WHERE cabinet_id = $1", [a.cabinetId]),
    ).toHaveLength(0);
  });
});

describe("génération : masquage, garde-chiffres, traçabilité, validation humaine", () => {
  it("constat 12 : masque avant envoi, démasque, signale les nombres inventés ; trace sans modèle ni jetons sans finance.lire", async () => {
    const consultant = await a.avecRoles(["consultant"]);
    serveur.requetes.length = 0;
    serveur.repondre(() => ({
      contenu:
        "Synthèse pour [PERSONNE_1] ([EMAIL_1]) : honoraires de 2 825 000 FCFA, marge de 18 %.",
    }));
    const g = attendre(201, await consultant.post("/api/ia/generations", generation()));
    // Ce qui part chez le fournisseur : jetons, jamais les données identifiantes.
    const envoye = JSON.stringify(serveur.requetes[0]!.corps);
    expect(envoye).not.toContain("Awa Koné");
    expect(envoye).not.toContain("awa.kone@exemple.ci");
    expect(envoye).not.toContain("07 07 12 34 56");
    expect(envoye).toContain("[PERSONNE_1]");
    expect(envoye).toContain("(aucun chiffre fourni)");
    // Ce qui revient : démasqué localement ; sans chiffres de contexte, tout nombre est signalé.
    expect(g).toMatchObject({
      statut: "terminee",
      progression: 100,
      statut_contenu: "brouillon_ia",
      livrable_client: false,
      version: 1,
      gabarit: false,
      chiffres_non_verifies: true,
      nombres_non_verifies: ["2 825 000 FCFA", "18 %"],
      prompt: { nom: "resume_neutre", version: 1, exemple: true },
      sources: [],
      trace: { fournisseur: "openrouter" },
      entree: { champs: ["texte", "termes_sensibles"] },
    });
    expect(g.texte).toContain("Synthèse pour Awa Koné (awa.kone@exemple.ci)");
    expect(g.entree.empreinte).toMatch(/^[0-9a-f]{64}$/);
    // Modèle, jetons et coût : données de gestion, absents sans finance.lire, présents pour l'associé.
    expect(Object.keys(g.trace).sort()).toEqual(["duree_ms", "fournisseur"]);
    const vueAssocie = attendre(200, await a.associe.get(`/api/ia/generations/${g.id}`));
    expect(vueAssocie.trace).toMatchObject({
      modele: "anthropic/claude-sonnet-4.5",
      tokens_entree: 1200,
      tokens_sortie: 300,
      cout_micro_usd: 8100,
    });
    const liste = attendre(200, await consultant.get("/api/ia/generations"));
    const ligne = liste.elements.find((x: { id: string }) => x.id === g.id);
    expect(Object.keys(ligne.trace).sort()).toEqual(["duree_ms", "fournisseur"]);
    // L'entrée n'est stockée nulle part en clair (demande, journal).
    const fuite = await proprietaire(async (c) => {
      const d = await c.query("SELECT row_to_json(d)::text AS t FROM ia_demandes d WHERE id = $1", [
        g.id,
      ]);
      const j = await c.query("SELECT details::text AS t FROM journal_audit WHERE entite_id = $1", [
        g.id,
      ]);
      return [...d.rows, ...j.rows].map((x) => x.t as string).join(" ");
    });
    expect(fuite).not.toContain("Awa");
    expect(fuite).not.toContain("diagnostic");

    // Validation : pas par le demandeur ; chiffres non vérifiés → acquittement explicite.
    expect(
      (
        await consultant.post(`/api/ia/generations/${g.id}/valider`, { acquitte_chiffres: true })
      ).json().erreur.code,
    ).toBe("APPROBATION_REQUISE");
    const relecteur = await a.avecRoles(["consultant"]);
    expect((await relecteur.get(`/api/ia/generations/${g.id}`)).statusCode).toBe(404);
    // Sans mission : visible du demandeur et d'ia.configurer seulement.
    expect((await a.directeur.post(`/api/ia/generations/${g.id}/valider`, {})).statusCode).toBe(
      404,
    );
    const refus = await a.associe.post(`/api/ia/generations/${g.id}/valider`, {});
    expect(refus.statusCode).toBe(409);
    expect(refus.json().erreur.code).toBe("CHIFFRES_NON_VERIFIES");
    const valide = attendre(
      200,
      await a.associe.post(`/api/ia/generations/${g.id}/valider`, { acquitte_chiffres: true }),
    );
    expect(valide).toMatchObject({
      statut_contenu: "valide",
      // Constat 4 : un essai avec un prompt « exemple » n'est jamais livrable au client.
      livrable_client: false,
      version: 2,
      chiffres_acquittes: true,
      texte: g.texte,
    });
    expect(valide.versions.map((v: { statut_contenu: string }) => v.statut_contenu)).toEqual([
      "brouillon_ia",
      "valide",
    ]);
    // Figé : ni modification ni nouvelle validation.
    const modif = await consultant.post(`/api/ia/generations/${g.id}/modifier`, { texte: "x" });
    expect(modif.json().erreur.code).toBe("CONTENU_VALIDE");
    expect((await a.associe.post(`/api/ia/generations/${g.id}/valider`, {})).statusCode).toBe(409);
  });

  it("constat 4 : chiffres de contexte fournis par le code du service (moteurs) : liste blanche et source « moteur »", async () => {
    serveur.requetes.length = 0;
    serveur.repondre(() => ({
      contenu: "Honoraires de 2 825 000 FCFA pour [PERSONNE_1] ; marge de 18 %.",
    }));
    const id = await service(a.associeId, {
      contexteChiffres: [{ libelle: "Honoraires", valeur: 2_825_000, unite: "FCFA" }],
      sources: [{ type: "moteur", id: "finance.budget", libelle: "Budget figé" }],
    });
    expect(JSON.stringify(serveur.requetes[0]!.corps)).toContain("Honoraires : 2 825 000 FCFA");
    const g = attendre(200, await a.associe.get(`/api/ia/generations/${id}`));
    expect(g).toMatchObject({
      prompt: { nom: "service_synthese", exemple: false },
      nombres_non_verifies: ["18 %"],
      sources: [{ type: "moteur", id: "finance.budget", libelle: "Budget figé" }],
      entree: { champs: ["texte", "contexte_chiffres", "termes_sensibles"] },
      texte: "Honoraires de 2 825 000 FCFA pour Awa Koné ; marge de 18 %.",
    });
  });

  it("constat 5 : séparation des tâches A/B/A : ni le demandeur ni l'auteur d'une version ne valide (sauf associé)", async () => {
    const mission = await creerMissionAvecChef();
    serveur.repondre(() => ({ contenu: "Le chiffre d'affaires progresse de 7 %." }));
    // A (chef) demande ; B (directeur) modifie ; A modifie à son tour.
    const id = await service(a.chef.utilisateurId, { entite: { missionId: mission } });
    const g = attendre(200, await a.chef.get(`/api/ia/generations/${id}`));
    expect(g).toMatchObject({ mission_id: mission, chiffres_non_verifies: true });
    const etranger = await a.avecRoles(["consultant"]);
    expect((await etranger.get(`/api/ia/generations/${id}`)).statusCode).toBe(404);
    const m = attendre(
      200,
      await a.directeur.post(`/api/ia/generations/${id}/modifier`, {
        texte: "Le chiffre d'affaires progresse.",
      }),
    );
    expect(m).toMatchObject({
      statut_contenu: "modifie",
      version: 2,
      chiffres_non_verifies: false,
    });
    attendre(
      200,
      await a.chef.post(`/api/ia/generations/${id}/modifier`, {
        texte: "Le chiffre d'affaires progresse nettement.",
      }),
    );
    // B n'est plus l'auteur de la dernière version, mais d'une version : refus. A : demandeur, refus.
    for (const qui of [a.directeur, a.chef]) {
      const r = await qui.post(`/api/ia/generations/${id}/valider`, {});
      expect(r.statusCode).toBe(403);
      expect(r.json().erreur.code).toBe("APPROBATION_REQUISE");
    }
    const v = attendre(200, await a.associe.post(`/api/ia/generations/${id}/valider`, {}));
    expect(v).toMatchObject({
      statut_contenu: "valide",
      livrable_client: true,
      version: 4,
      texte: "Le chiffre d'affaires progresse nettement.",
    });
    expect(v.versions).toHaveLength(4);
  });

  it("sortie structurée validée par Zod ; sortie non conforme → gabarit, appel compté", async () => {
    serveur.repondre(() => ({
      contenu: '{"tonalite": "positif", "justification": "Ton enthousiaste."}',
    }));
    const ok = attendre(
      201,
      await a.associe.post("/api/ia/generations", {
        prompt_nom: "classification_tonalite",
        mode: "immediat",
        variables: { texte: "Très bon accompagnement." },
      }),
    );
    expect(ok).toMatchObject({
      tache: "classification",
      gabarit: false,
      donnees: { tonalite: "positif", justification: "Ton enthousiaste." },
    });
    serveur.repondre(() => ({ contenu: '{"tonalite": "excellent"}' }));
    const repli = attendre(
      201,
      await a.associe.post("/api/ia/generations", {
        prompt_nom: "classification_tonalite",
        mode: "immediat",
        variables: { texte: "Retour neutre." },
      }),
    );
    expect(repli).toMatchObject({
      gabarit: true,
      statut_contenu: "brouillon_ia",
      donnees: { tonalite: "neutre", justification: expect.stringContaining("gabarit") },
      trace: { fournisseur: "gabarit" },
    });
    expect(
      await lignes("SELECT issue, source_cle FROM ia_consommations WHERE demande_id = $1", [
        repli.id,
      ]),
    ).toEqual([{ issue: "sortie_invalide", source_cle: "plateforme" }]);
  });

  it("constat 4 : entrées refusées : prompt non exemple, variables, chiffres, source moteur, mission par HTTP ; mission clôturée", async () => {
    attendre(
      201,
      await a.associe.post("/api/ia/prompts", {
        nom: "service_interne",
        tache: "redaction",
        gabarit_utilisateur: "{{texte}}",
        schema_sortie: { type: "texte" },
      }),
    );
    const refus = async (corps: Record<string, unknown>, statut = 400) => {
      const r = await a.associe.post("/api/ia/generations", corps);
      expect(r.statusCode, JSON.stringify(corps)).toBe(statut);
      return r.body;
    };
    await refus({ prompt_nom: "service_interne", variables: { texte: "x" } });
    await refus({ prompt_nom: "resume_neutre" });
    await refus({ prompt_nom: "resume_neutre", variables: { texte: "x", autre: "y" } });
    await refus({ prompt_nom: "inexistant" }, 404);
    expect(
      await refus(
        generation({ contexte_chiffres: [{ libelle: "Marge", valeur: 0.18, unite: "%" }] }),
      ),
    ).toContain("fournis par le serveur");
    expect(
      await refus(
        generation({ sources: [{ type: "moteur", id: "finance.budget", libelle: "Inventé" }] }),
      ),
    ).toContain("moteur");
    const mission = await creerMissionAvecChef();
    expect(await refus(generation({ mission_id: mission }))).toContain("aucune mission");
    const etranger = await a.avecRoles(["consultant"]);
    expect(
      (
        await etranger.post(
          "/api/ia/generations",
          generation({ sources: [{ type: "mission", id: mission, libelle: "Mission" }] }),
        )
      ).statusCode,
    ).toBe(400);

    // Code des services (orchestrateur) : mission clôturée → 409 ; essai rattaché à une mission → 400.
    const close = await creerMissionAvecChef();
    await proprietaire((c) =>
      c.query(
        `UPDATE missions SET statut = 'cloturee', cloturee_le = now(), cloturee_par = $2,
           date_signature = '2026-10-01', signee_par = $2, taux_change = 1, devise_reference = 'XOF'
         WHERE id = $1`,
        [close, a.associeId],
      ),
    );
    await expect(service(a.associeId, { entite: { missionId: close } })).rejects.toMatchObject({
      statut: 409,
    });
    const auth = await authDe(ctx, a.cabinetId, a.associeId);
    await expect(
      genererContenu(
        ctx.db,
        { config: ctx.config },
        {
          promptNom: "resume_neutre",
          variables: { texte: "x" },
          entite: { missionId: mission },
          utilisateur: auth,
        },
      ),
    ).rejects.toMatchObject({ statut: 400 });
    // Défense en profondeur : la génération de test refuse chiffres et sources « moteur » même hors HTTP.
    await expect(
      genererContenu(
        ctx.db,
        { config: ctx.config },
        {
          promptNom: "resume_neutre",
          variables: { texte: "x" },
          contexteChiffres: [{ libelle: "Marge", valeur: 0.18 }],
          utilisateur: auth,
          exempleSeulement: true,
        },
      ),
    ).rejects.toMatchObject({ statut: 400 });
  });

  it("constat 13 : quota de générations par utilisateur et par jour, vérifié avant tout appel", async () => {
    const u = await a.avecRoles(["consultant"]);
    serveur.repondre(() => ({ contenu: "Synthèse." }));
    const premiere = attendre(
      201,
      await u.post("/api/ia/generations", generation({ variables: { texte: "Bon climat." } })),
    );
    await proprietaire((c) =>
      c.query(
        `INSERT INTO ia_demandes (cabinet_id, tache, prompt_id, prompt_nom, prompt_version,
           demandeur_id, statut, progression, entree_empreinte, entree_cle_version, entree_champs,
           termine_le)
         SELECT d.cabinet_id, d.tache, d.prompt_id, d.prompt_nom, d.prompt_version, d.demandeur_id,
           'terminee', 100, d.entree_empreinte, d.entree_cle_version, d.entree_champs, now()
         FROM ia_demandes d, generate_series(1, $2) WHERE d.id = $1`,
        [premiere.id, QUOTA_GENERATIONS_UTILISATEUR_JOUR - 2],
      ),
    );
    // QUOTA − 1 demandes aujourd'hui : une dernière passe, la suivante est refusée.
    attendre(
      201,
      await u.post("/api/ia/generations", generation({ variables: { texte: "Bon." } })),
    );
    serveur.requetes.length = 0;
    const refus = await u.post("/api/ia/generations", generation({ variables: { texte: "Bon." } }));
    expect(refus.statusCode).toBe(429);
    expect(refus.json().erreur.code).toBe("QUOTA_IA_UTILISATEUR");
    expect(serveur.requetes).toHaveLength(0);
    // Un autre utilisateur du cabinet n'est pas concerné.
    attendre(201, await a.associe.post("/api/ia/generations", generation()));
  });
});

describe("repli déterministe, clé illisible et plafonds", () => {
  it("IA désactivée : gabarit, aucun appel au fournisseur, même circuit de validation", async () => {
    attendre(200, await a.associe.put("/api/ia/parametres", { ia_activee: false }));
    const etat = attendre(200, await a.associe.get("/api/ia/parametres"));
    expect(etat.mode).toBe("gabarit");
    serveur.requetes.length = 0;
    const g = attendre(201, await a.associe.post("/api/ia/generations", generation()));
    expect(serveur.requetes).toHaveLength(0);
    expect(g).toMatchObject({
      gabarit: true,
      statut_contenu: "brouillon_ia",
      chiffres_non_verifies: true, // l'extrait du texte cite un numéro de téléphone : à acquitter
      trace: { fournisseur: "gabarit" },
    });
    expect(g.texte).toContain("gabarit déterministe");
    attendre(200, await a.associe.put("/api/ia/parametres", { ia_activee: true }));
  });

  it("sans aucune clé (ni cabinet ni plateforme) : gabarit", async () => {
    const sansCle = await demarrerIa(serveur.url, { OPENROUTER_API_KEY: undefined });
    try {
      const c = await cabinetTest(sansCle, "Cabinet IA sans clé");
      attendre(200, await c.associe.put("/api/ia/parametres", { ia_activee: true }));
      expect(attendre(200, await c.associe.get("/api/ia/parametres"))).toMatchObject({
        source_cle: null,
        mode: "gabarit",
      });
      serveur.requetes.length = 0;
      const g = attendre(
        201,
        await c.associe.post(
          "/api/ia/generations",
          generation({ variables: { texte: "Bon climat." } }),
        ),
      );
      expect(serveur.requetes).toHaveLength(0);
      expect(g).toMatchObject({ gabarit: true, chiffres_non_verifies: false });
    } finally {
      await sansCle.fermer();
    }
  });

  it("constat 7 : clé du cabinet illisible : gabarit et alerte, jamais la clé de plateforme ; rechiffrement après rotation", async () => {
    const c = await cabinetTest(ctx, "Cabinet IA clé illisible");
    attendre(
      200,
      await c.associe.put("/api/ia/parametres", {
        ia_activee: true,
        cle_api: CLE_CABINET_FACTICE,
        ...CONFIRMATION,
      }),
    );
    await proprietaire((x) =>
      x.query("UPDATE ia_parametres_cabinet SET cle_chiffree = $2 WHERE cabinet_id = $1", [
        c.cabinetId,
        randomBytes(64),
      ]),
    );
    serveur.requetes.length = 0;
    serveur.repondre(() => ({ contenu: "Synthèse." }));
    for (let i = 0; i < 2; i++) {
      const g = attendre(201, await c.associe.post("/api/ia/generations", generation()));
      expect(g).toMatchObject({ gabarit: true, trace: { fournisseur: "gabarit" } });
    }
    expect(serveur.requetes).toHaveLength(0);
    // Une alerte aux associés (une par jour au plus).
    expect(
      await lignes(
        "SELECT type FROM notifications WHERE cabinet_id = $1 AND type = 'ia_cle_illisible'",
        [c.cabinetId],
      ),
    ).toHaveLength(1);
    const journal = await lignes<{ d: string }>(
      "SELECT details::text AS d FROM journal_audit WHERE cabinet_id = $1 AND action = 'generation_ia'",
      [c.cabinetId],
    );
    expect(journal[0]!.d).toContain("cle_illisible");
    const essai = await c.associe.post("/api/ia/parametres/tester", {});
    expect(essai.statusCode).toBe(409);
    expect(essai.json().erreur.code).toBe("CLE_IA_ILLISIBLE");
    expect(serveur.requetes).toHaveLength(0);

    // Rotation : un chiffré de l'ancienne clé maître est lu, puis rechiffré avec la nouvelle.
    const chiffre = chiffrerCle(
      trousseauDepuisConfig(ctx.config),
      c.cabinetId,
      CLE_CABINET_FACTICE,
    );
    await proprietaire((x) =>
      x.query(
        "UPDATE ia_parametres_cabinet SET cle_chiffree = $2, cle_version = $3 WHERE cabinet_id = $1",
        [c.cabinetId, chiffre.donnees, chiffre.version],
      ),
    );
    const NOUVELLE = "nouvelle-cle-maitre-de-test-ia-0000000001";
    const rotation: Config = {
      ...ctx.config,
      TFA_MASTER_KEY: NOUVELLE,
      TFA_MASTER_KEY_PRECEDENTE: ctx.config.TFA_MASTER_KEY,
    };
    expect(
      await ctx.db.withTenant(c.cabinetId, (db) => resoudreCle(db, rotation, c.cabinetId)),
    ).toEqual({ statut: "ok", cle: CLE_CABINET_FACTICE, source: "cabinet" });
    const [ligne] = await lignes<{ cle_version: number }>(
      "SELECT cle_version FROM ia_parametres_cabinet WHERE cabinet_id = $1",
      [c.cabinetId],
    );
    expect(ligne!.cle_version).toBe(versionDeCle(NOUVELLE));
    const apres: Config = { ...ctx.config, TFA_MASTER_KEY: NOUVELLE };
    delete apres.TFA_MASTER_KEY_PRECEDENTE;
    expect(
      await ctx.db.withTenant(c.cabinetId, (db) => resoudreCle(db, apres, c.cabinetId)),
    ).toMatchObject({ statut: "ok", source: "cabinet" });
  });

  it("plafond mensuel : alerte à 80 %, refus 409 avant l'appel, gabarit si demandé", async () => {
    const c = await cabinetTest(ctx, "Cabinet IA plafond");
    attendre(
      200,
      await c.associe.put("/api/ia/parametres", {
        ia_activee: true,
        plafond_mensuel_micro_usd: 6000,
        modeles: { redaction: "openai/gpt-4o-mini" },
      }),
    );
    // 20 000 × 150 n$ + 4 000 × 600 n$ = 5 400 µ$ : 90 % du plafond.
    serveur.repondre(() => ({
      contenu: "Synthèse.",
      usage: { prompt_tokens: 20_000, completion_tokens: 4000 },
    }));
    attendre(201, await c.associe.post("/api/ia/generations", generation()));
    const alertes = () =>
      lignes(
        "SELECT titre FROM notifications WHERE cabinet_id = $1 AND type = 'ia_plafond_alerte'",
        [c.cabinetId],
      );
    expect(await alertes()).toEqual([{ titre: "IA : 80 % du plafond mensuel consommés" }]);
    serveur.requetes.length = 0;
    const refus = await c.associe.post("/api/ia/generations", generation());
    expect(refus.statusCode).toBe(409);
    expect(refus.json().erreur.code).toBe("PLAFOND_IA_ATTEINT");
    expect(serveur.requetes).toHaveLength(0);
    const repli = attendre(
      201,
      await c.associe.post("/api/ia/generations", generation({ repli_si_plafond: true })),
    );
    expect(repli).toMatchObject({ gabarit: true });
    expect(serveur.requetes).toHaveLength(0);
    expect(await alertes()).toHaveLength(1);
    const couts = attendre(200, await c.associe.get("/api/ia/couts"));
    expect(couts).toMatchObject({
      unite: "micro_usd",
      cout_micro_usd: 5400,
      appels: 1,
      plafond_mensuel_micro_usd: 6000,
      plafond_effectif_micro_usd: 6000,
      part_plafond: 0.9,
    });
    expect(couts.historique).toHaveLength(12);
  });

  it("constat 1 : N appels immédiats simultanés ne dépassent pas le plafond (réservation sous verrou)", async () => {
    const parallele = await demarrerIa(serveur.url, { IA_TIMEOUT_MS: 30_000 });
    try {
      const c = await cabinetTest(parallele, "Cabinet IA concurrence");
      const texte = "Texte de test des appels simultanés.";
      const estimation = estimer("openai/gpt-4o-mini", texte);
      const plafond = 3 * estimation + Math.floor(estimation / 2);
      attendre(
        200,
        await c.associe.put("/api/ia/parametres", {
          ia_activee: true,
          plafond_mensuel_micro_usd: plafond,
          modeles: { redaction: "openai/gpt-4o-mini" },
        }),
      );
      const appels = verrou();
      serveur.requetes.length = 0;
      serveur.repondre(() => ({ contenu: "Synthèse.", retenue: appels.promesse }));
      const N = 25;
      let reglees = 0;
      const reponses = Array.from({ length: N }, () =>
        Promise.resolve(
          c.associe.post("/api/ia/generations", {
            prompt_nom: "resume_neutre",
            mode: "immediat",
            variables: { texte },
          }),
        ).finally(() => {
          reglees += 1;
        }),
      );
      // Trois appels retenus chez le fournisseur ; tous les autres déjà refusés.
      await attendreQue(() => reglees === N - 3 && serveur.requetes.length === 3);
      const reservees = await lignes<{ cout: string }>(
        "SELECT cout_estime_micro_usd::text AS cout FROM ia_reservations WHERE cabinet_id = $1",
        [c.cabinetId],
      );
      expect(reservees.map((r) => Number(r.cout))).toEqual([estimation, estimation, estimation]);
      appels.liberer();
      const codes = (await Promise.all(reponses)).map((r) => r.statusCode);
      expect(codes.filter((s) => s === 201)).toHaveLength(3);
      expect(codes.filter((s) => s === 409)).toHaveLength(N - 3);
      expect(serveur.requetes).toHaveLength(3);
      const couts = await lignes<{ cout: string }>(
        "SELECT cout_micro_usd::text AS cout FROM ia_consommations WHERE cabinet_id = $1",
        [c.cabinetId],
      );
      expect(couts).toHaveLength(3);
      expect(couts.reduce((s, x) => s + Number(x.cout), 0)).toBeLessThanOrEqual(plafond);
      expect(
        await lignes("SELECT id FROM ia_reservations WHERE cabinet_id = $1", [c.cabinetId]),
      ).toHaveLength(0);
    } finally {
      serveur.repondre(() => ({ contenu: "OK" }));
      await parallele.fermer();
    }
  });

  it("constat 1 : appels en erreur facturable comptés au coût estimé (délai dépassé, réponse illisible)", async () => {
    const c = await cabinetTest(ctx, "Cabinet IA erreurs facturées");
    attendre(
      200,
      await c.associe.put("/api/ia/parametres", {
        ia_activee: true,
        modeles: { redaction: "openai/gpt-4o-mini" },
      }),
    );
    const texte = "Texte des erreurs.";
    const estimation = estimer("openai/gpt-4o-mini", texte);
    for (const [reponse, issue, code] of [
      [{ brut: "pas du json" }, "reponse_invalide", "REPONSE_INVALIDE"],
      [{ contenu: "x".repeat(3 * 1024 * 1024) }, "reponse_invalide", "REPONSE_TROP_GRANDE"],
    ] as const) {
      serveur.repondre(() => reponse);
      const g = attendre(
        201,
        await c.associe.post("/api/ia/generations", {
          prompt_nom: "resume_neutre",
          mode: "immediat",
          variables: { texte },
        }),
      );
      expect(g).toMatchObject({ statut: "echec", erreur: { code }, statut_contenu: null });
      expect(
        await lignes(
          "SELECT issue, cout_micro_usd::int AS cout FROM ia_consommations WHERE demande_id = $1",
          [g.id],
        ),
      ).toEqual([{ issue, cout: estimation }]);
    }
    // Délai dépassé : fournisseur injecté (sans attendre le délai réel).
    const auth = await authDe(ctx, c.cabinetId, c.associeId);
    const { demandeId, resultat } = await genererContenu(
      ctx.db,
      {
        config: ctx.config,
        fournisseur: {
          nom: "openrouter",
          completer: async () => {
            throw new ErreurLlm("DELAI_DEPASSE", true);
          },
        },
      },
      { promptNom: "resume_neutre", variables: { texte }, utilisateur: auth },
    );
    expect(resultat.statut).toBe("echec");
    expect(
      await lignes(
        "SELECT issue, cout_micro_usd::int AS cout FROM ia_consommations WHERE demande_id = $1",
        [demandeId],
      ),
    ).toEqual([{ issue: "delai_depasse", cout: estimation }]);
    expect(
      await lignes("SELECT id FROM ia_reservations WHERE cabinet_id = $1", [c.cabinetId]),
    ).toHaveLength(0);
    serveur.repondre(() => ({ contenu: "OK" }));
  });

  it("constat 2 : clé de plateforme : plafond effectif = min(plateforme, cabinet) ; source de la clé inscrite", async () => {
    const texte = "Texte court.";
    const estimation = estimer("openai/gpt-4o-mini", texte);
    const plafondPlateforme = estimation + 1000;
    const plateforme = await demarrerIa(serveur.url, {
      IA_PLAFOND_PLATEFORME_MICRO_USD: plafondPlateforme,
    });
    try {
      const c = await cabinetTest(plateforme, "Cabinet IA plafond plateforme");
      const vue = attendre(
        200,
        await c.associe.put("/api/ia/parametres", {
          ia_activee: true,
          modeles: { redaction: "openai/gpt-4o-mini" },
        }),
      );
      expect(vue).toMatchObject({
        source_cle: "plateforme",
        plafond_mensuel_micro_usd: 50_000_000,
        plafond_plateforme_micro_usd: plafondPlateforme,
        plafond_effectif_micro_usd: plafondPlateforme,
      });
      // 20 000 × 150 n$ + 4 000 × 600 n$ = 5 400 µ$ : au-delà du plafond de plateforme.
      serveur.repondre(() => ({
        contenu: "Synthèse.",
        usage: { prompt_tokens: 20_000, completion_tokens: 4000 },
      }));
      const corps = { prompt_nom: "resume_neutre", mode: "immediat", variables: { texte } };
      attendre(201, await c.associe.post("/api/ia/generations", corps));
      const refus = await c.associe.post("/api/ia/generations", corps);
      expect(refus.statusCode).toBe(409);
      expect(refus.json().erreur.code).toBe("PLAFOND_IA_ATTEINT");
      // Clé du cabinet : le cabinet paie, seul son plafond s'applique.
      const avecCle = attendre(
        200,
        await c.associe.put("/api/ia/parametres", {
          cle_api: CLE_CABINET_FACTICE,
          ...CONFIRMATION,
        }),
      );
      expect(avecCle.plafond_effectif_micro_usd).toBe(50_000_000);
      serveur.requetes.length = 0;
      attendre(201, await c.associe.post("/api/ia/generations", corps));
      expect(serveur.requetes[0]!.entetes.authorization).toBe(`Bearer ${CLE_CABINET_FACTICE}`);
      expect(
        await lignes(
          "SELECT source_cle FROM ia_consommations WHERE cabinet_id = $1 ORDER BY cree_le",
          [c.cabinetId],
        ),
      ).toEqual([{ source_cle: "plateforme" }, { source_cle: "cabinet" }]);
    } finally {
      await plateforme.fermer();
    }
  });
});

describe("prompts versionnés", () => {
  it("nouvelle version active, historique, réactivation, tâche figée, gabarit invalide", async () => {
    const v2 = attendre(
      201,
      await a.associe.post("/api/ia/prompts", {
        nom: "reformulation",
        tache: "redaction",
        exemple: true,
        gabarit_systeme: "Consigne v2.",
        gabarit_utilisateur: "Reformule : {{texte}}\n{{chiffres}}",
        schema_sortie: { type: "texte" },
      }),
    );
    expect(v2).toMatchObject({
      nom: "reformulation",
      version: 2,
      actif: true,
      variables: ["texte", "chiffres"],
    });
    const versions = attendre(
      200,
      await (await a.avecRoles(["consultant"])).get("/api/ia/prompts?nom=reformulation"),
    );
    expect(
      versions.elements.map((p: { version: number; actif: boolean }) => [p.version, p.actif]),
    ).toEqual([
      [2, true],
      [1, false],
    ]);
    serveur.repondre(() => ({ contenu: "Texte reformulé." }));
    const g = attendre(
      201,
      await a.associe.post("/api/ia/generations", {
        prompt_nom: "reformulation",
        mode: "immediat",
        variables: { texte: "brut" },
      }),
    );
    expect(g.prompt).toMatchObject({ nom: "reformulation", version: 2 });
    const v1 = versions.elements[1].id as string;
    expect(attendre(200, await a.associe.post(`/api/ia/prompts/${v1}/activer`, {})).actif).toBe(
      true,
    );
    const liste = attendre(200, await a.associe.get("/api/ia/prompts"));
    expect(liste.elements.find((p: { nom: string }) => p.nom === "reformulation")).toMatchObject({
      version: 1,
      actif: true,
    });
    const autreTache = await a.associe.post("/api/ia/prompts", {
      nom: "reformulation",
      tache: "analyse",
      gabarit_utilisateur: "{{texte}}",
      schema_sortie: { type: "texte" },
    });
    expect(autreTache.statusCode).toBe(409);
    expect(
      (
        await a.associe.post("/api/ia/prompts", {
          nom: "mauvais",
          tache: "redaction",
          gabarit_utilisateur: "{{ texte }}",
          schema_sortie: { type: "texte" },
        })
      ).statusCode,
    ).toBe(400);
  });
});

describe("isolation entre cabinets", () => {
  it("générations, prompts, paramètres et coûts d'un autre cabinet : invisibles (404, listes vides)", async () => {
    serveur.repondre(() => ({ contenu: "Synthèse A." }));
    const g = attendre(201, await a.associe.post("/api/ia/generations", generation()));
    for (const r of [
      await b.associe.get(`/api/ia/generations/${g.id}`),
      await b.associe.post(`/api/ia/generations/${g.id}/modifier`, { texte: "x" }),
      await b.associe.post(`/api/ia/generations/${g.id}/valider`, { acquitte_chiffres: true }),
      await b.associe.post(`/api/ia/generations/${g.id}/annuler`, {}),
    ]) {
      expect(r.statusCode).toBe(404);
    }
    const listeB = attendre(200, await b.associe.get("/api/ia/generations"));
    expect(listeB.elements.map((x: { id: string }) => x.id)).not.toContain(g.id);
    const promptsB = attendre(200, await b.associe.get("/api/ia/prompts"));
    expect(promptsB.elements.map((p: { nom: string }) => p.nom)).not.toContain("service_interne");
    const promptA = attendre(200, await a.associe.get("/api/ia/prompts?nom=service_interne"))
      .elements[0];
    expect((await b.associe.post(`/api/ia/prompts/${promptA.id}/activer`, {})).statusCode).toBe(
      404,
    );
    // La clé et les réglages de A ne s'appliquent pas à B.
    attendre(
      200,
      await a.associe.put("/api/ia/parametres", { cle_api: CLE_CABINET_FACTICE, ...CONFIRMATION }),
    );
    serveur.requetes.length = 0;
    attendre(201, await b.associe.post("/api/ia/generations", generation()));
    expect(serveur.requetes[0]!.entetes.authorization).toBe(`Bearer ${CLE_PLATEFORME_FACTICE}`);
    attendre(200, await a.associe.put("/api/ia/parametres", { cle_api: null, ...CONFIRMATION }));
    const coutsB = attendre(200, await b.associe.get("/api/ia/couts"));
    expect(coutsB.appels).toBe(1);
  });

  it("en SQL, sous le contexte de B : aucune ligne IA de A, écriture croisée refusée", async () => {
    const tables = [
      "ia_parametres_cabinet",
      "ia_modeles_taches",
      "ia_alertes_plafond",
      "ia_prompts",
      "ia_prompt_activations",
      "ia_demandes",
      "ia_generations",
      "ia_consommations",
      "ia_reservations",
    ];
    const demandeA = await ctx.db.withTenant(
      a.cabinetId,
      async (db) => (await db.query("SELECT id FROM ia_demandes LIMIT 1")).rows[0].id as string,
    );
    await ctx.db.withTenant(b.cabinetId, async (db) => {
      for (const t of tables) {
        const r = await db.query(`SELECT count(*)::int AS n FROM ${t} WHERE cabinet_id = $1`, [
          a.cabinetId,
        ]);
        expect(r.rows[0].n, t).toBe(0);
      }
    });
    await expect(
      ctx.db.withTenant(b.cabinetId, (db) =>
        db.query(
          `INSERT INTO ia_generations (cabinet_id, demande_id, version, statut_contenu, fournisseur,
             texte, gabarit, chiffres_non_verifies, auteur_id)
           VALUES ($1, $2, 1, 'brouillon_ia', 'gabarit', 'x', true, false, $3)`,
          [b.cabinetId, demandeA, b.associeId],
        ),
      ),
    ).rejects.toThrow();
    // Réservation d'une demande d'un autre cabinet : clé composite refusée.
    await expect(
      ctx.db.withTenant(b.cabinetId, (db) =>
        db.query(
          `INSERT INTO ia_reservations (cabinet_id, demande_id, cout_estime_micro_usd, expire_le)
           VALUES ($1, $2, 1, now() + interval '1 minute')`,
          [b.cabinetId, demandeA],
        ),
      ),
    ).rejects.toThrow();
    await expect(
      ctx.db.withTenant(b.cabinetId, (db) =>
        db.query(`INSERT INTO ia_parametres_cabinet (cabinet_id) VALUES ($1)`, [a.cabinetId]),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("ajout seul (SQL direct)", () => {
  it("UPDATE et DELETE refusés au rôle applicatif ; déclencheurs MPI côté propriétaire", async () => {
    for (const t of [
      "ia_generations",
      "ia_prompts",
      "ia_prompt_activations",
      "ia_consommations",
      "ia_alertes_plafond",
    ]) {
      await expect(
        ctx.db.withTenant(a.cabinetId, (db) => db.query(`UPDATE ${t} SET cabinet_id = cabinet_id`)),
        t,
      ).rejects.toThrow(/permission denied/);
      await expect(
        ctx.db.withTenant(a.cabinetId, (db) => db.query(`DELETE FROM ${t}`)),
        t,
      ).rejects.toThrow(/permission denied/);
    }
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query("UPDATE ia_reservations SET cabinet_id = cabinet_id"),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) => db.query("DELETE FROM ia_demandes")),
    ).rejects.toThrow(/permission denied/);
    await proprietaire(async (c) => {
      for (const t of [
        "ia_generations",
        "ia_prompts",
        "ia_prompt_activations",
        "ia_consommations",
      ]) {
        await expect(c.query(`UPDATE ${t} SET cabinet_id = cabinet_id`), t).rejects.toMatchObject({
          code: "MPI01",
        });
      }
      await expect(
        c.query(
          "UPDATE ia_demandes SET prompt_version = prompt_version + 1 WHERE cabinet_id = $1",
          [a.cabinetId],
        ),
      ).rejects.toMatchObject({ code: "MPI03" });
      // Une demande terminée ne change plus.
      await expect(
        c.query(
          "UPDATE ia_demandes SET progression = 1 WHERE cabinet_id = $1 AND statut = 'terminee'",
          [a.cabinetId],
        ),
      ).rejects.toMatchObject({ code: "MPI03" });
      // Après une validation, aucune version ne s'ajoute.
      const validee = (
        await c.query(
          `SELECT demande_id, version, auteur_id FROM ia_generations
           WHERE cabinet_id = $1 AND statut_contenu = 'valide' LIMIT 1`,
          [a.cabinetId],
        )
      ).rows[0];
      await expect(
        c.query(
          `INSERT INTO ia_generations (cabinet_id, demande_id, version, statut_contenu, fournisseur,
             texte, gabarit, chiffres_non_verifies, auteur_id)
           VALUES ($1, $2, $3, 'modifie', 'humain', 'x', false, false, $4)`,
          [a.cabinetId, validee.demande_id, validee.version + 1, validee.auteur_id],
        ),
      ).rejects.toMatchObject({ code: "MPI04" });
      // Issue de consommation hors liste : refusée par la base.
      await expect(
        c.query(
          `INSERT INTO ia_consommations (cabinet_id, tache, modele, issue, source_cle, tokens_entree,
             tokens_sortie, cout_micro_usd, tarif_connu, duree_ms)
           VALUES ($1, 'redaction', 'a/b', 'gratuit', 'plateforme', 0, 0, 0, true, 0)`,
          [a.cabinetId],
        ),
      ).rejects.toThrow(/check/i);
    });
  });
});

describe("coûts IA par mission (ratio coût/prix)", () => {
  it("coût cumulé converti dans la devise de la mission, rapporté aux honoraires figés", async () => {
    const id = await missionChiffreeSignee(a);
    serveur.repondre(() => ({ contenu: "Synthèse de mission." }));
    await service(a.associeId, { entite: { missionId: id } });
    const page = attendre(200, await a.associe.get("/api/ia/couts/missions?limite=100"));
    const ligne = page.elements.find((m: { mission_id: string }) => m.mission_id === id);
    // 8 100 µ$ → 1 centime → 6 FCFA au taux de départ ; honoraires 2 825 000 FCFA.
    expect(ligne).toMatchObject({
      cout_micro_usd: 8100,
      appels: 1,
      devise: "XOF",
      cout_devise: 6,
      prix_mission: 2_825_000,
      ratio_cout_prix: 0,
      depasse_seuil: false,
    });
    const gestionnaire = await a.avecRoles(["gestionnaire"]);
    expect((await gestionnaire.get("/api/ia/couts/missions")).statusCode).toBe(403);
  });
});

/* ----- Outils locaux ----- */

async function creerMissionAvecChef(): Promise<string> {
  const r = await a.associe.post("/api/missions", {
    intitule: "Mission IA",
    client_id: a.clientId,
    mode_facturation: "forfait",
    directeur_id: a.directeur.utilisateurId,
    chef_id: a.chef.utilisateurId,
    date_debut: "2026-11-02",
  });
  return attendre(201, r).id as string;
}

/** Mission budgétée puis signée : honoraires 2 825 000 FCFA (voir budget.test.ts). */
async function missionChiffreeSignee(c: CabinetMissions): Promise<string> {
  const id = await creerMissionAvecChef();
  const phase = attendre(
    201,
    await c.chef.post(`/api/missions/${id}/phases`, { libelle: "Diagnostic" }),
  );
  const t1 = attendre(
    201,
    await c.chef.post(`/api/missions/${id}/taches`, { parent_id: phase.id, libelle: "Entretiens" }),
  );
  const t2 = attendre(
    201,
    await c.chef.post(`/api/missions/${id}/taches`, { parent_id: phase.id, libelle: "Analyse" }),
  );
  attendre(
    200,
    await c.chef.put(`/api/missions/${id}/taches/${t1.id}/budget`, {
      lignes: [
        { grade_id: c.grades.senior, jours: 10 },
        { grade_id: c.grades.manager, jours: 2 },
      ],
    }),
  );
  attendre(
    200,
    await c.chef.put(`/api/missions/${id}/taches/${t2.id}/budget`, {
      lignes: [{ collaborateur_id: c.collaborateurs.senior, jours: 3 }],
    }),
  );
  attendre(
    200,
    await c.associe.post(`/api/missions/${id}/signer`, { date_signature: "2026-10-01" }),
  );
  return id;
}
