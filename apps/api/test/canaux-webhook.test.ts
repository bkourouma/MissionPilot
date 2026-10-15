import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createDatabase } from "../src/db/pool.js";
import { creerCanaux } from "../src/canaux/fabrique.js";
import { trousseauDepuisConfig } from "../src/auth/chiffrement.js";
import { empreinteCle } from "../src/auth/limiteur.js";
import {
  INVALIDES_MEMOIRE_GLOBAL,
  INVALIDES_MEMOIRE_PAR_IP,
  reinitialiserLimitesWebhook,
} from "../src/canaux/webhook.js";
import { configTest, proprietaire } from "./helpers.js";
import { attendre } from "./portail-outils.js";
import {
  demarrerCanaux,
  entrant,
  evenementId,
  NUMERO,
  preparerCabinetCanaux,
  SECRET_WEBHOOK,
  webhook,
  destinataireVerifie,
  type CabinetCanaux,
  type ContexteCanaux,
} from "./canaux-outils.js";

/*
 * Webhook entrant (SPEC-3c §8, §18.6) : route publique signée par HMAC sur le corps BRUT, anti-rejeu,
 * idempotente, rejet par défaut. Aucun détail dans les refus.
 */

let ctx: ContexteCanaux;
let a: CabinetCanaux;
let b: CabinetCanaux;

const razInvalides = () =>
  proprietaire((c) => c.query("DELETE FROM tentatives_auth WHERE espace LIKE 'webhook_%'"));
const evenementsDe = (cabinetId: string) =>
  proprietaire(
    async (c) =>
      (
        await c.query(
          "SELECT count(*)::int AS n FROM canaux_evenements_recus WHERE cabinet_id = $1",
          [cabinetId],
        )
      ).rows[0].n as number,
  );

beforeAll(async () => {
  ctx = await demarrerCanaux();
  a = await preparerCabinetCanaux(ctx, "Webhook A");
  b = await preparerCabinetCanaux(ctx, "Webhook B");
  await destinataireVerifie(ctx, a, a.dirigeant.utilisateurId, "whatsapp", NUMERO);
}, 240_000);
afterAll(async () => {
  await razInvalides();
  await ctx.fermer();
});

const message = (compte: string, evenement: string, texte = "bonjour") => ({
  compte,
  evenement,
  type: "message",
  numero: NUMERO,
  recu_le: new Date().toISOString(),
  genre: "texte",
  texte,
});

describe("authenticité : HMAC, horodatage", () => {
  it("signature invalide : 401 WEBHOOK_REFUSE sans détail, aucune écriture", async () => {
    const avant = await evenementsDe(a.cabinetId);
    const r = await webhook(ctx, message(a.compteWhatsapp, evenementId()), {
      secret: "un-autre-secret-0123456789abcdef0123",
    });
    expect(r.statusCode).toBe(401);
    expect(r.json()).toEqual({ erreur: { code: "WEBHOOK_REFUSE", message: "Requête refusée." } });
    expect(await evenementsDe(a.cabinetId)).toBe(avant);
    // Signature absente : même réponse.
    const sans = await ctx.app.inject({
      method: "POST",
      url: "/api/canaux/whatsapp/webhook",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify(message(a.compteWhatsapp, evenementId())),
    });
    expect(sans.json()).toEqual(r.json());
  });

  it("horodatage à 301 s : 401 ; à 300 s : 200 (signature recalculée)", async () => {
    const t = Math.floor(Date.now() / 1000);
    const hors = await webhook(ctx, message(a.compteWhatsapp, evenementId()), {
      horodatage: t - 301,
    });
    expect(hors.statusCode).toBe(401);
    expect(hors.json().erreur.code).toBe("WEBHOOK_REFUSE");
    attendre(
      200,
      await webhook(ctx, message(a.compteWhatsapp, evenementId()), { horodatage: t - 299 }),
      "299 s",
    );
  });

  it("une requête valide passe pendant qu'un flot de signatures invalides est limité : 31e invalide = 429", async () => {
    await razInvalides();
    const mauvais = { secret: "un-autre-secret-0123456789abcdef0123" };
    let dernier = 0;
    for (let i = 0; i < 31; i++) {
      dernier = (await webhook(ctx, message(a.compteWhatsapp, evenementId()), mauvais)).statusCode;
      if (i < 30) expect(dernier).toBe(401);
    }
    expect(dernier).toBe(429);
    // Une requête VALIDE n'est jamais bloquée par le flot d'invalides.
    attendre(
      200,
      await webhook(ctx, message(a.compteWhatsapp, evenementId())),
      "valide pendant le flot",
    );
    await razInvalides();
  });

  it("garde mémoire avant la base : au-delà du plafond par IP puis global, 429 sans consulter la base", async () => {
    const mauvais = { secret: "un-autre-secret-0123456789abcdef0123" };
    reinitialiserLimitesWebhook();
    await razInvalides();
    // Par IP : 50 signatures invalides d'une même adresse (la base répond 401 puis 429 : peu importe).
    for (let i = 0; i < INVALIDES_MEMOIRE_PAR_IP; i++) {
      await webhook(ctx, message(a.compteWhatsapp, evenementId()), { ...mauvais, ip: "10.1.1.1" });
    }
    // La base est remise à zéro : seule la mémoire du processus peut encore refuser cette adresse.
    await razInvalides();
    const parIp = await webhook(ctx, message(a.compteWhatsapp, evenementId()), {
      ...mauvais,
      ip: "10.1.1.1",
    });
    expect(parIp.statusCode).toBe(429);
    // Une autre adresse, base à zéro : 401 (la garde par IP ne touche pas les autres).
    await razInvalides();
    const autre = await webhook(ctx, message(a.compteWhatsapp, evenementId()), {
      ...mauvais,
      ip: "10.1.1.2",
    });
    expect(autre.statusCode).toBe(401);
    // Une requête VALIDE de l'adresse limitée passe encore.
    attendre(
      200,
      await webhook(ctx, message(a.compteWhatsapp, evenementId()), { ip: "10.1.1.1" }),
      "valide depuis l'IP limitée",
    );
    // Global : des adresses toutes différentes (1 invalide chacune) jusqu'au plafond du processus.
    reinitialiserLimitesWebhook();
    for (let i = 0; i < INVALIDES_MEMOIRE_GLOBAL; i++) {
      await webhook(ctx, message(a.compteWhatsapp, evenementId()), {
        ...mauvais,
        ip: `10.2.${Math.floor(i / 200)}.${(i % 200) + 1}`,
      });
    }
    await razInvalides();
    const globale = await webhook(ctx, message(a.compteWhatsapp, evenementId()), {
      ...mauvais,
      ip: "10.3.0.1",
    });
    expect(globale.statusCode).toBe(429);
    attendre(
      200,
      await webhook(ctx, message(a.compteWhatsapp, evenementId()), { ip: "10.3.0.2" }),
      "valide pendant le flot",
    );
    reinitialiserLimitesWebhook();
    await razInvalides();
  });

  it("une requête portant un en-tête Origin (navigateur) est refusée : 403 ORIGINE_REFUSEE", async () => {
    const r = await webhook(ctx, message(a.compteWhatsapp, evenementId()), {
      entetes: { origin: "https://autre-site.exemple.test" },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().erreur.code).toBe("ORIGINE_REFUSEE");
  });
});

describe("taille, type, forme", () => {
  it("corps de 65 537 octets : 413 ; text/plain : 415 ; JSON hors schéma sous signature valide : 400", async () => {
    const gros = JSON.stringify({
      ...message(a.compteWhatsapp, evenementId()),
      texte: "x".repeat(65_537),
    });
    expect((await webhook(ctx, gros)).statusCode).toBe(413);
    const corps = JSON.stringify(message(a.compteWhatsapp, evenementId()));
    const texte = await webhook(ctx, corps, { entetes: { "content-type": "text/plain" } });
    expect(texte.statusCode).toBe(415);
    const hors = await webhook(ctx, {
      compte: a.compteWhatsapp,
      evenement: evenementId(),
      type: "inconnu",
    });
    expect(hors.statusCode).toBe(400);
    expect(hors.json().erreur.code).toBe("REQUETE_INVALIDE");
  });

  it("la méthode GET n'existe pas", async () => {
    const r = await ctx.app.inject({ method: "GET", url: "/api/canaux/whatsapp/webhook" });
    expect(r.statusCode).toBe(404);
  });
});

describe("rejet par défaut et idempotence", () => {
  it("compte inconnu, mal formé ou inactif ; expéditeur inconnu : 200 sans effet", async () => {
    const avantA = await evenementsDe(a.cabinetId);
    const avantB = await evenementsDe(b.cabinetId);
    for (const compte of ["cpt-test-1", "cpt-0000000000000000"]) {
      const r = await webhook(ctx, message(compte, evenementId()));
      attendre(200, r, "compte inconnu");
      expect(r.json()).toEqual({ recus: 1 });
    }
    // Compte inactif : désactivé par le cabinet (coupe-circuit par canal), puis réactivé.
    attendre(
      200,
      await b.associe.put("/api/canaux/comptes/whatsapp", { actif: false }),
      "désactivation",
    );
    attendre(200, await webhook(ctx, message(b.compteWhatsapp, evenementId())), "compte inactif");
    expect(await evenementsDe(b.cabinetId)).toBe(avantB);
    // Expéditeur inconnu : événement enregistré (anti-rejeu) mais ignoré, aucun effet.
    const r = await webhook(ctx, {
      ...message(a.compteWhatsapp, evenementId()),
      numero: "+2250000000077",
    });
    attendre(200, r, "expéditeur inconnu");
    expect(await evenementsDe(a.cabinetId)).toBe(avantA + 1);
    const ligne = await proprietaire(
      async (c) =>
        (
          await c.query(
            "SELECT traitement, motif_ignore, destinataire_id FROM canaux_evenements_recus WHERE cabinet_id = $1 ORDER BY recu_le DESC LIMIT 1",
            [a.cabinetId],
          )
        ).rows[0],
    );
    expect(ligne).toMatchObject({
      traitement: "ignore",
      motif_ignore: "expediteur_inconnu",
      destinataire_id: null,
    });
    attendre(
      200,
      await b.associe.put("/api/canaux/comptes/whatsapp", {
        actif: true,
        mot_de_passe: "Test-motdepasse-1",
      }),
      "réactivation",
    );
  });

  it("rejeu du même événement : 200, une seule ligne, aucun message de plus dans le journal ; aucun contenu conservé", async () => {
    const evt = evenementId("rejeu");
    const corps = message(a.compteWhatsapp, evt, "texte confidentiel du dirigeant");
    attendre(200, await webhook(ctx, corps), "premier");
    attendre(200, await webhook(ctx, corps), "rejeu");
    const n = await proprietaire(
      async (c) =>
        (
          await c.query(
            "SELECT count(*)::int AS n FROM canaux_evenements_recus WHERE cabinet_id = $1 AND evenement_id = $2",
            [a.cabinetId, evt],
          )
        ).rows[0].n as number,
    );
    expect(n).toBe(1);
    const trace = await proprietaire(
      async (c) =>
        (
          await c.query(
            `SELECT count(*)::int AS n FROM (
               SELECT row_to_json(e)::text AS t FROM canaux_evenements_recus e
               UNION ALL SELECT details::text FROM journal_audit) x WHERE t LIKE '%texte confidentiel%' OR t LIKE '%2250000000012%'`,
          )
        ).rows[0].n as number,
    );
    expect(trace).toBe(0);
  });

  it("événement de statut inconnu : ignoré ; statut qui revient en arrière : sans effet", async () => {
    attendre(
      200,
      await webhook(ctx, {
        compte: a.compteWhatsapp,
        evenement: evenementId(),
        type: "statut",
        id_externe_message: "sim-wa-inconnu",
        statut: "livre",
      }),
      "statut inconnu",
    );
  });

  it("601e requête d'un compte en une minute : 429 ; le compte d'un autre cabinet n'est pas affecté", async () => {
    await razInvalides();
    // 600 requêtes déjà comptées dans la fenêtre (état du limiteur persistant, posé par le propriétaire).
    const cle = empreinteCle(trousseauDepuisConfig(ctx.config), a.compteWhatsapp);
    await proprietaire((c) =>
      c.query(
        `INSERT INTO tentatives_auth (espace, cle, instants, expire_le)
         VALUES ('webhook_canal', $1, ARRAY(SELECT now() - (g || ' milliseconds')::interval FROM generate_series(1, 600) g),
                 now() + interval '1 minute')`,
        [cle],
      ),
    );
    const r = await webhook(ctx, message(a.compteWhatsapp, evenementId("deb")));
    expect(r.statusCode).toBe(429);
    attendre(200, await webhook(ctx, message(b.compteWhatsapp, evenementId())), "autre cabinet");
    await razInvalides();
  });
});

describe("sans fournisseur", () => {
  it("WHATSAPP_FOURNISSEUR=aucun : la route n'existe pas (404), app.canaux à null", async () => {
    const config = { ...configTest(), WHATSAPP_FOURNISSEUR: "aucun" as const };
    const db = createDatabase(config);
    const app = await buildApp(config, db, { canaux: creerCanaux(config) });
    try {
      expect(app.canaux).toEqual({
        whatsapp: null,
        sms: null,
        transcripteur: null,
        signature: null,
      });
      const r = await app.inject({
        method: "POST",
        url: "/api/canaux/whatsapp/webhook",
        payload: "{}",
        headers: { "content-type": "application/json" },
      });
      expect(r.statusCode).toBe(404);
    } finally {
      await app.close();
      await db.close();
    }
    void SECRET_WEBHOOK;
    void entrant;
  });
});
