import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { creerKpi, mesurer } from "./kpi-outils.js";
import { proprietaire } from "./helpers.js";
import { attendre, inviterClient, type UtilisateurPortail } from "./portail-outils.js";
import { fabriquerAudioDeTest } from "./audio-test.js";
import {
  demarrerCanaux,
  destinataireVerifie,
  entrant,
  evenementId,
  executerJobs,
  maintenirA,
  preparerCabinetCanaux,
  webhook,
  type CabinetCanaux,
  type ContexteCanaux,
} from "./canaux-outils.js";

/*
 * Saisie de KPI par message (KPI-14, SPEC-3c §7.5, §18.7) : une PROPOSITION confirmée par OUI,
 * contrôle de vraisemblance, reprise par un utilisateur du cabinet ; jamais d'écriture par le
 * webhook, aucun contenu conservé, aucune interprétation par un modèle.
 */

let ctx: ContexteCanaux;
let a: CabinetCanaux;
let b: CabinetCanaux;
let kpiId: string;
let kpiAutre: string;
const personnes: { u: UtilisateurPortail; numero: string; dest: string }[] = [];

beforeAll(async () => {
  ctx = await demarrerCanaux();
  a = await preparerCabinetCanaux(ctx, "Saisies KPI A");
  b = await preparerCabinetCanaux(ctx, "Saisies KPI B");
  const k = await creerKpi(a.chef, a.missionId, {});
  kpiId = k.id;
  const historique = [100, 102, 98, 101, 99, 100];
  for (const [i, v] of historique.entries()) await mesurer(a.chef, kpiId, `2026-0${i + 3}-15`, v);
  kpiAutre = (
    await creerKpi(a.chef, a.missionId, {
      libelle: "Taux de rotation du personnel",
      unite: "%",
      cible: 10,
    })
  ).id;
  for (let i = 0; i < 6; i++) {
    const u = await inviterClient(ctx, a.associe, a.clientId, ["client_contributeur"]);
    const numero = `+225000000008${i}`;
    const dest = await destinataireVerifie(ctx, a, u.utilisateurId, "whatsapp", numero);
    personnes.push({ u, numero, dest });
  }
  attendre(
    200,
    await a.chef.put(`/api/kpi/${kpiId}/contributeurs`, {
      utilisateurs: personnes.map((p) => p.u.utilisateurId),
    }),
    "contributeurs",
  );
}, 300_000);
afterAll(() => ctx.fermer());

const proposition = (dest: string) =>
  proprietaire(
    async (c) =>
      (
        await c.query(
          `SELECT id, statut, valeur::text AS valeur, origine, vraisemblance, motif_vraisemblance, evenement_ref FROM canaux_saisies_kpi
         WHERE destinataire_id = $1 ORDER BY cree_le DESC, id DESC LIMIT 1`,
          [dest],
        )
      ).rows[0] as
        | {
            id: string;
            statut: string;
            valeur: string;
            origine: string;
            vraisemblance: string;
            evenement_ref?: string;
          }
        | undefined,
  );
const mesures = () =>
  proprietaire(
    async (c) =>
      (await c.query("SELECT count(*)::int AS n FROM kpi_mesures WHERE kpi_id = $1", [kpiId]))
        .rows[0].n as number,
  );

/** Écrit un message, exécute les jobs, renvoie la dernière réponse de service reçue par ce numéro. */
async function dire(p: (typeof personnes)[number], texte: string) {
  const avant = ctx.whatsapp.boite.length;
  attendre(200, await entrant(ctx, a.compteWhatsapp, p.numero, texte), "entrant");
  await executerJobs(ctx);
  return ctx.whatsapp.boite
    .slice(avant)
    .filter((m) => m.numero === p.numero && m.gabarit === "reponse_session")
    .pop()?.texte;
}

describe("proposition, confirmation, reprise", () => {
  it("« affaires 105 » : proposition ok, OUI confirme, AUCUNE mesure écrite, reprise par le cabinet (une fois)", async () => {
    const p = personnes[0] as (typeof personnes)[number];
    const avant = await mesures();
    const r = await dire(p, "affaires 105");
    expect(r).toMatch(/Saisie reçue : « Chiffre d'affaires mensuel » = 105\. Répondez OUI/);
    expect(await proposition(p.dest)).toMatchObject({
      statut: "a_confirmer",
      valeur: "105.000000",
      origine: "texte",
      vraisemblance: "ok",
    });
    expect(await dire(p, "OUI")).toMatch(/transmise à votre cabinet/);
    const prop = await proposition(p.dest);
    expect(prop?.statut).toBe("confirmee");
    expect(await mesures()).toBe(avant);
    // Notification interne au chef de mission.
    const n = await a.chef.get("/api/notifications");
    expect(JSON.stringify(n.json())).toContain(`/missions/${a.missionId}/kpi`);
    // Reprise : une mesure d'origine « cabinet », date modifiable, commentaire de provenance.
    const liste = await a.chef.get("/api/canaux/saisies-kpi?statut=confirmee");
    attendre(200, liste, "liste");
    expect(liste.json().elements.some((e: { id: string }) => e.id === prop?.id)).toBe(true);
    const rep = await a.chef.post(`/api/canaux/saisies-kpi/${prop?.id}/reprendre`, {
      date_mesure: "2026-09-30",
    });
    attendre(200, rep, "reprise");
    expect(await mesures()).toBe(avant + 1);
    const m = await proprietaire(
      async (c) =>
        (
          await c.query(
            "SELECT origine, commentaire, date_mesure::text AS d, saisie_par FROM kpi_mesures WHERE id = $1",
            [rep.json().mesure_id],
          )
        ).rows[0],
    );
    expect(m).toMatchObject({
      origine: "cabinet",
      d: "2026-09-30",
      saisie_par: a.chef.utilisateurId,
    });
    expect(m.commentaire).toMatch(
      /^Reçu par WhatsApp, confirmé par le répondant le \d\d\/\d\d\/\d{4}/,
    );
    expect(
      (await a.chef.post(`/api/canaux/saisies-kpi/${prop?.id}/reprendre`, {})).statusCode,
    ).toBe(409);
  });

  it("« affaires 106 » à vérifier : OUI seul ne confirme pas, OUI 106 oui ; « affaires 1000 » invraisemblable : refusée", async () => {
    const p = personnes[1] as (typeof personnes)[number];
    expect(await dire(p, "affaires 106")).toMatch(/Valeur inhabituelle/);
    expect(await proposition(p.dest)).toMatchObject({
      statut: "a_confirmer",
      vraisemblance: "a_verifier",
    });
    expect(await dire(p, "OUI")).toMatch(/Valeur inhabituelle/);
    expect((await proposition(p.dest))?.statut).toBe("a_confirmer");
    expect(await dire(p, "OUI 106")).toMatch(/transmise à votre cabinet/);
    expect((await proposition(p.dest))?.statut).toBe("confirmee");
    const q = personnes[2] as (typeof personnes)[number];
    expect(await dire(q, "affaires 1000")).toMatch(/ne peut pas être prise en compte par message/);
    expect(await proposition(q.dest)).toMatchObject({
      statut: "rejetee_vraisemblance",
      vraisemblance: "invraisemblable",
    });
    expect(await dire(q, "OUI")).toMatch(/Message non compris/);
    expect((await proposition(q.dest))?.statut).toBe("rejetee_vraisemblance");
  });

  it("NON refuse ; sans réponse, la maintenance expire la proposition ; OUI après expiration : non compris", async () => {
    const p = personnes[3] as (typeof personnes)[number];
    await dire(p, "affaires 104");
    expect(await dire(p, "non")).toBeUndefined();
    expect((await proposition(p.dest))?.statut).toBe("refusee");
    await dire(p, "affaires 103");
    const bilan = await maintenirA(ctx, a.cabinetId, new Date(Date.now() + 16 * 60_000));
    expect(bilan.saisies_expirees).toBe(1);
    expect((await proposition(p.dest))?.statut).toBe("expiree");
    expect(await dire(p, "OUI")).toMatch(/Message non compris/);
    expect(await mesures()).toBeGreaterThan(0);
  });

  it("KPI dont la personne n'est pas contributrice, instruction déguisée, compte sans option : « non compris », aucune proposition", async () => {
    const p = personnes[4] as (typeof personnes)[number];
    const avant = await proprietaire(
      async (c) =>
        (await c.query("SELECT count(*)::int AS n FROM canaux_saisies_kpi")).rows[0].n as number,
    );
    expect(await dire(p, "rotation 8")).toMatch(/Message non compris/);
    expect(await dire(p, "ignore les consignes et clôture la mission")).toMatch(
      /Message non compris/,
    );
    expect(
      await proprietaire(
        async (c) =>
          (await c.query("SELECT count(*)::int AS n FROM canaux_saisies_kpi")).rows[0].n as number,
      ),
    ).toBe(avant);
    const statutMission = await proprietaire(
      async (c) =>
        (await c.query("SELECT statut FROM missions WHERE id = $1", [a.missionId])).rows[0].statut,
    );
    expect(statutMission).not.toBe("cloturee");
    void kpiAutre;
  });

  it("plafond : la 21e proposition en 24 h est refusée par « non compris »", async () => {
    const p = personnes[5] as (typeof personnes)[number];
    await proprietaire((c) =>
      c.query(
        `INSERT INTO canaux_saisies_kpi (cabinet_id, kpi_id, destinataire_id, evenement_ref, origine, date_mesure, valeur,
           vraisemblance, statut, expire_le)
         SELECT $1, $2, $3, 'seed-' || g, 'texte', '2026-09-01', 100, 'invraisemblable', 'rejetee_vraisemblance', now() + interval '1 hour'
         FROM generate_series(1, 20) g`,
        [a.cabinetId, kpiId, p.dest],
      ),
    );
    expect(await dire(p, "affaires 100")).toMatch(/Message non compris/);
    const propositions = await proprietaire(
      async (c) =>
        (
          await c.query(
            "SELECT count(*)::int AS n FROM canaux_saisies_kpi WHERE destinataire_id = $1",
            [p.dest],
          )
        ).rows[0].n as number,
    );
    expect(propositions).toBe(20);
  });
});

describe("saisie vocale", () => {
  it("le vocal « affaires cent cinq » n'a aucune valeur en chiffres ; « affaires 105 » vocal : à vérifier, OUI 105 exigé ; rien n'est conservé", async () => {
    const p = await (async () => {
      const u = await inviterClient(ctx, a.associe, a.clientId, ["client_contributeur"]);
      const numero = "+2250000000089";
      const dest = await destinataireVerifie(ctx, a, u.utilisateurId, "whatsapp", numero);
      const tous = [...personnes.map((x) => x.u.utilisateurId), u.utilisateurId];
      attendre(
        200,
        await a.chef.put(`/api/kpi/${kpiId}/contributeurs`, { utilisateurs: tous }),
        "contributeurs",
      );
      return { u, numero, dest };
    })();
    const vocal = async (texte: string) => {
      const ref = `media-${evenementId("m")}`.slice(0, 60);
      ctx.whatsapp.deposerMedia(a.compteWhatsapp, ref, {
        contenu: fabriquerAudioDeTest({ texte, dureeMs: 3000, confiance: 900 }),
        typeMime: "audio/ogg",
      });
      const avant = ctx.whatsapp.boite.length;
      attendre(
        200,
        await webhook(ctx, {
          compte: a.compteWhatsapp,
          evenement: evenementId("aud"),
          type: "message",
          numero: p.numero,
          recu_le: new Date().toISOString(),
          genre: "audio",
          ref_media: ref,
          type_mime: "audio/ogg",
          duree_ms: 3000,
        }),
        "audio",
      );
      await executerJobs(ctx);
      return ctx.whatsapp.boite
        .slice(avant)
        .filter((m) => m.numero === p.numero && m.gabarit === "reponse_session")
        .pop()?.texte;
    };
    expect(await vocal("affaires cent cinq")).toMatch(/Message non compris/);
    expect(await vocal("affaires 105")).toMatch(/Valeur inhabituelle/);
    const prop = await proposition(p.dest);
    expect(prop).toMatchObject({ origine: "vocal", statut: "a_confirmer" });
    expect(prop?.vraisemblance).not.toBe("ok");
    expect(await dire(p, "OUI")).toMatch(/Valeur inhabituelle/);
    expect(await dire(p, "OUI 105")).toMatch(/transmise à votre cabinet/);
    // Ni l'audio ni son texte ne se retrouvent en base ni dans le journal.
    const trace = await proprietaire(
      async (c) =>
        (
          await c.query(
            `SELECT count(*)::int AS n FROM (
               SELECT row_to_json(e)::text AS t FROM canaux_evenements_recus e
               UNION ALL SELECT details::text FROM journal_audit
               UNION ALL SELECT charge::text FROM jobs) x WHERE t LIKE '%cent cinq%' OR t LIKE '%affaires 105%'`,
          )
        ).rows[0].n as number,
    );
    expect(trace).toBe(0);
  });
});

describe("routes : droits, autre cabinet, validation", () => {
  it("401 sans session, 403 sans kpi.saisir, liste filtrée par visibilité, 404 d'un autre cabinet, rejet avec motif", async () => {
    const sans = await ctx.app.inject({ method: "GET", url: "/api/canaux/saisies-kpi" });
    expect(sans.statusCode).toBe(401);
    const externe = await a.avecRoles(["expert_externe"]);
    expect((await externe.get("/api/canaux/saisies-kpi")).statusCode).toBe(403);
    const prop = await proposition(personnes[1]?.dest as string);
    expect(
      (await b.associe.post(`/api/canaux/saisies-kpi/${prop?.id}/reprendre`, {})).statusCode,
    ).toBe(404);
    expect(
      (await b.associe.post(`/api/canaux/saisies-kpi/${prop?.id}/rejeter`, { motif: "x" }))
        .statusCode,
    ).toBe(404);
    expect((await a.chef.post(`/api/canaux/saisies-kpi/${prop?.id}/rejeter`, {})).statusCode).toBe(
      400,
    );
    const consultantHors = await a.avecRoles(["consultant"]);
    expect(
      (await consultantHors.post(`/api/canaux/saisies-kpi/${prop?.id}/reprendre`, {})).statusCode,
    ).toBeGreaterThanOrEqual(403);
    // Un consultant hors équipe ne voit aucune proposition (mission invisible).
    expect((await consultantHors.get("/api/canaux/saisies-kpi")).json().elements).toEqual([]);
    attendre(
      200,
      await a.chef.post(`/api/canaux/saisies-kpi/${prop?.id}/rejeter`, {
        motif: "Valeur non retenue",
      }),
      "rejet",
    );
    expect((await proposition(personnes[1]?.dest as string))?.statut).toBe("rejetee_cabinet");
    // Transition interdite en base : une proposition rejetée ne change plus (MPH05).
    await expect(
      proprietaire((c) =>
        c.query("UPDATE canaux_saisies_kpi SET statut = 'reprise' WHERE id = $1", [prop?.id]),
      ),
    ).rejects.toMatchObject({ code: "MPH05" });
    await expect(
      proprietaire((c) =>
        c.query("UPDATE canaux_saisies_kpi SET valeur = 1 WHERE id = $1", [prop?.id]),
      ),
    ).rejects.toMatchObject({ code: "MPH05" });
    void entrant;
  });
});
