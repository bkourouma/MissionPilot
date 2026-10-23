import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { proprietaire } from "./helpers.js";
import { attendre } from "./portail-outils.js";
import { destinataireInterne } from "./canaux-internes-outils.js";
import {
  demarrerCanaux,
  destinataireVerifie,
  enfiler,
  envoisDe,
  preparerCabinetCanaux,
  type CabinetCanaux,
  type ContexteCanaux,
} from "./canaux-outils.js";

/*
 * Source `desactivation_utilisateur` (SPEC-3c §6.2) : la désactivation d'un utilisateur du CABINET
 * (PATCH /api/utilisateurs/:id, `actif` de true à false) retire son consentement dans la même
 * transaction ; l'historique est en ajout seul, le destinataire n'est jamais modifié. Cas du portail
 * (déjà couvert dans canaux-consentements.test.ts) : même comportement vérifié ici.
 */

let ctx: ContexteCanaux;
let cab: CabinetCanaux;

beforeAll(async () => {
  ctx = await demarrerCanaux();
  cab = await preparerCabinetCanaux(ctx, "Désactivation cabinet");
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
const resume = (h: { statut: string; source: string }[]) => h.map((x) => `${x.statut}/${x.source}`);
const auditRetraits = (utilisateurId: string) =>
  proprietaire(
    async (c) =>
      (
        await c.query(
          `SELECT entite, details FROM journal_audit
           WHERE cabinet_id = $1 AND action = 'canal.consentement.retirer' AND entite_id = $2`,
          [cab.cabinetId, utilisateurId],
        )
      ).rows,
  );
const patcher = (id: string, corps: object) => cab.associe.patch(`/api/utilisateurs/${id}`, corps);

describe("désactivation d'un utilisateur du cabinet", () => {
  it("retire le consentement (source desactivation_utilisateur, acteur = qui désactive), bloque les envois, sans ressusciter l'accord", async () => {
    const u = await cab.avecRoles(["consultant"]);
    const dest = await destinataireInterne(ctx, cab, u.utilisateurId, "+2250000000081");
    expect(resume(await historique(dest))).toEqual(["accorde/recueilli_cabinet"]);

    attendre(200, await patcher(u.utilisateurId, { actif: false }), "désactivation");
    const h = await historique(dest);
    expect(resume(h)).toEqual(["accorde/recueilli_cabinet", "retire/desactivation_utilisateur"]);
    expect(h[1]?.acteur_id).toBe(cab.associeId);
    const audit = await auditRetraits(u.utilisateurId);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      entite: "utilisateur",
      details: { canaux: ["whatsapp"], source: "desactivation_utilisateur" },
    });
    // Le destinataire lui-même est intact (numéro et vérification conservés).
    const ligne = (
      await proprietaire((c) =>
        c.query("SELECT verifie_le FROM canaux_destinataires WHERE id = $1", [dest]),
      )
    ).rows[0];
    expect(ligne.verifie_le).not.toBeNull();

    // Plus aucun envoi : destinataire inactif.
    await enfiler(ctx, cab, dest, { cle: "desactivation:inactif" });
    expect(await envoisDe(dest)).toMatchObject([
      { statut: "bloque", motif_blocage: "destinataire_inactif" },
    ]);

    // Réactivation : l'accord n'est pas ressuscité, l'envoi reste bloqué faute de consentement.
    attendre(200, await patcher(u.utilisateurId, { actif: true }), "réactivation");
    expect((await historique(dest)).length).toBe(2);
    await enfiler(ctx, cab, dest, { cle: "desactivation:reactive" });
    expect((await envoisDe(dest)).map((e) => `${e.statut}/${e.motif_blocage}`)).toEqual([
      "bloque/destinataire_inactif",
      "bloque/consentement_retire",
    ]);
  }, 90_000);

  it("désactiver sans consentement accordé, ou un utilisateur déjà inactif, n'écrit rien", async () => {
    const sans = await cab.avecRoles(["consultant"]);
    const nonConsenti = await destinataireInterne(ctx, cab, sans.utilisateurId, "+2250000000082", {
      consentement: false,
    });
    const aucunNumero = await cab.avecRoles(["consultant"]);
    attendre(200, await patcher(sans.utilisateurId, { actif: false }), "sans consentement");
    attendre(200, await patcher(aucunNumero.utilisateurId, { actif: false }), "sans numéro");
    expect(await historique(nonConsenti)).toEqual([]);
    expect(await auditRetraits(sans.utilisateurId)).toEqual([]);
    expect(await auditRetraits(aucunNumero.utilisateurId)).toEqual([]);

    // Déjà inactif : un second PATCH `actif: false` ne repasse pas par la transition.
    const u = await cab.avecRoles(["consultant"]);
    const dest = await destinataireInterne(ctx, cab, u.utilisateurId, "+2250000000083");
    attendre(200, await patcher(u.utilisateurId, { actif: false }), "première");
    attendre(200, await patcher(u.utilisateurId, { actif: false }), "seconde");
    expect(resume(await historique(dest))).toEqual([
      "accorde/recueilli_cabinet",
      "retire/desactivation_utilisateur",
    ]);
    expect(await auditRetraits(u.utilisateurId)).toHaveLength(1);
  });

  it("modifier autre chose que `actif` (nom, rôles, actif inchangé) ne retire rien", async () => {
    const u = await cab.avecRoles(["consultant"]);
    const dest = await destinataireInterne(ctx, cab, u.utilisateurId, "+2250000000084");
    attendre(200, await patcher(u.utilisateurId, { nom: "Nom modifié" }), "nom");
    attendre(200, await patcher(u.utilisateurId, { actif: true }), "actif inchangé");
    attendre(200, await patcher(u.utilisateurId, { roles: ["gestionnaire"] }), "rôles");
    expect(resume(await historique(dest))).toEqual(["accorde/recueilli_cabinet"]);
    expect(await auditRetraits(u.utilisateurId)).toEqual([]);
  });

  it("un autre utilisateur du cabinet n'est pas touché", async () => {
    const u = await cab.avecRoles(["consultant"]);
    const v = await cab.avecRoles(["consultant"]);
    const destU = await destinataireInterne(ctx, cab, u.utilisateurId, "+2250000000085");
    const destV = await destinataireInterne(ctx, cab, v.utilisateurId, "+2250000000086");
    attendre(200, await patcher(u.utilisateurId, { actif: false }), "désactivation");
    expect(resume(await historique(destU))).toContain("retire/desactivation_utilisateur");
    expect(resume(await historique(destV))).toEqual(["accorde/recueilli_cabinet"]);
  }, 90_000);
});

describe("désactivation d'un utilisateur du portail (comportement inchangé)", () => {
  it("retire le consentement, acteur = qui désactive, une seule trace d'audit", async () => {
    const c2 = await preparerCabinetCanaux(ctx, "Désactivation portail");
    const dest = await destinataireVerifie(
      ctx,
      c2,
      c2.contributeur.utilisateurId,
      "whatsapp",
      "+2250000000087",
    );
    attendre(
      200,
      await c2.associe.post(
        `/api/portail/utilisateurs/${c2.contributeur.utilisateurId}/desactiver`,
      ),
      "désactivation portail",
    );
    const h = await historique(dest);
    expect(resume(h)).toEqual(["accorde/recueilli_cabinet", "retire/desactivation_utilisateur"]);
    expect(h[1]?.acteur_id).toBe(c2.associeId);
  }, 90_000);
});
