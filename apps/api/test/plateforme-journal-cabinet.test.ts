import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { proprietaire } from "./helpers.js";
import { destinataireInterne } from "./canaux-internes-outils.js";
import {
  demarrerCanaux,
  preparerCabinetCanaux,
  type CabinetCanaux,
  type ContexteCanaux,
} from "./canaux-outils.js";
import {
  creerCabinetParPlateforme,
  emailUnique,
  MOT_DE_PASSE_PLATEFORME,
  superAdminConnecte,
} from "./plateforme-outils.js";

/*
 * Traçabilité côté cabinet : toute écriture de la plateforme laisse une ligne dans le journal
 * d'audit DU CABINET cible (utilisateur_id nul, super admin dans `details`, aucun secret).
 * Désactiver un compte par la plateforme retire ses consentements aux canaux, dans la même
 * transaction (modèle : canaux-desactivation.test.ts).
 */

let ctx: ContexteCanaux;
let cab: CabinetCanaux;
let sa: Awaited<ReturnType<typeof superAdminConnecte>>;

beforeAll(async () => {
  ctx = await demarrerCanaux();
  cab = await preparerCabinetCanaux(ctx, "Plateforme et canaux");
  sa = await superAdminConnecte(ctx);
}, 240_000);
afterAll(() => ctx.fermer());

const auditCabinet = (cabinetId: string, motif: string) =>
  proprietaire(
    async (c) =>
      (
        await c.query(
          `SELECT utilisateur_id, action, entite, entite_id, details FROM journal_audit
           WHERE cabinet_id = $1 AND action LIKE $2 ORDER BY id`,
          [cabinetId, motif],
        )
      ).rows as {
        utilisateur_id: string | null;
        action: string;
        entite: string;
        entite_id: string;
        details: Record<string, unknown>;
      }[],
  );

describe("journal d'audit du cabinet cible", () => {
  it("création, modification et désactivation laissent une entrée par opération, sans secret", async () => {
    const c = await creerCabinetParPlateforme(sa.p);
    const email = emailUnique("journal");
    const mdp = "Mot-de-passe-secret-42";
    const cree = await sa.p.post(`/api/plateforme/cabinets/${c.cabinetId}/utilisateurs`, {
      nom: "Journalisé",
      email,
      roles: ["consultant"],
      motDePasse: mdp,
    });
    expect(cree.statusCode).toBe(201);
    const uid = cree.json().utilisateur.id as string;
    expect(
      (
        await sa.p.patch(`/api/plateforme/cabinets/${c.cabinetId}/utilisateurs/${uid}`, {
          roles: ["chef_mission"],
          actif: false,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await sa.p.patch(`/api/plateforme/cabinets/${c.cabinetId}`, { actif: false })).statusCode,
    ).toBe(200);
    expect(
      (await sa.p.patch(`/api/plateforme/cabinets/${c.cabinetId}`, { actif: true })).statusCode,
    ).toBe(200);

    const lignes = await auditCabinet(c.cabinetId, "plateforme.%");
    expect(lignes.map((l) => l.action)).toEqual([
      "plateforme.cabinet_creation",
      "plateforme.utilisateur_creation",
      "plateforme.utilisateur_modification",
      "plateforme.cabinet_modification",
      "plateforme.cabinet_modification",
    ]);
    for (const l of lignes) {
      expect(l.utilisateur_id).toBeNull();
      expect(l.details.super_admin_id).toBe(sa.admin.id);
    }
    expect(lignes[1]).toMatchObject({ entite: "utilisateur", entite_id: uid });
    expect(lignes[1]!.details).toMatchObject({ roles: ["consultant"] });
    expect(lignes[2]!.details).toMatchObject({ actif: false, roles: ["chef_mission"] });
    expect(lignes[3]!.details).toMatchObject({ actif: false });
    expect(lignes[4]!.details).toMatchObject({ actif: true });

    const tout = JSON.stringify(lignes);
    for (const secret of [mdp, MOT_DE_PASSE_PLATEFORME, email, "scrypt$"]) {
      expect(tout).not.toContain(secret);
    }
  });
});

describe("désactivation d'un compte par la plateforme : consentements des canaux", () => {
  const historique = (destinataireId: string) =>
    proprietaire(
      async (c) =>
        (
          await c.query(
            `SELECT statut, source, acteur_id FROM canaux_consentements
             WHERE destinataire_id = $1 ORDER BY id`,
            [destinataireId],
          )
        ).rows as { statut: string; source: string; acteur_id: string | null }[],
    );
  const resume = (h: { statut: string; source: string }[]) =>
    h.map((x) => `${x.statut}/${x.source}`);

  it("retire le consentement (desactivation_utilisateur) une seule fois, journalise, laisse le destinataire intact", async () => {
    const u = await cab.avecRoles(["consultant"]);
    const dest = await destinataireInterne(ctx, cab, u.utilisateurId, "+2250000000091");
    expect(resume(await historique(dest))).toEqual(["accorde/recueilli_cabinet"]);

    const url = `/api/plateforme/cabinets/${cab.cabinetId}/utilisateurs/${u.utilisateurId}`;
    // Une modification qui ne désactive pas n'écrit rien.
    expect((await sa.p.patch(url, { roles: ["chef_mission"] })).statusCode).toBe(200);
    expect(resume(await historique(dest))).toEqual(["accorde/recueilli_cabinet"]);

    expect((await sa.p.patch(url, { actif: false })).statusCode).toBe(200);
    const h = await historique(dest);
    expect(resume(h)).toEqual(["accorde/recueilli_cabinet", "retire/desactivation_utilisateur"]);
    expect(h[1]?.acteur_id).toBe(u.utilisateurId);

    const audit = await auditCabinet(cab.cabinetId, "canal.consentement.retirer");
    const miens = audit.filter((l) => l.entite_id === u.utilisateurId);
    expect(miens).toHaveLength(1);
    expect(miens[0]).toMatchObject({
      utilisateur_id: null,
      details: { canaux: ["whatsapp"], source: "desactivation_utilisateur", origine: "plateforme" },
    });

    const ligne = (
      await proprietaire((c) =>
        c.query("SELECT verifie_le FROM canaux_destinataires WHERE id = $1", [dest]),
      )
    ).rows[0];
    expect(ligne.verifie_le).not.toBeNull();

    // Déjà inactif, puis réactivé : aucun nouveau retrait, aucune résurrection de l'accord.
    expect((await sa.p.patch(url, { roles: ["consultant"] })).statusCode).toBe(200);
    expect((await sa.p.patch(url, { actif: true })).statusCode).toBe(200);
    expect(resume(await historique(dest))).toEqual([
      "accorde/recueilli_cabinet",
      "retire/desactivation_utilisateur",
    ]);
  });
});
