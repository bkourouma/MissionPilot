import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import {
  attendre,
  creerCampagne,
  echantillonDe,
  evaluerTout,
  P,
  preparerFroide,
  revueTerminee,
  type ScenarioFroide,
} from "./qualite-froide-outils.js";

/*
 * Revue à froid (QUA-05) : « mes revues » paginé par curseur (clé stable, ordre conservé) et
 * réaffectation interdite une fois la revue commencée (API 409 et déclencheur MQQ13).
 */

let ctx: Contexte;
let s: ScenarioFroide;
let ech: string[]; // dans l'ordre d'affectation à `tiers`

beforeAll(async () => {
  ctx = await demarrer();
  s = await preparerFroide(ctx, "Froide Pagination", 5);
  const campagne = await creerCampagne(s.c.associe);
  ech = s.missions.map((m) => echantillonDe(campagne, m).id);
});
afterAll(async () => {
  await ctx.fermer();
});

const affecter = (relecteurId: string, id: string) =>
  s.c.associe.post(`${P}/echantillons/${id}/affectation`, { relecteur_id: relecteurId });

describe("mes revues : pagination par curseur", () => {
  it("parcourt toutes les pages dans l'ordre (non terminées d'abord, plus récentes d'abord)", async () => {
    for (const id of ech) attendre(200, await affecter(s.tiers.utilisateurId, id), "affectation");
    // La première affectée est terminée : elle passe en fin de liste.
    const terminee = ech[0] as string;
    attendre(200, await affecter(s.tiers.utilisateurId, terminee), "ré-affectation");
    await evaluerTout(s.tiers, terminee, 4);
    attendre(
      200,
      await s.tiers.post(`${P}/echantillons/${terminee}/terminer`, { synthese: "Terminée." }),
      "terminaison",
    );

    const attendu = [...ech.slice(1).reverse(), terminee];
    const vus: string[] = [];
    let curseur: string | null = null;
    const tailles: number[] = [];
    for (let i = 0; i < 10; i++) {
      const q: string = `limite=2${curseur ? `&curseur=${encodeURIComponent(curseur)}` : ""}`;
      const r = await s.tiers.get(`${P}/mes-revues?${q}`);
      expect(r.statusCode, r.body).toBe(200);
      const corps = r.json();
      expect(corps).not.toHaveProperty("suivant");
      expect(corps.elements[0]).not.toHaveProperty("cle_terminee");
      expect(corps.elements[0]).not.toHaveProperty("cle_affecte");
      tailles.push(corps.elements.length);
      vus.push(...corps.elements.map((e: { id: string }) => e.id));
      curseur = corps.curseur_suivant;
      if (!curseur) break;
    }
    expect(tailles).toEqual([2, 2, 1]);
    expect(vus).toEqual(attendu);
    // Sans paramètre : toutes les revues d'une page, sans curseur.
    const tout = (await s.tiers.get(`${P}/mes-revues`)).json();
    expect(tout.elements.map((e: { id: string }) => e.id)).toEqual(attendu);
    expect(tout.curseur_suivant).toBeNull();
  });

  it("refuse un curseur invalide et des paramètres hors bornes (400)", async () => {
    const faux = Buffer.from(JSON.stringify([2, "x", "pas-un-uuid"])).toString("base64url");
    for (const q of [
      "curseur=n-importe-quoi",
      `curseur=${faux}`,
      "limite=0",
      "limite=101",
      "inconnu=1",
    ]) {
      const r = await s.tiers.get(`${P}/mes-revues?${q}`);
      expect(r.statusCode, q).toBe(400);
    }
  });
});

describe("réaffectation interdite en cours de revue (MQQ13)", () => {
  it("refusée par l'API (409) puis par la base une fois la revue commencée", async () => {
    const x = ech[1] as string;
    // Avant la saisie (affectée) : la réaffectation reste permise.
    attendre(200, await affecter(s.tiers2.utilisateurId, x), "réaffectation avant saisie");
    const ev = await s.tiers2.put(`${P}/echantillons/${x}/evaluations`, {
      critere: "conformite_methode",
      note: 3,
    });
    expect(ev.statusCode, ev.body).toBe(200);
    expect(ev.json().echantillon.statut).toBe("en_revue");

    const r = await affecter(s.tiers.utilisateurId, x);
    expect(r.statusCode, r.body).toBe(409);
    expect(r.json().erreur.code).toBe("REAFFECTATION_EN_REVUE");
    expect(r.json().erreur.message).toMatch(/commencée/);
    // Même relecteur : l'API refuse aussi (aucune écriture en cours de revue).
    expect((await affecter(s.tiers2.utilisateurId, x)).statusCode).toBe(409);
    const apres = await s.c.associe.get(`${P}/echantillons/${x}`);
    expect(apres.json().echantillon.relecteur.id).toBe(s.tiers2.utilisateurId);

    // Base, rôle applicatif sous RLS : le déclencheur refuse le changement de relecteur.
    await expect(
      ctx.db.withTenant(s.c.cabinetId, (db) =>
        db.query(
          `UPDATE qualite_froide_echantillon
           SET relecteur_id = $2, affecte_par = $3, affecte_le = now() WHERE id = $1`,
          [x, s.tiers.utilisateurId, s.tiers.utilisateurId],
        ),
      ),
    ).rejects.toMatchObject({ code: "MQQ13" });
    // Même refus pour le propriétaire (hors RLS).
    await expect(
      proprietaire((cl) =>
        cl.query("UPDATE qualite_froide_echantillon SET relecteur_id = $2 WHERE id = $1", [
          x,
          s.tiers.utilisateurId,
        ]),
      ),
    ).rejects.toMatchObject({ code: "MQQ13" });
    // Le relecteur reste en place, et une mise à jour qui ne change pas de relecteur passe.
    const l = await proprietaire((cl) =>
      cl.query("SELECT relecteur_id, statut FROM qualite_froide_echantillon WHERE id = $1", [x]),
    );
    expect(l.rows[0]).toMatchObject({ relecteur_id: s.tiers2.utilisateurId, statut: "en_revue" });
  });

  it("une revue terminée reste refusée par MQQ04 (REVUE_FROIDE_TERMINEE)", async () => {
    const y = ech[2] as string;
    await revueTerminee(s.c.associe, s.tiers2, y);
    const r = await affecter(s.tiers.utilisateurId, y);
    expect(r.statusCode).toBe(409);
    expect(r.json().erreur.code).toBe("REVUE_FROIDE_TERMINEE");
    await expect(
      proprietaire((cl) =>
        cl.query("UPDATE qualite_froide_echantillon SET relecteur_id = $2 WHERE id = $1", [
          y,
          s.tiers.utilisateurId,
        ]),
      ),
    ).rejects.toMatchObject({ code: "MQQ04" });
  });
});
