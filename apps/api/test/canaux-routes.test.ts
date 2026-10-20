import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as engines from "@missionpilot/engines";
import * as shared from "@missionpilot/shared";
import { trousseauDepuisConfig, creerTrousseau, versionDeCle } from "../src/auth/chiffrement.js";
import { aadNumero, dechiffrerNumero } from "../src/canaux/numeros.js";
import { retrouverExpediteur } from "../src/canaux/destinataires.js";
import { LANGUES_SIMULEES } from "../src/canaux/transcripteur-simule.js";
import { buildApp } from "../src/app.js";
import { createDatabase } from "../src/db/pool.js";
import { creerCanaux } from "../src/canaux/fabrique.js";
import { configTest, MOT_DE_PASSE_TEST, proprietaire } from "./helpers.js";
import { attendre, inviterClient } from "./portail-outils.js";
import { fabriquerAudioDeTest } from "./audio-test.js";
import { televerser } from "./fichiers-outils.js";
import {
  demarrerCanaux,
  dernierCode,
  destinataireVerifie,
  executerJobs,
  NUMERO,
  preparerCabinetCanaux,
  type CabinetCanaux,
  type ContexteCanaux,
} from "./canaux-outils.js";

/*
 * Routes des canaux simulés (SPEC-3c §10.2 n° 1 à 14) : comptes, destinataires, « moi », simulateur ;
 * contrat des listes entre moteurs et schémas partagés ; chiffrement et rotation ; fonctions étroites.
 */

let ctx: ContexteCanaux;
let a: CabinetCanaux;
let b: CabinetCanaux;

beforeAll(async () => {
  ctx = await demarrerCanaux();
  a = await preparerCabinetCanaux(ctx, "Routes canaux A");
  b = await preparerCabinetCanaux(ctx, "Routes canaux B");
}, 240_000);
afterAll(() => ctx.fermer());

describe("contrat : listes identiques entre les moteurs et les schémas partagés", () => {
  it("catalogues, statuts, motifs, codes de refus, signature, langues, types audio, plafonds", () => {
    expect([...engines.CODES_GABARIT]).toEqual([...shared.CODES_GABARIT_CANAL]);
    expect([...engines.STATUTS_ENVOI]).toEqual([...shared.STATUTS_ENVOI_CANAL]);
    expect([...engines.CATEGORIES_ENVOI]).toEqual([...shared.CATEGORIES_ENVOI_CANAL]);
    expect([...engines.MOTIFS_BLOCAGE]).toEqual([...shared.MOTIFS_BLOCAGE_CANAL]);
    expect([...engines.CODES_REFUS_ENVOI]).toEqual([...shared.CODES_REFUS_ENVOI_CANAL]);
    expect([...engines.STATUTS_DEMANDE_SIGNATURE]).toEqual([...shared.STATUTS_DEMANDE_SIGNATURE]);
    expect([...engines.STATUTS_SIGNATAIRE]).toEqual([...shared.STATUTS_SIGNATAIRE_SIGNATURE]);
    expect([...engines.TYPES_PREUVE_SIGNATURE]).toEqual([...shared.TYPES_PREUVE_SIGNATURE]);
    expect([...LANGUES_SIMULEES]).toEqual([...shared.LANGUES_TRANSCRIPTION]);
    expect(shared.PLAFONDS_CANAUX.envoisDestinataire24h).toBe(
      engines.PLAFOND_ENVOIS_DESTINATAIRE_24H,
    );
    expect(shared.PLAFONDS_CANAUX.envoisCabinetMois).toBe(engines.PLAFOND_ENVOIS_CABINET_MOIS);
    expect(shared.PLAFONDS_CANAUX.reponsesService24h).toBe(engines.PLAFOND_REPONSES_SERVICE_24H);
    expect(shared.PLAFONDS_CANAUX.fenetreServiceHeures).toBe(engines.FENETRE_SERVICE_HEURES);
    expect(shared.PLAFONDS_TRANSCRIPTION.dureeMaxMinutes * 60_000).toBe(
      engines.TRANSCRIPTION_DUREE_MAX_MS,
    );
    expect(shared.PLAFONDS_TRANSCRIPTION.segmentsMax).toBe(engines.TRANSCRIPTION_SEGMENTS_MAX);
    // Les types audio de la liste blanche des fichiers généraux ne sont PAS étendus (décision du Pilote).
    for (const t of shared.TYPES_AUDIO)
      expect((shared.TYPES_FICHIER as readonly string[]).includes(t)).toBe(false);
  });
});

describe("comptes de canal (n° 1 et 2)", () => {
  it("401, 403, deux comptes simulés, identifiant généré par le serveur, jamais saisi ; autre cabinet distinct", async () => {
    expect((await ctx.app.inject({ method: "GET", url: "/api/canaux/comptes" })).statusCode).toBe(
      401,
    );
    const consultant = await a.avecRoles(["consultant"]);
    expect((await consultant.get("/api/canaux/comptes")).statusCode).toBe(403);
    const r = await a.chef.get("/api/canaux/comptes");
    attendre(200, r, "chef");
    const els = r.json().elements as {
      canal: string;
      mode_fournisseur: string;
      identifiant_compte: string;
      actif: boolean;
    }[];
    expect(els.map((e) => e.canal)).toEqual(["whatsapp", "sms"]);
    expect(
      els.every(
        (e) =>
          e.mode_fournisseur === "simule" &&
          e.actif &&
          /^cpt-[0-9a-f]{16}$/.test(e.identifiant_compte),
      ),
    ).toBe(true);
    const autres = (await b.chef.get("/api/canaux/comptes")).json().elements as {
      identifiant_compte: string;
    }[];
    expect(autres.map((e) => e.identifiant_compte)).not.toEqual(
      els.map((e) => e.identifiant_compte),
    );
    // L'identifiant ne se saisit pas (schéma strict).
    expect(
      (
        await a.associe.put("/api/canaux/comptes/whatsapp", {
          identifiant_compte: "cpt-0000000000000000",
        })
      ).statusCode,
    ).toBe(400);
  });

  it("PUT : corps vide ou clé inconnue 400, canal inconnu 400, chef 403, options sans reconfirmation, portail fermé", async () => {
    expect((await a.associe.put("/api/canaux/comptes/whatsapp", {})).statusCode).toBe(400);
    expect((await a.associe.put("/api/canaux/comptes/telegram", { actif: false })).statusCode).toBe(
      400,
    );
    expect(
      (await a.chef.put("/api/canaux/comptes/whatsapp", { synthese_hebdo: false })).statusCode,
    ).toBe(403);
    expect((await a.chef.put("/api/canaux/comptes/whatsapp", { actif: false })).statusCode).toBe(
      403,
    ); // le chef n'a pas canaux.gerer
    const opt = await a.associe.put("/api/canaux/comptes/whatsapp", { repli_sms: false });
    attendre(200, opt, "option sans activation");
    expect(opt.json().repli_sms).toBe(false);
    attendre(
      200,
      await a.associe.put("/api/canaux/comptes/whatsapp", { repli_sms: true }),
      "option",
    );
    // Le portail n'atteint aucune route du cabinet.
    for (const [methode, url] of [
      ["get", "/api/canaux/comptes"],
      ["get", "/api/canaux/envois"],
      ["get", "/api/canaux/moi"],
      ["get", "/api/canaux/saisies-kpi"],
    ] as const) {
      const p = await a.dirigeant[methode](url);
      expect(p.statusCode, url).toBe(403);
      expect(p.json().erreur.code).toBe("PORTAIL_ROUTE_INTERDITE");
    }
    // Journal d'audit de la modification (sans secret).
    const audit = await proprietaire(
      async (c) =>
        (
          await c.query(
            "SELECT details::text AS d FROM journal_audit WHERE action = 'canal.compte.modifier' AND cabinet_id = $1",
            [a.cabinetId],
          )
        ).rows,
    );
    expect(audit.length).toBeGreaterThan(0);
    expect(audit.some((x) => /mot_de_passe|secret/.test(x.d as string))).toBe(false);
  });
});

describe("destinataires et vérification (n° 3 à 7)", () => {
  it("liste par client : masque seulement, 400 sans client_id, 404 d'un autre cabinet, 403 sans droit", async () => {
    await destinataireVerifie(ctx, a, a.dirigeant.utilisateurId, "whatsapp", "+2250000000031");
    expect((await a.associe.get("/api/canaux/destinataires")).statusCode).toBe(400);
    expect(
      (await b.associe.get(`/api/canaux/destinataires?client_id=${a.clientId}`)).statusCode,
    ).toBe(404);
    expect((await a.avecRoles(["consultant"])).get).toBeDefined();
    const consultant = await a.avecRoles(["consultant"]);
    expect(
      (await consultant.get(`/api/canaux/destinataires?client_id=${a.clientId}`)).statusCode,
    ).toBe(403);
    const r = await a.chef.get(`/api/canaux/destinataires?client_id=${a.clientId}&limite=100`);
    attendre(200, r, "liste");
    expect(JSON.stringify(r.json())).not.toContain("2250000000031");
    const ligne = r
      .json()
      .elements.find(
        (e: { utilisateur_id: string; canal: string }) =>
          e.utilisateur_id === a.dirigeant.utilisateurId && e.canal === "whatsapp",
      );
    expect(ligne).toMatchObject({
      numero_masque: "+225…31",
      verifie: true,
      consentement: "accorde",
      consentement_source: "recueilli_cabinet",
    });
    const sms = r
      .json()
      .elements.find(
        (e: { utilisateur_id: string; canal: string }) =>
          e.utilisateur_id === a.dirigeant.utilisateurId && e.canal === "sms",
      );
    expect(sms).toMatchObject({ id: null, numero_masque: null, consentement: "absent" });
  });

  it("aperçu de la synthèse : `destinataire_id` est l'identifiant de l'UTILISATEUR ; un dirigeant sans numéro enregistré (liste : id nul) a un aperçu, la ligne de destinataire est refusée (404)", async () => {
    const sansNumero = await inviterClient(ctx, a.associe, a.clientId, ["client_dirigeant"]);
    const liste = await a.associe.get(
      `/api/canaux/destinataires?client_id=${a.clientId}&limite=100`,
    );
    attendre(200, liste, "liste");
    const lignes = liste
      .json()
      .elements.filter(
        (e: { utilisateur_id: string }) => e.utilisateur_id === sansNumero.utilisateurId,
      );
    expect(lignes.length).toBeGreaterThan(0);
    for (const l of lignes) expect(l).toMatchObject({ id: null, numero_masque: null });
    const envois = () =>
      proprietaire(
        async (c) =>
          (await c.query("SELECT count(*)::int AS n FROM canaux_envois")).rows[0].n as number,
      );
    const avant = await envois();
    const apercu = await a.associe.get(
      `/api/canaux/synthese-dirigeant/apercu?client_id=${a.clientId}&destinataire_id=${sansNumero.utilisateurId}`,
    );
    attendre(200, apercu, "aperçu sans numéro");
    expect(apercu.json()).toMatchObject({ mode_fournisseur: "simule" });
    expect(await envois()).toBe(avant);
    // Un identifiant de ligne `canaux_destinataires` n'est pas un identifiant d'utilisateur : 404.
    const ligne = (
      await a.associe.get(`/api/canaux/destinataires?client_id=${a.clientId}&limite=100`)
    )
      .json()
      .elements.find((e: { id: string | null }) => e.id !== null) as { id: string };
    expect(
      (
        await a.associe.get(
          `/api/canaux/synthese-dirigeant/apercu?client_id=${a.clientId}&destinataire_id=${ligne.id}`,
        )
      ).statusCode,
    ).toBe(404);
  });

  it("enregistrer un numéro : seulement un utilisateur du portail du client (404 sinon), numéro réel 400, 403 sans canaux.gerer", async () => {
    const put = (par: typeof a.associe, u: string, numero: string, canal = "sms") =>
      par.put(`/api/canaux/destinataires/${u}/${canal}`, { numero });
    expect((await put(a.chef, a.contributeur.utilisateurId, "+2250000000032")).statusCode).toBe(
      403,
    );
    expect((await put(a.associe, a.chef.utilisateurId, "+2250000000032")).statusCode).toBe(404); // un utilisateur du cabinet passe par « moi »
    expect((await put(b.associe, a.contributeur.utilisateurId, "+2250000000032")).statusCode).toBe(
      404,
    );
    expect(
      (await put(a.associe, a.contributeur.utilisateurId, "+33612345678")).json().erreur.code,
    ).toBe("NUMERO_REEL_REFUSE_EN_SIMULE");
    expect(
      (await put(a.associe, a.contributeur.utilisateurId, "0000000012")).json().erreur.code,
    ).toBe("NUMERO_INVALIDE");
    expect(
      (
        await a.associe.put(`/api/canaux/destinataires/${a.contributeur.utilisateurId}/fax`, {
          numero: "+2250000000032",
        })
      ).statusCode,
    ).toBe(400);
    const ok = await put(a.associe, a.contributeur.utilisateurId, "+2250000000032");
    attendre(200, ok, "numéro");
    expect(ok.json().destinataire).toMatchObject({ numero_masque: "+225…32", verifie: false });
    expect(JSON.stringify(ok.json())).not.toContain("2250000000032");
  });

  it("5 codes faux invalident le code ; code expiré : 409 CODE_EXPIRE ; 3 codes par heure : 429 TROP_DE_TENTATIVES ; autre cabinet 404", async () => {
    const r = await a.associe.put(
      `/api/canaux/destinataires/${a.contributeur.utilisateurId}/whatsapp`,
      { numero: "+2250000000033" },
    );
    attendre(200, r, "numéro");
    const id = r.json().destinataire.id as string;
    await executerJobs(ctx);
    const bon = dernierCode(ctx, "+2250000000033");
    const faux = bon === "999999" ? "888888" : "999999";
    for (let i = 1; i <= 4; i++) {
      const e = await a.associe.post(`/api/canaux/destinataires/${id}/verification`, {
        code: faux,
      });
      expect(e.statusCode).toBe(409);
      expect(e.json().erreur.code).toBe("CODE_INVALIDE");
      expect(e.json().erreur.message).toContain(`${5 - i} essai`);
    }
    // Au 5e échec, le code est invalidé : le bon code ne vaut plus.
    expect(
      (await a.associe.post(`/api/canaux/destinataires/${id}/verification`, { code: faux }))
        .statusCode,
    ).toBe(409);
    const apres = await a.associe.post(`/api/canaux/destinataires/${id}/verification`, {
      code: bon,
    });
    expect(apres.statusCode).toBe(409);
    expect(apres.json().erreur.code).toBe("CODE_EXPIRE");
    expect(
      (await b.associe.post(`/api/canaux/destinataires/${id}/verification`, { code: bon }))
        .statusCode,
    ).toBe(404);
    expect(
      (await a.associe.post(`/api/canaux/destinataires/${id}/verification`, { code: "12" }))
        .statusCode,
    ).toBe(400);
    // Nouveau code (même numéro non vérifié) puis expiration forcée.
    attendre(
      200,
      await a.associe.put(`/api/canaux/destinataires/${a.contributeur.utilisateurId}/whatsapp`, {
        numero: "+2250000000033",
      }),
      "nouveau code",
    );
    await executerJobs(ctx);
    const code2 = dernierCode(ctx, "+2250000000033");
    await proprietaire((c) =>
      c.query(
        "UPDATE canaux_destinataires SET code_expire_le = now() - interval '1 minute' WHERE id = $1",
        [id],
      ),
    );
    const expire = await a.associe.post(`/api/canaux/destinataires/${id}/verification`, {
      code: code2,
    });
    expect(expire.json().erreur.code).toBe("CODE_EXPIRE");
    // 3 codes par heure et par destinataire : le 3e est émis (2 déjà), le 4e est refusé.
    attendre(
      200,
      await a.associe.put(`/api/canaux/destinataires/${a.contributeur.utilisateurId}/whatsapp`, {
        numero: "+2250000000033",
      }),
      "3e code",
    );
    const quatrieme = await a.associe.put(
      `/api/canaux/destinataires/${a.contributeur.utilisateurId}/whatsapp`,
      { numero: "+2250000000033" },
    );
    expect(quatrieme.statusCode).toBe(429);
    expect(quatrieme.json().erreur.code).toBe("TROP_DE_TENTATIVES");
    await executerJobs(ctx);
    const code3 = dernierCode(ctx, "+2250000000033");
    attendre(
      200,
      await a.associe.post(`/api/canaux/destinataires/${id}/verification`, { code: code3 }),
      "vérification",
    );
  });

  it("historique des consentements : 404 d'un autre cabinet, 403 sans droit, pagination", async () => {
    const id = (await proprietaire(
      async (c) =>
        (
          await c.query(
            "SELECT id FROM canaux_destinataires WHERE utilisateur_id = $1 AND canal = 'whatsapp'",
            [a.dirigeant.utilisateurId],
          )
        ).rows[0].id,
    )) as string;
    expect((await b.associe.get(`/api/canaux/destinataires/${id}/consentements`)).statusCode).toBe(
      404,
    );
    expect(
      (
        await (
          await a.avecRoles(["consultant"])
        ).get(`/api/canaux/destinataires/${id}/consentements`)
      ).statusCode,
    ).toBe(403);
    attendre(
      200,
      await a.associe.post(`/api/canaux/destinataires/${id}/consentements`, { statut: "retire" }),
      "retrait",
    );
    attendre(
      200,
      await a.associe.post(`/api/canaux/destinataires/${id}/consentements`, {
        statut: "accorde",
        reference_preuve: "Formulaire papier signé le 13/10/2026",
      }),
      "accord",
    );
    const p1 = await a.chef.get(`/api/canaux/destinataires/${id}/consentements?limite=2`);
    attendre(200, p1, "page 1");
    expect(p1.json().elements).toHaveLength(2);
    expect(p1.json().curseur_suivant).not.toBeNull();
    const p2 = await a.chef.get(
      `/api/canaux/destinataires/${id}/consentements?limite=2&curseur=${p1.json().curseur_suivant}`,
    );
    attendre(200, p2, "page 2");
    expect(p2.json().elements.length).toBeGreaterThanOrEqual(1);
    expect(
      (await a.chef.get(`/api/canaux/destinataires/${id}/consentements?curseur=pas-un-curseur`))
        .statusCode,
    ).toBe(400);
  });
});

describe("« moi » : un utilisateur du cabinet gère ses numéros (n° 13)", () => {
  it("canaux.moi seul : numéro, code, consentement par la personne, retrait ; expert externe 403 ; 401", async () => {
    expect((await ctx.app.inject({ method: "GET", url: "/api/canaux/moi" })).statusCode).toBe(401);
    expect((await (await a.avecRoles(["expert_externe"])).get("/api/canaux/moi")).statusCode).toBe(
      403,
    );
    const moi = await a.chef.get("/api/canaux/moi");
    attendre(200, moi, "moi");
    expect(moi.json().elements.map((e: { canal: string }) => e.canal)).toEqual(["whatsapp", "sms"]);
    const put = await a.chef.put("/api/canaux/moi/whatsapp", {
      numero: "+2250000000034",
      mention_version: "whatsapp-v1",
      consentement: true,
    });
    attendre(200, put, "numéro");
    expect(put.json()).toMatchObject({ verifie: false, consentement: "absent", code_envoye: true });
    await executerJobs(ctx);
    attendre(
      200,
      await a.chef.post("/api/canaux/moi/whatsapp/verification", {
        code: dernierCode(ctx, "+2250000000034"),
      }),
      "code",
    );
    const accord = await a.chef.put("/api/canaux/moi/whatsapp", {
      mention_version: "whatsapp-v1",
      consentement: true,
    });
    attendre(200, accord, "accord");
    expect(accord.json().consentement).toBe("accorde");
    expect(
      (
        await a.chef.put("/api/canaux/moi/whatsapp", {
          mention_version: "whatsapp-v9",
          consentement: true,
        })
      ).statusCode,
    ).toBe(400);
    const retrait = await a.chef.post("/api/canaux/moi/whatsapp/retrait", {});
    attendre(200, retrait, "retrait");
    expect(retrait.json().consentement).toBe("retire");
    expect(JSON.stringify((await a.chef.get("/api/canaux/moi")).json())).not.toContain(
      "2250000000034",
    );
  });
});

describe("simulateur de développement (n° 14)", () => {
  it("réservé à canaux.configurer ; boîte lisible ; entrant signé par le serveur ; numéro réel refusé", async () => {
    expect((await a.chef.get("/api/canaux/simulateur/boite")).statusCode).toBe(403);
    expect(
      (
        await a.directeur.post("/api/canaux/simulateur/entrant", {
          type: "message",
          numero: NUMERO,
          texte: "x",
        })
      ).statusCode,
    ).toBe(403);
    const boite = await a.associe.get("/api/canaux/simulateur/boite");
    attendre(200, boite, "boîte");
    expect(Array.isArray(boite.json().elements)).toBe(true);
    // Un numéro de test connu du cabinet : le message est traité par le webhook (STOP de la personne).
    const dest = await destinataireVerifie(
      ctx,
      a,
      a.contributeur.utilisateurId,
      "sms",
      "+2250000000035",
    );
    void dest;
    const r = await a.associe.post("/api/canaux/simulateur/entrant", {
      type: "message",
      numero: "+2250000000012",
      texte: "bonjour",
    });
    attendre(200, r, "entrant");
    expect(r.json()).toEqual({ recus: 1 });
    const reel = await a.associe.post("/api/canaux/simulateur/entrant", {
      type: "message",
      numero: "+33612345678",
      texte: "x",
    });
    expect(reel.statusCode).toBe(400);
    expect(reel.json().erreur.code).toBe("NUMERO_REEL_REFUSE_EN_SIMULE");
    expect(
      (await a.associe.post("/api/canaux/simulateur/entrant", { type: "message", numero: NUMERO }))
        .statusCode,
    ).toBe(400);
    const audit = await proprietaire(
      async (c) =>
        (
          await c.query(
            "SELECT count(*)::int AS n FROM journal_audit WHERE action = 'canal.simulateur.entrant' AND cabinet_id = $1",
            [a.cabinetId],
          )
        ).rows[0].n as number,
    );
    expect(audit).toBeGreaterThanOrEqual(1);
  });

  it("sans fournisseur WhatsApp : les routes du simulateur n'existent pas (404)", async () => {
    const config = { ...configTest(), WHATSAPP_FOURNISSEUR: "aucun" as const };
    const db = createDatabase(config);
    const app = await buildApp(config, db, { canaux: creerCanaux(config) });
    try {
      for (const [method, url] of [
        ["GET", "/api/canaux/simulateur/boite"],
        ["POST", "/api/canaux/simulateur/entrant"],
      ] as const) {
        expect((await app.inject({ method, url })).statusCode).toBe(404);
      }
    } finally {
      await app.close();
      await db.close();
    }
  });
});

describe("numéros chiffrés, empreintes, rotation de clé", () => {
  it("le numéro n'est pas en clair en base ; l'AAD le lie à la ligne ; la rotation de TFA_MASTER_KEY garde l'expéditeur retrouvable", async () => {
    const ligne = await proprietaire(
      async (c) =>
        (
          await c.query(
            "SELECT id, utilisateur_id, canal, numero_chiffre, numero_cle_version, numero_empreinte, empreinte_cle_version FROM canaux_destinataires WHERE utilisateur_id = $1 AND canal = 'whatsapp'",
            [a.dirigeant.utilisateurId],
          )
        ).rows[0],
    );
    expect((ligne.numero_chiffre as Buffer).toString("latin1")).not.toContain("2250000000031");
    const t = trousseauDepuisConfig(ctx.config);
    const chiffre = {
      version: Number(ligne.numero_cle_version),
      donnees: ligne.numero_chiffre as Buffer,
    };
    expect(
      dechiffrerNumero(t, chiffre, aadNumero(a.cabinetId, a.dirigeant.utilisateurId, "whatsapp")),
    ).toBe("+2250000000031");
    expect(() =>
      dechiffrerNumero(
        t,
        chiffre,
        aadNumero(a.cabinetId, a.contributeur.utilisateurId, "whatsapp"),
      ),
    ).toThrow();
    expect(() =>
      dechiffrerNumero(t, chiffre, aadNumero(b.cabinetId, a.dirigeant.utilisateurId, "whatsapp")),
    ).toThrow();
    // Rotation : nouvelle clé courante, ancienne en « précédente » (même SESSION_SECRET).
    const nouvelle = "une-nouvelle-cle-maitre-de-test-0123456789ab";
    const roulee = creerTrousseau(
      {
        1: ctx.config.SESSION_SECRET,
        [versionDeCle(nouvelle)]: nouvelle,
        [versionDeCle(ctx.config.TFA_MASTER_KEY)]: ctx.config.TFA_MASTER_KEY,
      },
      versionDeCle(nouvelle),
    );
    const trouve = await ctx.db.withTenant(a.cabinetId, (db) =>
      retrouverExpediteur(db, roulee, a.cabinetId, "whatsapp", "+2250000000031"),
    );
    expect(trouve).toMatchObject({ utilisateur_id: a.dirigeant.utilisateurId, verifie: true });
    const apres = await proprietaire(
      async (c) =>
        (
          await c.query(
            "SELECT numero_empreinte, empreinte_cle_version FROM canaux_destinataires WHERE id = $1",
            [ligne.id],
          )
        ).rows[0],
    );
    expect(apres.numero_empreinte).not.toBe(ligne.numero_empreinte);
    expect(Number(apres.empreinte_cle_version)).toBe(versionDeCle(nouvelle));
    // Le numéro reste vérifié (la réécriture par rotation n'est pas un changement de numéro) et se retrouve encore.
    expect(
      (await proprietaire(
        async (c) =>
          (await c.query("SELECT verifie_le FROM canaux_destinataires WHERE id = $1", [ligne.id]))
            .rows[0].verifie_le,
      )) !== null,
    ).toBe(true);
    expect(
      await ctx.db.withTenant(a.cabinetId, (db) =>
        retrouverExpediteur(db, roulee, a.cabinetId, "whatsapp", "+2250000000031"),
      ),
    ).not.toBeNull();
  });
});

describe("fonctions SECURITY DEFINER étroites", () => {
  const appeler = (sql: string, params: unknown[] = []) =>
    ctx.db.withoutTenant((db) => db.query(sql, params));

  it("resoudre_compte_canal : rien pour un compte inactif ou inconnu, erreur pour un paramètre mal formé, droits", async () => {
    const ok = await appeler("SELECT * FROM resoudre_compte_canal('whatsapp', $1)", [
      a.compteWhatsapp,
    ]);
    expect(ok.rows).toEqual([{ cabinet_id: a.cabinetId, compte_id: expect.any(String) }]);
    expect(
      (await appeler("SELECT * FROM resoudre_compte_canal('whatsapp', 'cpt-0000000000000000')"))
        .rows,
    ).toEqual([]);
    // Le compte SMS n'est pas résolu comme un compte WhatsApp.
    expect(
      (await appeler("SELECT * FROM resoudre_compte_canal('whatsapp', $1)", [a.compteSms])).rows,
    ).toEqual([]);
    await expect(
      appeler("SELECT * FROM resoudre_compte_canal('whatsapp', 'pas-un-compte')"),
    ).rejects.toThrow(/invalides/);
    await expect(
      appeler("SELECT * FROM resoudre_compte_canal('telegram', $1)", [a.compteWhatsapp]),
    ).rejects.toThrow(/invalides/);
    const droits = await proprietaire(
      async (c) =>
        (
          await c.query(
            `SELECT has_function_privilege('missionpilot_app', 'resoudre_compte_canal(text, text)', 'EXECUTE') AS app,
              has_function_privilege('public', 'resoudre_compte_canal(text, text)', 'EXECUTE') AS public,
              has_function_privilege('public', 'planifier_synthese_hebdo(text, timestamptz, date)', 'EXECUTE') AS p1,
              has_function_privilege('public', 'planifier_canaux_maintenance(text, timestamptz, date)', 'EXECUTE') AS p2,
              has_function_privilege('public', 'anonymiser_transcriptions(timestamptz, int, int)', 'EXECUTE') AS p3`,
          )
        ).rows[0],
    );
    expect(droits).toEqual({ app: true, public: false, p1: false, p2: false, p3: false });
  });

  it("planifications : clé mal formée, paramètre nul, heure hors fenêtre : exception ; second appel : 0 job", async () => {
    const jour = "2026-10-14";
    const cle = `canaux_maintenance:${jour}`;
    const heure = `${jour}T03:15:00Z`;
    await expect(
      appeler("SELECT planifier_canaux_maintenance('maintenance:x', $1, $2)", [heure, jour]),
    ).rejects.toThrow(/invalide/);
    await expect(
      appeler("SELECT planifier_canaux_maintenance($1, NULL, $2)", [cle, jour]),
    ).rejects.toThrow(/obligatoires/);
    await expect(
      appeler("SELECT planifier_canaux_maintenance($1, '2026-12-01T03:15:00Z', $2)", [cle, jour]),
    ).rejects.toThrow(/hors de la journée/);
    const premier = await appeler("SELECT planifier_canaux_maintenance($1, $2, $3) AS n", [
      cle,
      heure,
      jour,
    ]);
    expect(premier.rows[0].n).toBeGreaterThanOrEqual(2);
    expect(
      (await appeler("SELECT planifier_canaux_maintenance($1, $2, $3) AS n", [cle, heure, jour]))
        .rows[0].n,
    ).toBe(0);
    // Synthèse : seulement un lundi, clé cohérente.
    await expect(
      appeler(
        "SELECT planifier_synthese_hebdo('synthese_hebdo:2026-10-13', '2026-10-13T07:30:00Z', '2026-10-13')",
      ),
    ).rejects.toThrow(/lundi/);
    await expect(
      appeler(
        "SELECT planifier_synthese_hebdo('synthese_hebdo:2026-10-12', '2026-10-30T07:30:00Z', '2026-10-12')",
      ),
    ).rejects.toThrow(/hors de la semaine/);
  });
});

describe("fichiers : un audio rattaché à une transcription n'est pas orphelin", () => {
  it("rattaché : jamais purgé ; téléversé et non rattaché : orphelin", async () => {
    const f = await televerser(
      a.chef,
      `/api/missions/${a.missionId}/transcriptions/audio`,
      "libre.ogg",
      fabriquerAudioDeTest({ texte: "x", dureeMs: 10, confiance: 5 }),
    );
    attendre(201, f, "audio");
    const orphelin = (id: string) =>
      proprietaire(
        async (c) => (await c.query("SELECT fichier_orphelin($1) AS o", [id])).rows[0].o as boolean,
      );
    expect(await orphelin(f.json().id)).toBe(true);
    attendre(
      201,
      await a.chef.post(`/api/missions/${a.missionId}/transcriptions`, {
        fichier_id: f.json().id,
        langue: "fr",
        enregistrement_consenti: true,
        reference_consentement: "Consentement oral enregistré",
      }),
      "création",
    );
    expect(await orphelin(f.json().id)).toBe(false);
    void MOT_DE_PASSE_TEST;
  });
});
