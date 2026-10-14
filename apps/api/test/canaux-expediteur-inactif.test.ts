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
  preparerCabinetCanaux,
  webhook,
  type CabinetCanaux,
  type ContexteCanaux,
} from "./canaux-outils.js";

/*
 * Message entrant d'un expéditeur INACTIF (audit de sécurité, constat I1) : utilisateur désactivé,
 * compte du portail non actif, client archivé, numéro non vérifié = AUCUNE proposition de saisie,
 * aucune réponse ; seul « STOP » fonctionne toujours (retrait immédiat du consentement).
 */

let ctx: ContexteCanaux;
let a: CabinetCanaux;
let kpiId: string;
interface Personne {
  u: UtilisateurPortail;
  numero: string;
  dest: string;
}
const personnes: Personne[] = [];

beforeAll(async () => {
  ctx = await demarrerCanaux();
  a = await preparerCabinetCanaux(ctx, "Expéditeur inactif");
  kpiId = (await creerKpi(a.chef, a.missionId, {})).id;
  for (const [i, v] of [100, 102, 98, 101, 99, 100].entries()) {
    await mesurer(a.chef, kpiId, `2026-0${i + 3}-15`, v);
  }
  for (let i = 0; i < 6; i++) {
    const u = await inviterClient(ctx, a.associe, a.clientId, ["client_contributeur"]);
    const numero = `+225000000007${i}`;
    // La 3e personne (indice 2) garde un numéro NON vérifié (code jamais saisi).
    let dest: string;
    if (i === 2) {
      const r = await a.associe.put(`/api/canaux/destinataires/${u.utilisateurId}/whatsapp`, {
        numero,
      });
      attendre(200, r, "numéro non vérifié");
      dest = r.json().destinataire.id as string;
    } else {
      dest = await destinataireVerifie(ctx, a, u.utilisateurId, "whatsapp", numero);
    }
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

const propositions = (dest: string) =>
  proprietaire(
    async (c) =>
      (
        await c.query(
          "SELECT count(*)::int AS n FROM canaux_saisies_kpi WHERE destinataire_id = $1",
          [dest],
        )
      ).rows[0].n as number,
  );
const evenementRecu = (evenement: string) =>
  proprietaire(
    async (c) =>
      (
        await c.query(
          `SELECT traitement, motif_ignore, destinataire_id FROM canaux_evenements_recus
           WHERE cabinet_id = $1 AND evenement_id = $2`,
          [a.cabinetId, evenement],
        )
      ).rows[0] as {
        traitement: string;
        motif_ignore: string | null;
        destinataire_id: string | null;
      },
  );
const consentementCourant = (dest: string) =>
  proprietaire(
    async (c) =>
      (
        await c.query(
          "SELECT statut, source FROM canaux_consentements WHERE destinataire_id = $1 ORDER BY id DESC LIMIT 1",
          [dest],
        )
      ).rows[0] as { statut: string; source: string },
  );

/** Message texte : renvoie l'identifiant d'événement et ce que le numéro a reçu. */
async function dire(p: Personne, texte: string) {
  const avant = ctx.whatsapp.boite.length;
  const evenement = evenementId("ina");
  attendre(200, await entrant(ctx, a.compteWhatsapp, p.numero, texte, evenement), "entrant");
  await executerJobs(ctx);
  const recus = ctx.whatsapp.boite.slice(avant).filter((m) => m.numero === p.numero);
  return { evenement, recus };
}

describe("expéditeur inactif : aucune proposition, STOP fonctionne toujours", () => {
  it("témoin : un expéditeur actif et vérifié reçoit une proposition", async () => {
    const p = personnes[0] as Personne;
    const { recus } = await dire(p, "affaires 105");
    expect(recus.some((m) => /Saisie reçue/.test(m.texte))).toBe(true);
    expect(await propositions(p.dest)).toBe(1);
  });

  it("utilisateur désactivé : ignoré (expediteur_inactif), aucune proposition, aucune réponse ; STOP retire le consentement", async () => {
    const p = personnes[1] as Personne;
    await proprietaire((c) =>
      c.query("UPDATE utilisateurs SET actif = false WHERE id = $1", [p.u.utilisateurId]),
    );
    const { evenement, recus } = await dire(p, "affaires 105");
    expect(recus).toHaveLength(0);
    expect(await propositions(p.dest)).toBe(0);
    expect(await evenementRecu(evenement)).toMatchObject({
      traitement: "ignore",
      motif_ignore: "expediteur_inactif",
    });
    // STOP fonctionne toujours : le consentement accordé est retiré.
    expect((await consentementCourant(p.dest)).statut).toBe("accorde");
    const stop = await dire(p, "STOP");
    expect(await evenementRecu(stop.evenement)).toMatchObject({ traitement: "traite" });
    expect(await consentementCourant(p.dest)).toMatchObject({
      statut: "retire",
      source: "message_stop",
    });
  });

  it("numéro non vérifié : ignoré (numero_non_verifie), aucune proposition ; STOP traité", async () => {
    const p = personnes[2] as Personne;
    const { evenement, recus } = await dire(p, "affaires 105");
    expect(recus).toHaveLength(0);
    expect(await propositions(p.dest)).toBe(0);
    expect(await evenementRecu(evenement)).toMatchObject({
      traitement: "ignore",
      motif_ignore: "numero_non_verifie",
    });
    const stop = await dire(p, "stop");
    expect(await evenementRecu(stop.evenement)).toMatchObject({ traitement: "traite" });
  });

  it("compte du portail désactivé : ignoré, aucune proposition ; STOP traité", async () => {
    const p = personnes[3] as Personne;
    await proprietaire((c) =>
      c.query("UPDATE utilisateurs_portail SET statut = 'desactive' WHERE utilisateur_id = $1", [
        p.u.utilisateurId,
      ]),
    );
    const { evenement, recus } = await dire(p, "affaires 105");
    expect(recus).toHaveLength(0);
    expect(await propositions(p.dest)).toBe(0);
    expect(await evenementRecu(evenement)).toMatchObject({
      traitement: "ignore",
      motif_ignore: "expediteur_inactif",
    });
    const stop = await dire(p, "STOP");
    expect(await evenementRecu(stop.evenement)).toMatchObject({ traitement: "traite" });
    expect((await consentementCourant(p.dest)).statut).toBe("retire");
  });

  it("vocal : la personne désactivée entre la mise en file et le job n'obtient aucune proposition", async () => {
    const p = personnes[4] as Personne;
    const ref = `media-${evenementId("m")}`.slice(0, 60);
    ctx.whatsapp.deposerMedia(a.compteWhatsapp, ref, {
      contenu: fabriquerAudioDeTest({ texte: "affaires 105", dureeMs: 3000, confiance: 900 }),
      typeMime: "audio/ogg",
    });
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
    // Le message est accepté (expéditeur actif), puis la personne est désactivée AVANT le job.
    await proprietaire((c) =>
      c.query("UPDATE utilisateurs SET actif = false WHERE id = $1", [p.u.utilisateurId]),
    );
    const avant = ctx.whatsapp.boite.length;
    await executerJobs(ctx);
    expect(ctx.whatsapp.boite.slice(avant).filter((m) => m.numero === p.numero)).toHaveLength(0);
    expect(await propositions(p.dest)).toBe(0);
  });

  it("client archivé : plus aucune proposition pour ses utilisateurs", async () => {
    const p = personnes[5] as Personne;
    await proprietaire((c) =>
      c.query("UPDATE clients SET actif = false WHERE id = $1", [a.clientId]),
    );
    const { evenement, recus } = await dire(p, "affaires 105");
    expect(recus).toHaveLength(0);
    expect(await propositions(p.dest)).toBe(0);
    expect(await evenementRecu(evenement)).toMatchObject({
      traitement: "ignore",
      motif_ignore: "expediteur_inactif",
    });
    await proprietaire((c) =>
      c.query("UPDATE clients SET actif = true WHERE id = $1", [a.clientId]),
    );
  });
});
