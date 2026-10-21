import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Auth } from "../src/auth/contexte.js";
import { trousseauDepuisConfig } from "../src/auth/chiffrement.js";
import { DUREE_CACHE_IA_MS, ecrireCache } from "../src/ia/cache.js";
import { creerHandlerConservationIa, planificationConservationIa } from "../src/ia/conservation.js";
import { genererContenu, type DemandeContenu } from "../src/ia/orchestrateur.js";
import { cabinetTest, type CabinetTest } from "./api.js";
import { proprietaire, type Contexte } from "./helpers.js";
import {
  attendreQue,
  authDe,
  demarrerIa,
  serveurFactice,
  verrou,
  type ServeurFactice,
} from "./ia-outils.js";

vi.setConfig({ testTimeout: 60_000 });

/*
 * Cache des réponses IA (AGT-06, migration 0278) sur le fournisseur FACTICE local : désactivé par
 * défaut, succès en cache sans appel ni coût, isolé par cabinet, jamais pour du nominatif en clair
 * ni un contenu client, expiration (horloge INJECTÉE), clé changée par une nouvelle version du
 * prompt ou un autre modèle, gardes jamais contournées, purge par le job de conservation.
 */

let serveur: ServeurFactice;
let ctx: Contexte;
let a: CabinetTest;
let b: CabinetTest;
let authA: Auth;
let authB: Auth;

function attendre<R extends { statusCode: number; body: string }>(statut: number, r: R): R {
  if (r.statusCode !== statut) throw new Error(`${r.statusCode} ${r.body}`);
  return r;
}

beforeAll(async () => {
  serveur = await serveurFactice();
  ctx = await demarrerIa(serveur.url);
  a = await cabinetTest(ctx, "Cabinet A cache IA");
  b = await cabinetTest(ctx, "Cabinet B cache IA");
  attendre(200, await a.associe.put("/api/ia/parametres", { ia_activee: true }));
  attendre(200, await b.associe.put("/api/ia/parametres", { ia_activee: true }));
  for (const c of [a, b]) {
    attendre(
      201,
      await c.associe.post("/api/ia/prompts", {
        nom: "synthese_cache",
        tache: "redaction",
        gabarit_systeme: "Tu rédiges une synthèse factuelle.",
        gabarit_utilisateur: "CHIFFRES :\n{{chiffres}}\n\nTEXTE :\n{{texte}}",
        schema_sortie: { type: "texte" },
      }),
    );
  }
  authA = await authDe(ctx, a.cabinetId, a.associeId);
  authB = await authDe(ctx, b.cabinetId, b.associeId);
});

afterAll(async () => {
  await ctx.fermer();
  await serveur.fermer();
});

const demande = (
  auth: Auth,
  texte: string,
  extra: Partial<DemandeContenu> = {},
): DemandeContenu => ({
  promptNom: "synthese_cache",
  variables: { texte },
  termesSensibles: ["Awa Koné", "Jean Dupont"],
  utilisateur: auth,
  ...extra,
});

async function generer(d: DemandeContenu, horloge?: Date) {
  const r = await genererContenu(
    ctx.db,
    { config: ctx.config, ...(horloge ? { horloge: () => horloge } : {}) },
    d,
  );
  expect(r.resultat.statut).toBe("terminee");
  return generation(d.utilisateur.cabinetId, r.demandeId);
}

const generation = (cabinetId: string, demandeId: string) =>
  ctx.db.withTenant(cabinetId, async (db) => {
    const g = (
      await db.query(
        `SELECT texte, fournisseur, modele, cout_micro_usd::int AS cout, statut_contenu, gabarit,
           chiffres_non_verifies, tokens_entree FROM ia_generations WHERE demande_id = $1`,
        [demandeId],
      )
    ).rows[0];
    const c = (
      await db.query(
        "SELECT issue, cout_micro_usd::int AS cout FROM ia_consommations WHERE demande_id = $1",
        [demandeId],
      )
    ).rows;
    const j = (
      await db.query(
        "SELECT details FROM journal_audit WHERE action = 'generation_ia' AND entite_id = $1",
        [demandeId],
      )
    ).rows[0];
    return { ...g, consommations: c, journal: j?.details, demandeId };
  });

const entreesCache = (cabinetId: string) =>
  proprietaire(
    async (cl) =>
      (
        await cl.query(
          `SELECT cle, prompt_version, modele, reponse_chiffree, cree_le, expire_le
           FROM ia_cache_reponses WHERE cabinet_id = $1 ORDER BY cree_le`,
          [cabinetId],
        )
      ).rows as {
        cle: string;
        prompt_version: number;
        modele: string;
        reponse_chiffree: Buffer;
        cree_le: Date;
        expire_le: Date;
      }[],
  );

const reservations = (cabinetId: string) =>
  proprietaire(async (cl) =>
    Number(
      (
        await cl.query("SELECT count(*)::int AS n FROM ia_reservations WHERE cabinet_id = $1", [
          cabinetId,
        ])
      ).rows[0].n,
    ),
  );

describe("cache des réponses IA (AGT-06)", () => {
  it("désactivé par défaut : routage et état lisibles, chaque génération appelle le fournisseur", async () => {
    const p = attendre(200, await a.associe.get("/api/ia/parametres")).json();
    expect(p).toMatchObject({ cache_actif: false, cache_duree_heures: 24 });
    expect(p.routage).toHaveLength(5);
    expect(p.routage[0]).toMatchObject({
      tache: "redaction",
      critere: "qualite",
      plafond_jetons_sortie: 4000,
      personnalise: false,
    });
    // Un consultant (ia.utiliser) lit aussi le routage et l'état du cache.
    const consultant = await a.avecRoles(["consultant"]);
    expect(attendre(200, await consultant.get("/api/ia/parametres")).json()).toMatchObject({
      cache_actif: false,
    });
    serveur.repondre(() => ({ contenu: "Synthèse : [PERSONNE_1] présente le projet." }));
    const n = serveur.requetes.length;
    await generer(demande(authA, "Awa Koné présente le projet de défaut."));
    await generer(demande(authA, "Awa Koné présente le projet de défaut."));
    expect(serveur.requetes.length).toBe(n + 2);
    expect(await entreesCache(a.cabinetId)).toHaveLength(0);
  });

  it("activé : la même génération est servie par le cache, sans appel ni coût, démasquée pour SA demande", async () => {
    const r = attendre(200, await a.associe.put("/api/ia/parametres", { cache_actif: true }));
    expect(r.json().cache_actif).toBe(true);
    serveur.repondre(() => ({ contenu: "Synthèse : [PERSONNE_1] présente le projet." }));
    const n = serveur.requetes.length;
    const g1 = await generer(demande(authA, "Awa Koné présente le projet."));
    expect(serveur.requetes.length).toBe(n + 1);
    expect(g1.texte).toBe("Synthèse : Awa Koné présente le projet.");
    expect(g1.journal).toMatchObject({ cache: false });
    const [entree] = await entreesCache(a.cabinetId);
    expect(entree).toBeDefined();
    // Chiffré : ni la réponse, ni le jeton, ni le nom en clair dans la ligne.
    const brut = entree!.reponse_chiffree.toString("latin1");
    for (const secret of ["Synthèse", "PERSONNE", "Awa"]) expect(brut).not.toContain(secret);
    expect(entree!.expire_le.getTime() - entree!.cree_le.getTime()).toBe(DUREE_CACHE_IA_MS);

    // Autre nom, même texte masqué : succès en cache, démasqué avec le nom de CETTE demande.
    const g2 = await generer(demande(authA, "Jean Dupont présente le projet."));
    expect(serveur.requetes.length).toBe(n + 1);
    expect(g2).toMatchObject({
      texte: "Synthèse : Jean Dupont présente le projet.",
      fournisseur: "openrouter",
      statut_contenu: "brouillon_ia",
      gabarit: false,
      cout: 0,
      tokens_entree: null,
      consommations: [{ issue: "cache", cout: 0 }],
    });
    expect(g2.texte).not.toContain("Awa");
    expect(g2.journal).toMatchObject({ cache: true, gabarit: null });
    expect(JSON.stringify(g2.journal)).not.toContain("Jean");
    expect(await reservations(a.cabinetId)).toBe(0);
    // Marque visible dans la vue de la génération (le CHECK de ia_generations.fournisseur reste inchangé).
    const vue1 = attendre(200, await a.associe.get(`/api/ia/generations/${g1.demandeId}`)).json();
    const vue2 = attendre(200, await a.associe.get(`/api/ia/generations/${g2.demandeId}`)).json();
    expect(vue1.servie_par_cache).toBe(false);
    expect(vue2.servie_par_cache).toBe(true);
    // Rapport des coûts : un succès en cache n'est pas un appel facturé.
    const couts = attendre(200, await a.associe.get("/api/ia/couts")).json();
    expect(couts.appels_cache).toBeGreaterThanOrEqual(1);
  });

  it("isolé par cabinet : même prompt et même entrée dans un autre cabinet → aucun partage", async () => {
    attendre(200, await b.associe.put("/api/ia/parametres", { cache_actif: true }));
    serveur.repondre(() => ({ contenu: "Synthèse : [PERSONNE_1] présente le projet." }));
    const n = serveur.requetes.length;
    const g = await generer(demande(authB, "Awa Koné présente le projet."));
    expect(serveur.requetes.length).toBe(n + 1);
    expect(g.consommations).toEqual([expect.objectContaining({ issue: "succes" })]);
    const clesA = (await entreesCache(a.cabinetId)).map((e) => e.cle);
    const clesB = (await entreesCache(b.cabinetId)).map((e) => e.cle);
    expect(clesB).toHaveLength(1);
    expect(clesA).not.toContain(clesB[0]);
    // RLS : le cabinet B ne voit aucune entrée du cabinet A.
    const vues = await ctx.db.withTenant(b.cabinetId, async (db) =>
      (await db.query("SELECT cle FROM ia_cache_reponses")).rows.map((x) => x.cle as string),
    );
    expect(vues).toEqual(clesB);
  });

  it("jamais pour du nominatif en clair, un contenu client ou une sortie signalée par la garde-chiffres", async () => {
    const avant = (await entreesCache(a.cabinetId)).length;
    // Réponse contenant une adresse e-mail en clair : jamais écrite.
    serveur.repondre(() => ({ contenu: "Écrire à contact@exemple.ci pour la suite." }));
    let n = serveur.requetes.length;
    await generer(demande(authA, "Texte neutre numéro un."));
    await generer(demande(authA, "Texte neutre numéro un."));
    expect(serveur.requetes.length).toBe(n + 2);
    // Réponse contenant un nom déclaré en clair (le masque ne l'a pas posé) : jamais écrite.
    serveur.repondre(() => ({ contenu: "Awa Koné présente le projet." }));
    n = serveur.requetes.length;
    await generer(demande(authA, "Texte neutre numéro deux."));
    await generer(demande(authA, "Texte neutre numéro deux."));
    expect(serveur.requetes.length).toBe(n + 2);
    // Contenu client (variable non fiable, AGT-07) : ni lu ni écrit.
    serveur.repondre(() => ({ contenu: "Synthèse du document." }));
    n = serveur.requetes.length;
    const client = { variablesNonFiables: ["texte"] };
    await generer(demande(authA, "Document du client.", client));
    await generer(demande(authA, "Document du client.", client));
    expect(serveur.requetes.length).toBe(n + 2);
    // Nombre absent de la liste blanche : sortie signalée, jamais mise en cache.
    serveur.repondre(() => ({ contenu: "La marge atteint 42 %." }));
    n = serveur.requetes.length;
    const g = await generer(demande(authA, "Texte neutre numéro trois."));
    expect(g.chiffres_non_verifies).toBe(true);
    await generer(demande(authA, "Texte neutre numéro trois."));
    expect(serveur.requetes.length).toBe(n + 2);
    expect((await entreesCache(a.cabinetId)).length).toBe(avant);
  });

  it("nouvelle version du prompt ou autre modèle → autre clé (appel au fournisseur)", async () => {
    serveur.repondre(() => ({ contenu: "Synthèse versionnée." }));
    const texte = "Texte pour les versions.";
    let n = serveur.requetes.length;
    await generer(demande(authA, texte));
    await generer(demande(authA, texte));
    expect(serveur.requetes.length).toBe(n + 1);
    attendre(
      201,
      await a.associe.post("/api/ia/prompts", {
        nom: "synthese_cache",
        tache: "redaction",
        gabarit_systeme: "Tu rédiges une synthèse factuelle.",
        gabarit_utilisateur: "CHIFFRES :\n{{chiffres}}\n\nTEXTE :\n{{texte}}",
        schema_sortie: { type: "texte" },
      }),
    );
    n = serveur.requetes.length;
    await generer(demande(authA, texte));
    expect(serveur.requetes.length).toBe(n + 1);
    await generer(demande(authA, texte));
    expect(serveur.requetes.length).toBe(n + 1);
    attendre(
      200,
      await a.associe.put("/api/ia/parametres", {
        modeles: { redaction: "anthropic/claude-haiku-4.5" },
      }),
    );
    n = serveur.requetes.length;
    await generer(demande(authA, texte));
    expect(serveur.requetes.length).toBe(n + 1);
    const entrees = await entreesCache(a.cabinetId);
    expect(
      entrees.some((e) => e.prompt_version === 2 && e.modele === "anthropic/claude-haiku-4.5"),
    ).toBe(true);
    attendre(200, await a.associe.put("/api/ia/parametres", { modeles: { redaction: null } }));
  });

  it("expiration (horloge injectée) : servie avant 24 h, jamais après ; purge par le job de conservation", async () => {
    serveur.repondre(() => ({ contenu: "Synthèse datée." }));
    const t0 = new Date(Date.now() - 3 * 86_400_000);
    const heure = (h: number) => new Date(t0.getTime() + h * 3_600_000);
    const texte = "Texte pour l'expiration.";
    const n = serveur.requetes.length;
    await generer(demande(authA, texte), t0);
    expect(serveur.requetes.length).toBe(n + 1);
    const servie = await generer(demande(authA, texte), heure(23));
    expect(servie.consommations).toEqual([{ issue: "cache", cout: 0 }]);
    expect(serveur.requetes.length).toBe(n + 1);
    const echue = await generer(demande(authA, texte), heure(25));
    expect(echue.consommations).toEqual([expect.objectContaining({ issue: "succes" })]);
    expect(serveur.requetes.length).toBe(n + 2);
    // L'entrée échue a été remplacée (une seule ligne pour cette clé, renouvelée à 25 h).
    const lignes = (await entreesCache(a.cabinetId)).filter(
      (e) => e.cree_le.getTime() >= t0.getTime() && e.cree_le.getTime() <= heure(25).getTime(),
    );
    expect(lignes.map((e) => e.cree_le.getTime())).toEqual([heure(25).getTime()]);

    // Planification : le cabinet a une entrée échue → un job de conservation lui est planifié.
    const maintenant = new Date();
    const p = planificationConservationIa(maintenant);
    await ctx.db.withoutTenant((db) =>
      db.query("SELECT planifier_conservation_ia($1, $2)", [p.cle, p.executeA]),
    );
    const jobs = await proprietaire(
      async (cl) =>
        (
          await cl.query(
            "SELECT count(*)::int AS n FROM jobs WHERE cabinet_id = $1 AND type = 'ia_conservation' AND cle = $2",
            [a.cabinetId, p.cle],
          )
        ).rows[0].n as number,
    );
    expect(jobs).toBe(1);
    const handler = creerHandlerConservationIa();
    await ctx.db.withTenant(a.cabinetId, (db) =>
      handler({ db, cabinetId: a.cabinetId, jobId: "test", charge: {}, maintenant }),
    );
    const restantes = await entreesCache(a.cabinetId);
    expect(restantes.every((e) => e.expire_le.getTime() > maintenant.getTime())).toBe(true);
    expect(restantes.length).toBeGreaterThan(0);
    const journal = await proprietaire(
      async (cl) =>
        (
          await cl.query(
            "SELECT details FROM journal_audit WHERE cabinet_id = $1 AND action = 'purge_cache_ia'",
            [a.cabinetId],
          )
        ).rows,
    );
    expect(journal[0]?.details.entrees).toBeGreaterThanOrEqual(1);
  });

  it("gardes jamais contournées : droit ia.utiliser, IA désactivée, plafond du cabinet", async () => {
    serveur.repondre(() => ({ contenu: "Synthèse gardée." }));
    const texte = "Texte pour les gardes.";
    await generer(demande(authA, texte));
    const n = serveur.requetes.length;
    // Sans « ia.utiliser » : refus, même si la réponse est en cache.
    const sansDroit = await a.avecRoles(["expert_externe"]);
    const authSans = await authDe(ctx, a.cabinetId, sansDroit.utilisateurId);
    await expect(
      genererContenu(ctx.db, { config: ctx.config }, demande(authSans, texte)),
    ).rejects.toMatchObject({ statut: 403 });
    // IA désactivée : gabarit déterministe, le cache n'est pas lu.
    attendre(200, await a.associe.put("/api/ia/parametres", { ia_activee: false }));
    const g = await generer(demande(authA, texte));
    expect(g).toMatchObject({ fournisseur: "gabarit", gabarit: true, consommations: [] });
    attendre(200, await a.associe.put("/api/ia/parametres", { ia_activee: true }));
    // Plafond du cabinet atteint : refus (ou gabarit), le cache ne le contourne pas.
    attendre(200, await a.associe.put("/api/ia/parametres", { plafond_mensuel_micro_usd: 0 }));
    await expect(
      genererContenu(ctx.db, { config: ctx.config }, demande(authA, texte)),
    ).rejects.toMatchObject({ code: "PLAFOND_IA_ATTEINT" });
    const repli = await generer(demande(authA, texte, { repliSiPlafond: true }));
    expect(repli).toMatchObject({ fournisseur: "gabarit", consommations: [] });
    expect(serveur.requetes.length).toBe(n);
  });

  it("désactivation : le cache du cabinet est vidé et la base refuse toute écriture (MQI01)", async () => {
    expect((await entreesCache(a.cabinetId)).length).toBeGreaterThan(0);
    attendre(200, await a.associe.put("/api/ia/parametres", { cache_actif: false }));
    expect(await entreesCache(a.cabinetId)).toHaveLength(0);
    expect((await entreesCache(b.cabinetId)).length).toBe(1);
    const journal = await proprietaire(
      async (cl) =>
        (
          await cl.query(
            `SELECT details FROM journal_audit WHERE cabinet_id = $1
             AND action = 'modification_parametres_ia' ORDER BY cree_le DESC LIMIT 1`,
            [a.cabinetId],
          )
        ).rows[0].details,
    );
    expect(journal).toMatchObject({ cache_actif: false });
    expect(journal.cache_entrees_supprimees).toBeGreaterThan(0);
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query(
          `INSERT INTO ia_cache_reponses (cabinet_id, cle, prompt_nom, prompt_version, tache, modele,
             reponse_chiffree, cle_version, cree_le, expire_le)
           VALUES ($1, repeat('a', 64), 'synthese_cache', 1, 'redaction',
             'anthropic/claude-sonnet-4.5', decode(repeat('00', 40), 'hex'), 2, now(),
             now() + interval '1 hour')`,
          [a.cabinetId],
        ),
      ),
    ).rejects.toMatchObject({ code: "MQI01" });
    // Durée de vie bornée en base : plus de 24 heures refusées (cabinet B, cache actif).
    await expect(
      ctx.db.withTenant(b.cabinetId, (db) =>
        db.query(
          `INSERT INTO ia_cache_reponses (cabinet_id, cle, prompt_nom, prompt_version, tache, modele,
             reponse_chiffree, cle_version, cree_le, expire_le)
           VALUES ($1, repeat('b', 64), 'synthese_cache', 1, 'redaction',
             'anthropic/claude-sonnet-4.5', decode(repeat('00', 40), 'hex'), 2, now(),
             now() + interval '25 hours')`,
          [b.cabinetId],
        ),
      ),
    ).rejects.toMatchObject({ code: "23514" });
    // Jamais modifiée par le rôle applicatif.
    await expect(
      ctx.db.withTenant(b.cabinetId, (db) =>
        db.query("UPDATE ia_cache_reponses SET expire_le = expire_le"),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("désactivation pendant une écriture : elle attend l'écriture, puis aucune entrée ne survit", async () => {
    attendre(200, await b.associe.put("/api/ia/parametres", { cache_actif: true }));
    const v = verrou();
    let ecrite: boolean | null = null;
    const ecriture = ctx.db.withTenant(b.cabinetId, async (db) => {
      ecrite = await ecrireCache(db, trousseauDepuisConfig(ctx.config), {
        cabinetId: b.cabinetId,
        cle: "c".repeat(64),
        promptNom: "synthese_cache",
        promptVersion: 1,
        tache: "redaction",
        modele: "anthropic/claude-sonnet-4.5",
        reponse: { texte: "Synthèse : [PERSONNE_1].", modele: "anthropic/claude-sonnet-4.5" },
        maintenant: new Date(),
      });
      await v.promesse; // écriture faite, transaction encore ouverte
    });
    await attendreQue(() => ecrite !== null);
    expect(ecrite).toBe(true);
    const put = Promise.resolve(b.associe.put("/api/ia/parametres", { cache_actif: false }));
    // La désactivation est bloquée par le verrou de l'écriture en cours (FOR SHARE).
    await attendreQue(() =>
      proprietaire(
        async (cl) =>
          (
            await cl.query(
              `SELECT count(*)::int AS n FROM pg_stat_activity
               WHERE datname = current_database() AND wait_event_type = 'Lock'`,
            )
          ).rows[0].n > 0,
      ),
    );
    v.liberer();
    await ecriture;
    const r = attendre(200, await put);
    expect(r.json().cache_actif).toBe(false);
    expect(await entreesCache(b.cabinetId)).toHaveLength(0);
  });
});
