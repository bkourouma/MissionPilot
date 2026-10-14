import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { proprietaire } from "./helpers.js";
import { attendre } from "./portail-outils.js";
import {
  demarrerCanaux,
  dernierCode,
  destinataireVerifie,
  entrant,
  envoisDe,
  evenementId,
  executerJobs,
  NUMERO,
  preparerCabinetCanaux,
  webhook,
  type CabinetCanaux,
  type ContexteCanaux,
} from "./canaux-outils.js";

/*
 * Numéros, vérification par code, consentement par destinataire et par canal (SPEC-3c §6.2, §7.2,
 * §18.6) : parcours portail complet, numéro réel refusé, numéro partagé, retrait, STOP signé,
 * réactivation par la seule personne, changement de numéro.
 */

let ctx: ContexteCanaux;
let a: CabinetCanaux;
let b: CabinetCanaux;

beforeAll(async () => {
  ctx = await demarrerCanaux();
  a = await preparerCabinetCanaux(ctx, "Consentements A");
  b = await preparerCabinetCanaux(ctx, "Consentements B");
}, 240_000);
afterAll(() => ctx.fermer());

const historique = (destinataireId: string) =>
  proprietaire(
    async (c) =>
      (
        await c.query(
          `SELECT statut, source, acteur_id FROM canaux_consentements WHERE destinataire_id = $1 ORDER BY id`,
          [destinataireId],
        )
      ).rows as { statut: string; source: string; acteur_id: string | null }[],
  );

describe("parcours du portail : numéro, code, consentement, retrait", () => {
  it("numéro enregistré (réponse sans le numéro), code reçu, saisie, consentement, retrait, nouvel accord", async () => {
    const d = a.dirigeant;
    const r = await d.put("/api/portail/canaux/moi/whatsapp", {
      numero: NUMERO,
      mention_version: "whatsapp-v1",
      consentement: true,
    });
    attendre(200, r, "PUT portail");
    expect(JSON.stringify(r.json())).not.toContain("2250000000012");
    // Numéro non vérifié : le consentement n'est pas encore accordé, un code est parti en file.
    expect(r.json()).toMatchObject({ verifie: false, consentement: "absent", code_envoye: true });
    await executerJobs(ctx);
    const code = dernierCode(ctx, NUMERO);

    const moi = await d.get("/api/portail/canaux/moi");
    attendre(200, moi, "GET moi");
    const wa = moi.json().elements.find((e: { canal: string }) => e.canal === "whatsapp");
    expect(wa).toMatchObject({ numero_masque: "+225…12", verifie: false, canal_actif: true });
    expect(JSON.stringify(moi.json())).not.toContain("2250000000012");

    const faux = await d.post("/api/portail/canaux/moi/whatsapp/verification", {
      code: code === "000000" ? "111111" : "000000",
    });
    expect(faux.statusCode).toBe(409);
    expect(faux.json().erreur.code).toBe("CODE_INVALIDE");
    attendre(
      200,
      await d.post("/api/portail/canaux/moi/whatsapp/verification", { code }),
      "vérification",
    );

    // Mention périmée : 409.
    const perimee = await d.put("/api/portail/canaux/moi/whatsapp", {
      mention_version: "whatsapp-v0",
      consentement: true,
    });
    expect(perimee.statusCode).toBe(400);
    const accord = await d.put("/api/portail/canaux/moi/whatsapp", {
      mention_version: "whatsapp-v1",
      consentement: true,
    });
    attendre(200, accord, "consentement");
    expect(accord.json()).toMatchObject({ verifie: true, consentement: "accorde" });

    const retrait = await d.post("/api/portail/canaux/moi/whatsapp/retrait", {});
    attendre(200, retrait, "retrait");
    expect(retrait.json().consentement).toBe("retire");
    attendre(
      200,
      await d.put("/api/portail/canaux/moi/whatsapp", {
        mention_version: "whatsapp-v1",
        consentement: true,
      }),
      "nouvel accord",
    );

    const dest = await proprietaire(
      async (c) =>
        (
          await c.query(
            "SELECT id FROM canaux_destinataires WHERE utilisateur_id = $1 AND canal = 'whatsapp'",
            [d.utilisateurId],
          )
        ).rows[0].id as string,
    );
    const h = await historique(dest);
    expect(h.map((x) => `${x.statut}/${x.source}`)).toEqual([
      "accorde/portail",
      "retire/retrait_portail",
      "accorde/portail",
    ]);
    // Jamais modifié ni supprimé, même par le propriétaire de la base (MPH01).
    await expect(
      proprietaire((c) =>
        c.query("UPDATE canaux_consentements SET statut = 'retire' WHERE destinataire_id = $1", [
          dest,
        ]),
      ),
    ).rejects.toMatchObject({ code: "MPH01" });
    await expect(
      proprietaire((c) =>
        c.query("DELETE FROM canaux_consentements WHERE destinataire_id = $1", [dest]),
      ),
    ).rejects.toMatchObject({ code: "MPH01" });
  });

  it("numéro réel refusé tant que le fournisseur est simulé ; numéro invalide ; numéro déjà vérifié par un autre : réponse neutre", async () => {
    const reel = await a.contributeur.put("/api/portail/canaux/moi/whatsapp", {
      numero: "+33612345678",
      mention_version: "whatsapp-v1",
      consentement: true,
    });
    expect(reel.statusCode).toBe(400);
    expect(reel.json().erreur.code).toBe("NUMERO_REEL_REFUSE_EN_SIMULE");
    expect(JSON.stringify(reel.json())).not.toContain("33612345678");
    const invalide = await a.contributeur.put("/api/portail/canaux/moi/whatsapp", {
      numero: "0000000012",
      mention_version: "whatsapp-v1",
      consentement: true,
    });
    expect(invalide.statusCode).toBe(400);
    expect(invalide.json().erreur.code).toBe("NUMERO_INVALIDE");
    // Même numéro qu'un numéro VÉRIFIÉ d'une autre personne du même cabinet (constat M5) : aucun oracle.
    // L'enregistrement réussit comme pour tout numéro (réponse identique, code parti vers le numéro) ;
    // l'unicité ne porte que sur les numéros vérifiés et se tranche à la vérification.
    const partage = await a.contributeur.put("/api/portail/canaux/moi/whatsapp", {
      numero: NUMERO,
      mention_version: "whatsapp-v1",
      consentement: true,
    });
    attendre(200, partage, "numéro d'un autre, réponse neutre");
    expect(partage.json()).toMatchObject({
      verifie: false,
      consentement: "absent",
      code_envoye: true,
    });
    expect(JSON.stringify(partage.json())).not.toContain("DEJA_UTILISE");
    await executerJobs(ctx);
    // Le code reçu au numéro ne fait pas de la deuxième personne l'expéditeur : refus neutre, code effacé.
    const code = dernierCode(ctx, NUMERO);
    const refus = await a.contributeur.post("/api/portail/canaux/moi/whatsapp/verification", {
      code,
    });
    expect(refus.statusCode).toBe(409);
    expect(refus.json().erreur.code).toBe("CODE_INVALIDE");
    expect(JSON.stringify(refus.json())).not.toContain("DEJA_UTILISE");
    const etat = await proprietaire(
      async (c) =>
        (
          await c.query(
            `SELECT utilisateur_id, verifie_le IS NOT NULL AS verifie, code_empreinte IS NOT NULL AS code
             FROM canaux_destinataires WHERE cabinet_id = $1 AND canal = 'whatsapp'
               AND utilisateur_id IN ($2, $3)`,
            [a.cabinetId, a.dirigeant.utilisateurId, a.contributeur.utilisateurId],
          )
        ).rows as { utilisateur_id: string; verifie: boolean; code: boolean }[],
    );
    expect(etat.find((e) => e.utilisateur_id === a.dirigeant.utilisateurId)?.verifie).toBe(true);
    expect(etat.find((e) => e.utilisateur_id === a.contributeur.utilisateurId)).toMatchObject({
      verifie: false,
      code: false,
    });
    // Le numéro reste celui du dirigeant : l'expéditeur est univoque (le numéro VÉRIFIÉ prime). Un
    // message d'un genre non pris en charge n'appelle aucune réponse mais est rattaché au dirigeant.
    const evt = evenementId("m5");
    attendre(
      200,
      await webhook(ctx, {
        compte: a.compteWhatsapp,
        evenement: evt,
        type: "message",
        numero: NUMERO,
        recu_le: new Date().toISOString(),
        genre: "autre",
      }),
      "message d'un autre genre",
    );
    const ligne = await proprietaire(
      async (c) =>
        (
          await c.query(
            `SELECT e.destinataire_id, e.motif_ignore, d.utilisateur_id FROM canaux_evenements_recus e
             LEFT JOIN canaux_destinataires d ON d.id = e.destinataire_id
             WHERE e.cabinet_id = $1 AND e.evenement_id = $2`,
            [a.cabinetId, evt],
          )
        ).rows[0] as { motif_ignore: string | null; utilisateur_id: string | null },
    );
    expect(ligne).toMatchObject({
      motif_ignore: "genre_non_pris_en_charge",
      utilisateur_id: a.dirigeant.utilisateurId,
    });
    // Même numéro dans un autre cabinet : accepté.
    const autre = await b.dirigeant.put("/api/portail/canaux/moi/whatsapp", {
      numero: NUMERO,
      mention_version: "whatsapp-v1",
      consentement: true,
    });
    attendre(200, autre, "autre cabinet");
  });

  it("consentement sans numéro vérifié : refusé en base (MPH02) ; consentement recueilli sans preuve : 400", async () => {
    const r = await a.associe.put(
      `/api/canaux/destinataires/${a.contributeur.utilisateurId}/whatsapp`,
      {
        numero: "+2250000000021",
      },
    );
    attendre(200, r, "numéro contributeur");
    const id = r.json().destinataire.id as string;
    const sans = await a.associe.post(`/api/canaux/destinataires/${id}/consentements`, {
      statut: "accorde",
      reference_preuve: "Formulaire papier signé le 12/10/2026",
    });
    expect(sans.statusCode).toBe(409);
    expect(sans.json().erreur.code).toBe("CONSENTEMENT_REQUIS");
    await expect(
      proprietaire((c) =>
        c.query(
          `INSERT INTO canaux_consentements (cabinet_id, destinataire_id, canal, statut, source, reference_preuve, acteur_id)
           VALUES ($1, $2, 'whatsapp', 'accorde', 'recueilli_cabinet', 'Formulaire papier signé', $3)`,
          [a.cabinetId, id, a.associeId],
        ),
      ),
    ).rejects.toMatchObject({ code: "MPH02" });
    for (const reference_preuve of [undefined, "court"]) {
      const r400 = await a.associe.post(`/api/canaux/destinataires/${id}/consentements`, {
        statut: "accorde",
        ...(reference_preuve ? { reference_preuve } : {}),
      });
      expect(r400.statusCode).toBe(400);
    }
    await executerJobs(ctx);
    attendre(
      200,
      await a.associe.post(`/api/canaux/destinataires/${id}/verification`, {
        code: dernierCode(ctx, "+2250000000021"),
      }),
      "vérification",
    );
    attendre(
      200,
      await a.associe.post(`/api/canaux/destinataires/${id}/consentements`, {
        statut: "accorde",
        reference_preuve: "Formulaire papier signé le 12/10/2026",
      }),
      "consentement recueilli",
    );
    // Retrait par le cabinet : toujours accepté, effet immédiat.
    const retrait = await a.associe.post(`/api/canaux/destinataires/${id}/consentements`, {
      statut: "retire",
    });
    attendre(200, retrait, "retrait cabinet");
    expect(retrait.json().consentement).toBe("retire");
    const hist = await a.associe.get(`/api/canaux/destinataires/${id}/consentements`);
    attendre(200, hist, "historique");
    expect(hist.json().elements.map((e: { source: string }) => e.source)).toEqual([
      "retrait_cabinet",
      "recueilli_cabinet",
    ]);
  });
});

describe("STOP : retrait par message signé", () => {
  it("STOP retire le consentement dans la transaction, répond, et seule la personne redonne son accord", async () => {
    const numero = "+2250000000031";
    const dest = await (async () => {
      const r = await a.associe.put(
        `/api/canaux/destinataires/${a.contributeur.utilisateurId}/sms`,
        { numero },
      );
      attendre(200, r, "numéro sms");
      return r.json().destinataire.id as string;
    })();
    void dest;
    // Le dirigeant (WhatsApp, consentement portail accordé plus haut) écrit STOP.
    const r = await entrant(ctx, a.compteWhatsapp, NUMERO, "Stop");
    attendre(200, r, "webhook STOP");
    expect(r.json()).toEqual({ recus: 1 });
    const destDirigeant = await proprietaire(
      async (c) =>
        (
          await c.query(
            "SELECT id FROM canaux_destinataires WHERE utilisateur_id = $1 AND canal = 'whatsapp'",
            [a.dirigeant.utilisateurId],
          )
        ).rows[0].id as string,
    );
    const h = await historique(destDirigeant);
    expect(h[h.length - 1]).toEqual({ statut: "retire", source: "message_stop", acteur_id: null });
    await executerJobs(ctx);
    const reponse = ctx.whatsapp.boite.find(
      (m) => m.numero === NUMERO && m.gabarit === "reponse_session",
    );
    expect(reponse?.texte).toMatch(/Vous ne recevrez plus de messages WhatsApp/);
    // Le cabinet ne peut pas redonner l'accord d'une personne qui a écrit STOP (MPH02).
    const cabinet = await a.associe.post(
      `/api/canaux/destinataires/${destDirigeant}/consentements`,
      {
        statut: "accorde",
        reference_preuve: "Formulaire papier signé le 12/10/2026",
      },
    );
    expect(cabinet.statusCode).toBe(409);
    expect(cabinet.json().erreur.code).toBe("CONSENTEMENT_INCOHERENT");
    // La personne elle-même (portail) le peut.
    attendre(
      200,
      await a.dirigeant.put("/api/portail/canaux/moi/whatsapp", {
        mention_version: "whatsapp-v1",
        consentement: true,
      }),
      "accord par la personne",
    );
    // Rejeu du même événement : aucune écriture de plus.
    const evt = "evt-stop-rejeu-0001";
    await entrant(ctx, a.compteWhatsapp, NUMERO, "STOP", evt);
    const avant = (await historique(destDirigeant)).length;
    const rejeu = await entrant(ctx, a.compteWhatsapp, NUMERO, "STOP", evt);
    attendre(200, rejeu, "rejeu");
    expect((await historique(destDirigeant)).length).toBe(avant);
  });

  it("un envoi réservé avant STOP et traité après est bloqué (consentement retiré), rien n'est envoyé", async () => {
    // Le consentement vient d'être redonné : on le retire par STOP APRÈS avoir réservé un envoi.
    const dest = await proprietaire(
      async (c) =>
        (
          await c.query(
            "SELECT id FROM canaux_destinataires WHERE utilisateur_id = $1 AND canal = 'whatsapp'",
            [a.dirigeant.utilisateurId],
          )
        ).rows[0].id as string,
    );
    const { mettreEnFileEnvoi } = await import("../src/canaux/envois.js");
    const { trousseauDepuisConfig } = await import("../src/auth/chiffrement.js");
    await ctx.db.withTenant(a.cabinetId, (db) =>
      mettreEnFileEnvoi(db, trousseauDepuisConfig(ctx.config), {
        cabinetId: a.cabinetId,
        canal: "whatsapp",
        destinataireId: dest,
        gabarit: "signature_a_effectuer",
        variables: ["Cabinet", "/portail/signatures/x"],
        objetType: "signature_demande",
        objetId: dest,
        cle: "test-avant-stop",
        maintenant: new Date(),
      }),
    );
    attendre(200, await entrant(ctx, a.compteWhatsapp, NUMERO, "STOP"), "STOP");
    const avantBoite = ctx.whatsapp.boite.length;
    await executerJobs(ctx);
    const lignes = await envoisDe(dest);
    const l = lignes.find((x) => x.cle === "test-avant-stop");
    expect(l).toMatchObject({ statut: "bloque", motif_blocage: "consentement_retire" });
    expect(
      ctx.whatsapp.boite.slice(avantBoite).some((m) => m.gabarit === "signature_a_effectuer"),
    ).toBe(false);
  });
});

describe("changement de numéro", () => {
  it("retire le consentement (changement_numero), remet la vérification à nul (MPH12), les envois sont bloqués", async () => {
    const d = a.dirigeant;
    const dest = await proprietaire(
      async (c) =>
        (
          await c.query(
            "SELECT id FROM canaux_destinataires WHERE utilisateur_id = $1 AND canal = 'whatsapp'",
            [d.utilisateurId],
          )
        ).rows[0].id as string,
    );
    attendre(
      200,
      await d.put("/api/portail/canaux/moi/whatsapp", {
        mention_version: "whatsapp-v1",
        consentement: true,
      }),
      "accord",
    );
    const r = await d.put("/api/portail/canaux/moi/whatsapp", {
      numero: "+2250000000041",
      mention_version: "whatsapp-v1",
      consentement: true,
    });
    attendre(200, r, "nouveau numéro");
    expect(r.json()).toMatchObject({ verifie: false, consentement: "retire", code_envoye: true });
    const h = await historique(dest);
    expect(h[h.length - 1]?.source).toBe("changement_numero");
    const l = await proprietaire(
      async (c) =>
        (
          await c.query(
            "SELECT verifie_le, code_empreinte, numero_masque FROM canaux_destinataires WHERE id = $1",
            [dest],
          )
        ).rows[0],
    );
    expect(l.verifie_le).toBeNull();
    expect(l.numero_masque).toBe("+225…41");
    // Numéro modifié resté vérifié : refusé par la base si on force verifie_le sans code (MPH12).
    await expect(
      proprietaire((c) =>
        c.query("UPDATE canaux_destinataires SET verifie_le = now() WHERE id = $1", [dest]),
      ),
    ).rejects.toMatchObject({ code: "MPH12" });
  });
});

describe("désactivation d'un utilisateur du portail", () => {
  it("retire son consentement (desactivation_utilisateur, acteur = qui désactive), une seule fois, sans effet sur les autres", async () => {
    // Cabinet dédié : aucun numéro ni consentement antérieur sur ce contributeur.
    const cab = await preparerCabinetCanaux(ctx, "Consentements C");
    const dest = await destinataireVerifie(
      ctx,
      cab,
      cab.contributeur.utilisateurId,
      "whatsapp",
      "+2250000000051",
    );
    const autre = await destinataireVerifie(
      ctx,
      cab,
      cab.contributeur.utilisateurId,
      "sms",
      "+2250000000052",
      false,
    );
    expect((await historique(dest)).map((x) => `${x.statut}/${x.source}`)).toEqual([
      "accorde/recueilli_cabinet",
    ]);

    attendre(
      200,
      await cab.associe.post(
        `/api/portail/utilisateurs/${cab.contributeur.utilisateurId}/desactiver`,
      ),
      "désactivation",
    );
    const h = await historique(dest);
    expect(h.map((x) => `${x.statut}/${x.source}`)).toEqual([
      "accorde/recueilli_cabinet",
      "retire/desactivation_utilisateur",
    ]);
    expect(h[1]?.acteur_id).toBe(cab.associeId);
    // Le canal sans consentement accordé n'a pas reçu de ligne inutile.
    expect(await historique(autre)).toEqual([]);

    // Le dirigeant (autre utilisateur) garde son historique intact ; l'audit trace le retrait.
    const audit = await proprietaire(
      async (c) =>
        (
          await c.query(
            `SELECT details FROM journal_audit
             WHERE cabinet_id = $1 AND action = 'canal.consentement.retirer' AND entite_id = $2`,
            [cab.cabinetId, cab.contributeur.utilisateurId],
          )
        ).rows,
    );
    expect(audit).toHaveLength(1);
    expect(audit[0].details).toEqual({
      canaux: ["whatsapp"],
      source: "desactivation_utilisateur",
    });

    // Réactivation : le consentement n'est pas ressuscité (une nouvelle preuve est nécessaire).
    attendre(
      200,
      await cab.associe.post(
        `/api/portail/utilisateurs/${cab.contributeur.utilisateurId}/reactiver`,
      ),
      "réactivation",
    );
    expect((await historique(dest)).length).toBe(2);
  });
});

describe("plafond de codes par utilisateur et par jour (M5)", () => {
  it("10 codes de vérification par utilisateur sur 24 h, tous canaux confondus : le 11e est refusé (429)", async () => {
    const u = a.contributeur;
    // Un premier code part par SMS (un destinataire existe, 1 code émis).
    const sms = await a.associe.put(`/api/canaux/destinataires/${u.utilisateurId}/sms`, {
      numero: "+2250000000041",
    });
    attendre(200, sms, "premier code SMS");
    const destSms = sms.json().destinataire.id as string;
    // 9 codes de plus, émis entre 2 h et 10 h plus tôt (le plafond horaire par destinataire ne joue pas).
    await proprietaire((c) =>
      c.query(
        `INSERT INTO canaux_envois (cabinet_id, canal, compte_id, destinataire_id, gabarit, categorie,
           objet_type, objet_id, cle, cree_le)
         SELECT $1, 'sms', (SELECT id FROM canaux_comptes WHERE cabinet_id = $1 AND canal = 'sms'), $2,
           'verification_numero', 'verification', 'verification', $2, 'seed-code-' || g,
           now() - (g + 1 || ' hours')::interval
         FROM generate_series(1, 9) g`,
        [a.cabinetId, destSms],
      ),
    );
    // Un autre canal du même utilisateur est aussi refusé : le plafond est PAR UTILISATEUR.
    const wa = await a.associe.put(`/api/canaux/destinataires/${u.utilisateurId}/whatsapp`, {
      numero: "+2250000000042",
    });
    expect(wa.statusCode).toBe(429);
    expect(wa.json().erreur.code).toBe("TROP_DE_TENTATIVES");
    // Un autre utilisateur du même cabinet n'est pas affecté.
    attendre(
      200,
      await a.associe.put(`/api/canaux/destinataires/${a.dirigeant.utilisateurId}/sms`, {
        numero: "+2250000000043",
      }),
      "autre utilisateur",
    );
  });
});
