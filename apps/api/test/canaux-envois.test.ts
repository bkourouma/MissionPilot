import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { proprietaire } from "./helpers.js";
import { inviterClient, attendre } from "./portail-outils.js";
import {
  demarrerCanaux,
  destinataireForce,
  destinataireVerifie,
  enfiler,
  envoisDe,
  executerJobs,
  preparerCabinetCanaux,
  webhook,
  evenementId,
  type CabinetCanaux,
  type ContexteCanaux,
} from "./canaux-outils.js";

/*
 * Envois (SPEC-3c §7.1, §9.2, §9.3, §18.3) : au plus une fois, plafonds, repli SMS, issue inconnue,
 * coupe-circuit N4, déclencheurs MPH03 et MPH04, journal sans contenu, FIN-02.
 */

let ctx: ContexteCanaux;
let a: CabinetCanaux;
let compteur = 0;

beforeAll(async () => {
  ctx = await demarrerCanaux();
  a = await preparerCabinetCanaux(ctx, "Envois A");
}, 240_000);
afterAll(() => ctx.fermer());

/** Nouvel utilisateur du portail du client A (chaque scénario a son destinataire et ses plafonds). */
const personne = () => inviterClient(ctx, a.associe, a.clientId, ["client_contributeur"]);
const numeroUnique = (fin: string) => `+22500000${String(++compteur).padStart(2, "0")}${fin}`;
void numeroUnique;

describe("envoi nominal et statuts du fournisseur", () => {
  it("accepté (identifiant simulé), statuts fusionnés de façon monotone, journal sans contenu", async () => {
    const u = await personne();
    const id = await destinataireVerifie(ctx, a, u.utilisateurId, "whatsapp", "+2250000000051");
    const e = await enfiler(ctx, a, id, { cle: "nominal-1" });
    expect(e).toMatchObject({ statut: "reserve", existant: false });
    const avant = ctx.whatsapp.boite.length;
    await executerJobs(ctx);
    const [ligne] = (await envoisDe(id)).filter((l) => l.cle === "nominal-1");
    expect(ligne).toMatchObject({ statut: "accepte", canal: "whatsapp", tentatives: 1 });
    expect(ligne.id_externe).toMatch(/^sim-wa-[0-9a-f]{16}$/);
    expect(ctx.whatsapp.boite.length).toBe(avant + 1);
    // Idempotence de la clé : la même clé ne crée rien.
    expect(await enfiler(ctx, a, id, { cle: "nominal-1" })).toMatchObject({
      existant: true,
      statut: "accepte",
    });
    // La table n'a aucune colonne de texte, de numéro ni de nom.
    const colonnes = await proprietaire(async (c) =>
      (
        await c.query(
          "SELECT column_name FROM information_schema.columns WHERE table_name = 'canaux_envois'",
        )
      ).rows.map((x) => x.column_name as string),
    );
    expect(colonnes.filter((n) => /texte|numero|nom/.test(n) || n === "contenu")).toEqual([]);
    // Statuts du fournisseur : livré puis « envoyé » (rang inférieur, sans effet) puis lu puis livré (sans effet).
    const statut = (s: string) =>
      webhook(ctx, {
        compte: a.compteWhatsapp,
        evenement: evenementId(),
        type: "statut",
        id_externe_message: ligne.id_externe,
        statut: s,
      });
    const lire = async () => (await envoisDe(id)).find((l) => l.cle === "nominal-1")?.statut;
    await statut("livre");
    expect(await lire()).toBe("livre");
    await statut("envoye");
    expect(await lire()).toBe("livre");
    await statut("lu");
    expect(await lire()).toBe("lu");
    await statut("livre");
    expect(await lire()).toBe("lu");
  });

  it("le journal des envois : aucun contenu, coût absent sans finance.lire (FIN-02), présent avec", async () => {
    const chef = a.chef;
    const r = await chef.get("/api/canaux/envois?limite=5");
    attendre(200, r, "journal chef");
    expect(r.json().elements.length).toBeGreaterThan(0);
    for (const e of r.json().elements) {
      expect("cout_estime_micro_usd" in e).toBe(false);
      expect(JSON.stringify(e)).not.toMatch(/\+225|Cabinet de test|texte/);
    }
    const assoc = await a.associe.get("/api/canaux/envois?limite=5");
    attendre(200, assoc, "journal associé");
    expect("cout_estime_micro_usd" in assoc.json().elements[0]).toBe(true);
  });
});

describe("plafonds, coupe-circuit, issue inconnue", () => {
  it("4e message à l'initiative du cabinet dans les 24 h : bloqué (plafond_destinataire)", async () => {
    const u = await personne();
    const id = await destinataireVerifie(ctx, a, u.utilisateurId, "whatsapp", "+2250000000052");
    const r = [];
    for (let i = 1; i <= 4; i++) r.push(await enfiler(ctx, a, id, { cle: `plafond-${i}` }));
    expect(r.map((x) => x?.statut)).toEqual(["reserve", "reserve", "reserve", "bloque"]);
    expect(r[3]?.motif).toBe("plafond_destinataire");
    await executerJobs(ctx);
    const lignes = (await envoisDe(id)).filter((l) => l.cle.startsWith("plafond-"));
    expect(lignes.map((l) => l.statut)).toEqual(["accepte", "accepte", "accepte", "bloque"]);
  });

  it("coupe-circuit N4 : relance bloquée + ligne d'audit ; la vérification d'un numéro n'y est pas soumise", async () => {
    const u = await personne();
    const id = await destinataireVerifie(ctx, a, u.utilisateurId, "whatsapp", "+2250000000053");
    attendre(
      200,
      await a.associe.put("/api/agents/coupe-circuit", { actif: true, motif: "Relance erronée." }),
      "coupe",
    );
    try {
      const e = await enfiler(ctx, a, id, { cle: "coupe-1" });
      expect(e).toMatchObject({ statut: "bloque", motif: "coupe_circuit" });
      const audit = await proprietaire(
        async (c) =>
          (
            await c.query(
              "SELECT utilisateur_id FROM journal_audit WHERE cabinet_id = $1 AND action = 'canal.envoi.suspendu_coupe_circuit'",
              [a.cabinetId],
            )
          ).rows,
      );
      expect(audit).toEqual([{ utilisateur_id: null }]);
      const v = await enfiler(ctx, a, id, {
        cle: "coupe-verif",
        gabarit: "verification_numero",
        variables: ["123456"],
      });
      expect(v?.statut).toBe("reserve");
    } finally {
      attendre(
        200,
        await a.associe.put("/api/agents/coupe-circuit", {
          actif: false,
          motif: "Cause corrigée.",
        }),
        "levée",
      );
    }
  });

  it("issue inconnue (numéro 95) : incertain, JAMAIS renvoyé, associés notifiés", async () => {
    const u = await personne();
    const id = await destinataireForce(a, u.utilisateurId, "whatsapp", "+2250000000095");
    await enfiler(ctx, a, id, { cle: "inconnu-1" });
    await executerJobs(ctx);
    const l = (await envoisDe(id)).find((x) => x.cle === "inconnu-1");
    expect(l).toMatchObject({ statut: "incertain", tentatives: 1 });
    // Rejeu bien plus tard : aucun nouvel appel.
    await executerJobs(ctx, new Date(Date.now() + 3_600_000));
    expect((await envoisDe(id)).find((x) => x.cle === "inconnu-1")).toMatchObject({
      statut: "incertain",
      tentatives: 1,
    });
    const n = await a.associe.get("/api/notifications");
    expect(JSON.stringify(n.json())).toContain("canal_envoi_incertain");
    const audit = await proprietaire(
      async (c) =>
        (
          await c.query(
            "SELECT count(*)::int AS n FROM journal_audit WHERE action = 'canal.envoi.incertain' AND cabinet_id = $1",
            [a.cabinetId],
          )
        ).rows[0].n as number,
    );
    expect(audit).toBeGreaterThan(0);
  });

  it("envoi « en_cours » depuis plus de 15 minutes (worker tombé) : incertain, aucun renvoi", async () => {
    const u = await personne();
    const id = await destinataireVerifie(ctx, a, u.utilisateurId, "whatsapp", "+2250000000054");
    const e = await enfiler(ctx, a, id, { cle: "interrompu-1" });
    await proprietaire((c) =>
      c.query(
        "UPDATE canaux_envois SET statut = 'en_cours', en_cours_le = now() - interval '20 minutes', tentatives = 1 WHERE id = $1",
        [e?.id],
      ),
    );
    const avant = ctx.whatsapp.boite.length;
    await executerJobs(ctx);
    expect((await envoisDe(id)).find((x) => x.cle === "interrompu-1")?.statut).toBe("incertain");
    expect(ctx.whatsapp.boite.length).toBe(avant);
  });
});

describe("repli SMS", () => {
  it("WhatsApp non joignable : deux lignes (echec puis SMS accepté, repli_de) ; sans consentement SMS : pas de repli", async () => {
    const u = await personne();
    const wa = await destinataireForce(a, u.utilisateurId, "whatsapp", "+2250000000000");
    const sms = await destinataireVerifie(ctx, a, u.utilisateurId, "sms", "+2250000000013");
    await enfiler(ctx, a, wa, { cle: "repli-1" });
    await executerJobs(ctx);
    const l1 = (await envoisDe(wa)).find((x) => x.cle === "repli-1");
    expect(l1).toMatchObject({ statut: "echec", code_refus: "NUMERO_NON_JOIGNABLE" });
    const l2 = (await envoisDe(sms)).find((x) => x.cle === "repli-1:sms");
    expect(l2).toMatchObject({ statut: "accepte", canal: "sms", repli_de: l1?.id });
    expect(l2?.id_externe).toMatch(/^sim-sms-/);
    // Sans consentement SMS (retiré), le même refus ne donne qu'une ligne.
    const u2 = await personne();
    const wa2 = await destinataireForce(a, u2.utilisateurId, "whatsapp", "+2250000000000").catch(
      () => null,
    );
    // Le numéro « 00 » est unique par cabinet : un second utilisateur reçoit un 409 ; on retire alors le SMS du premier.
    expect(wa2).toBeNull();
    attendre(
      200,
      await a.associe.post(`/api/canaux/destinataires/${sms}/consentements`, { statut: "retire" }),
      "retrait sms",
    );
    await enfiler(ctx, a, wa, { cle: "repli-2" });
    await executerJobs(ctx);
    expect((await envoisDe(wa)).find((x) => x.cle === "repli-2")?.statut).toBe("echec");
    expect((await envoisDe(sms)).find((x) => x.cle === "repli-2:sms")).toBeUndefined();
  });

  it("WhatsApp indisponible (numéro 99) : 5 tentatives (reprise du worker) puis repli SMS, sans doublon au rejeu", async () => {
    const u = await personne();
    const wa = await destinataireForce(a, u.utilisateurId, "whatsapp", "+2250000000099");
    const sms = await destinataireVerifie(ctx, a, u.utilisateurId, "sms", "+2250000000014");
    await enfiler(ctx, a, wa, { cle: "indispo-1" });
    for (let k = 1; k <= 8; k++) await executerJobs(ctx, new Date(Date.now() + k * 10 * 60_000));
    const l = (await envoisDe(wa)).find((x) => x.cle === "indispo-1");
    expect(l).toMatchObject({ statut: "echec", code_refus: "INDISPONIBLE", tentatives: 5 });
    const repli = (await envoisDe(sms)).filter((x) => x.cle === "indispo-1:sms");
    expect(repli).toHaveLength(1);
    expect(repli[0]?.statut).toBe("accepte");
    // La clé empêche tout doublon si le repli est remis en file.
    expect(await enfiler(ctx, a, sms, { canal: "sms", cle: "indispo-1:sms" })).toMatchObject({
      existant: true,
    });
  });

  it("numéro « 96 » : indisponible puis accepté à la reprise", async () => {
    const u = await personne();
    const wa = await destinataireForce(a, u.utilisateurId, "whatsapp", "+2250000000096");
    await enfiler(ctx, a, wa, { cle: "indispo-96" });
    await executerJobs(ctx);
    expect((await envoisDe(wa)).find((x) => x.cle === "indispo-96")).toMatchObject({
      statut: "reserve",
      code_refus: "INDISPONIBLE",
    });
    await executerJobs(ctx, new Date(Date.now() + 10 * 60_000));
    expect((await envoisDe(wa)).find((x) => x.cle === "indispo-96")).toMatchObject({
      statut: "accepte",
      tentatives: 2,
    });
  });
});

describe("déclencheurs MPH03 (envoi) et MPH04 (compte)", () => {
  it("transition interdite, identité modifiée, suppression : MPH03", async () => {
    const u = await personne();
    const id = await destinataireVerifie(ctx, a, u.utilisateurId, "whatsapp", "+2250000000055");
    const e = await enfiler(ctx, a, id, { cle: "mph03-1" });
    await executerJobs(ctx);
    const refuse = (sql: string) =>
      expect(proprietaire((c) => c.query(sql, [e?.id]))).rejects.toMatchObject({ code: "MPH03" });
    await refuse("UPDATE canaux_envois SET statut = 'reserve' WHERE id = $1");
    await refuse("UPDATE canaux_envois SET gabarit = 'synthese_hebdo' WHERE id = $1");
    await refuse("DELETE FROM canaux_envois WHERE id = $1");
  });

  it("activation d'un compte par un non-associé : MPH04 en base ; route : directeur 403, associé sans mot de passe 403", async () => {
    attendre(
      200,
      await a.associe.put("/api/canaux/comptes/sms", { actif: false }),
      "désactivation",
    );
    await expect(
      proprietaire((c) =>
        c.query(
          "UPDATE canaux_comptes SET actif = true, modifie_par = $2 WHERE cabinet_id = $1 AND canal = 'sms'",
          [a.cabinetId, a.chef.utilisateurId],
        ),
      ),
    ).rejects.toMatchObject({ code: "MPH04" });
    expect(
      (
        await a.directeur.put("/api/canaux/comptes/sms", {
          actif: true,
          mot_de_passe: "Test-motdepasse-1",
        })
      ).statusCode,
    ).toBe(403);
    const sans = await a.associe.put("/api/canaux/comptes/sms", { actif: true });
    expect(sans.statusCode).toBe(403);
    expect(sans.json().erreur.code).toBe("CONFIRMATION_REQUISE");
    // Le directeur peut DÉSACTIVER (coupe-circuit par canal) ; l'associé réactive avec reconfirmation.
    attendre(
      200,
      await a.directeur.put("/api/canaux/comptes/whatsapp", { actif: false }),
      "directeur désactive",
    );
    attendre(
      200,
      await a.associe.put("/api/canaux/comptes/whatsapp", {
        actif: true,
        mot_de_passe: "Test-motdepasse-1",
      }),
      "réactivation",
    );
    attendre(
      200,
      await a.associe.put("/api/canaux/comptes/sms", {
        actif: true,
        mot_de_passe: "Test-motdepasse-1",
      }),
      "réactivation sms",
    );
  });

  it("un compte inactif bloque les envois (canal_inactif)", async () => {
    const u = await personne();
    const id = await destinataireVerifie(ctx, a, u.utilisateurId, "whatsapp", "+2250000000056");
    attendre(
      200,
      await a.associe.put("/api/canaux/comptes/whatsapp", { actif: false }),
      "désactivation",
    );
    try {
      expect(await enfiler(ctx, a, id, { cle: "inactif-1" })).toMatchObject({
        statut: "bloque",
        motif: "canal_inactif",
      });
    } finally {
      attendre(
        200,
        await a.associe.put("/api/canaux/comptes/whatsapp", {
          actif: true,
          mot_de_passe: "Test-motdepasse-1",
        }),
        "réactivation",
      );
    }
  });
});
