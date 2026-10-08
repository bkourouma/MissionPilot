import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import { preparerCabinet, type CabinetMissions } from "./missions-outils.js";
import { consultantAffecte, missionTemps, type MissionTemps } from "./temps-outils.js";

/*
 * Clé d'idempotence des saisies de temps (migration 0122, temps/idempotence.ts) :
 * en-tête `Idempotency-Key` de PUT /feuilles-temps/:id/lignes, rejoué par la file
 * hors ligne du web. Un rejeu d'une clé déjà appliquée ne ré-applique rien.
 */

let ctx: Contexte;
let a: CabinetMissions;
let m: MissionTemps;

const LUNDI = "2026-11-02";
let compteur = 0;
const nouvelleCle = () =>
  `cle-test-${Date.now().toString(36)}-${(compteur++).toString(36)}-abcdef0123456789`;

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerCabinet(ctx, "Cabinet Temps Idempotence");
  m = await missionTemps(a, { Diagnostic: { senior: 10 } });
});
afterAll(() => ctx.fermer());

type Consultant = Awaited<ReturnType<typeof consultantAffecte>>;

/** PUT des lignes avec une clé d'idempotence facultative. */
function saisir(u: Consultant, feuilleId: string, jours: number[], cle?: string) {
  const lignes = jours.map((j, i) => ({
    date: `2026-11-0${2 + i}`,
    tache_id: m.taches.Diagnostic,
    jours: j,
  }));
  return u.brut({
    method: "PUT",
    url: `/api/feuilles-temps/${feuilleId}/lignes`,
    payload: JSON.stringify({ lignes }),
    headers: { "content-type": "application/json", ...(cle ? { "idempotency-key": cle } : {}) },
  });
}

async function feuilleDe(u: Consultant): Promise<string> {
  const f = await u.post("/api/feuilles-temps", { semaine: LUNDI, pre_remplir: false });
  expect(f.statusCode, f.body).toBe(201);
  return f.json().id as string;
}

const totalJours = async (u: Consultant, id: string) =>
  (await u.get(`/api/feuilles-temps/${id}`)).json().totaux.semaine as number;

describe("Idempotency-Key sur la saisie des lignes", () => {
  it("première application normale ; un rejeu tardif n'écrase pas une saisie plus récente", async () => {
    const u = await consultantAffecte(a, m, { Diagnostic: 10 });
    const id = await feuilleDe(u);
    const cle = nouvelleCle();
    const premiere = await saisir(u, id, [1], cle);
    expect(premiere.statusCode, premiere.body).toBe(200);
    expect(premiere.headers["idempotency-replayed"]).toBeUndefined();
    expect(await totalJours(u, id)).toBe(1);

    // Saisie plus récente (autre appareil, sans clé) : 2 jours.
    expect((await saisir(u, id, [1, 1])).statusCode).toBe(200);
    expect(await totalJours(u, id)).toBe(2);

    // Rejeu de la première saisie (réponse perdue) : rien n'est ré-appliqué.
    const rejeu = await saisir(u, id, [1], cle);
    expect(rejeu.statusCode, rejeu.body).toBe(200);
    expect(rejeu.headers["idempotency-replayed"]).toBe("true");
    expect(rejeu.json().totaux.semaine).toBe(2);
    expect(await totalJours(u, id)).toBe(2);

    // Sans clé, le PUT complet garde son comportement (dernier état gagnant).
    expect((await saisir(u, id, [1])).statusCode).toBe(200);
    expect(await totalJours(u, id)).toBe(1);
  });

  it("même clé pour un autre contenu ou une autre feuille : 409", async () => {
    const u = await consultantAffecte(a, m, { Diagnostic: 10 });
    const id = await feuilleDe(u);
    const cle = nouvelleCle();
    expect((await saisir(u, id, [1], cle)).statusCode).toBe(200);
    const autreContenu = await saisir(u, id, [1, 1], cle);
    expect(autreContenu.statusCode).toBe(409);
    expect(autreContenu.json().erreur.code).toBe("CLE_IDEMPOTENCE_REUTILISEE");
    expect(await totalJours(u, id)).toBe(1);
  });

  it("une saisie refusée ne consomme pas la clé : elle se rejoue une fois corrigée", async () => {
    const u = await consultantAffecte(a, m, { Diagnostic: 10 });
    const id = await feuilleDe(u);
    const cle = nouvelleCle();
    const refusee = await u.brut({
      method: "PUT",
      url: `/api/feuilles-temps/${id}/lignes`,
      payload: JSON.stringify({
        lignes: [{ date: LUNDI, tache_id: "00000000-0000-4000-8000-000000000000", jours: 1 }],
      }),
      headers: { "content-type": "application/json", "idempotency-key": cle },
    });
    expect(refusee.statusCode).toBeGreaterThanOrEqual(400);
    const lignes = await proprietaire((cl) =>
      cl.query("SELECT 1 FROM saisies_idempotence WHERE cle = $1", [cle]),
    );
    expect(lignes.rowCount).toBe(0);
    const ok = await saisir(u, id, [1], cle);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.headers["idempotency-replayed"]).toBeUndefined();
  });

  it("une feuille soumise ensuite : le rejeu d'une saisie appliquée répond l'état, pas 409", async () => {
    const u = await consultantAffecte(a, m, { Diagnostic: 10 });
    const id = await feuilleDe(u);
    const cle = nouvelleCle();
    expect((await saisir(u, id, [1], cle)).statusCode).toBe(200);
    expect((await u.post(`/api/feuilles-temps/${id}/soumettre`)).statusCode).toBe(200);
    // Sans clé (ou avec une autre), la feuille soumise est refusée (409).
    expect((await saisir(u, id, [1])).statusCode).toBe(409);
    expect((await saisir(u, id, [1], nouvelleCle())).statusCode).toBe(409);
    const rejeu = await saisir(u, id, [1], cle);
    expect(rejeu.statusCode, rejeu.body).toBe(200);
    expect(rejeu.headers["idempotency-replayed"]).toBe("true");
    expect(rejeu.json().statut).toBe("soumise");
  });

  it("la clé est propre à l'utilisateur : deux utilisateurs peuvent tirer la même sans conflit", async () => {
    const u1 = await consultantAffecte(a, m, { Diagnostic: 10 });
    const u2 = await consultantAffecte(a, m, { Diagnostic: 10 });
    const id1 = await feuilleDe(u1);
    const id2 = await feuilleDe(u2);
    const cle = nouvelleCle();
    const r1 = await saisir(u1, id1, [1], cle);
    const r2 = await saisir(u2, id2, [1, 1], cle);
    expect(r1.statusCode, r1.body).toBe(200);
    expect(r2.statusCode, r2.body).toBe(200);
    expect(r1.headers["idempotency-replayed"]).toBeUndefined();
    expect(r2.headers["idempotency-replayed"]).toBeUndefined();
    expect(await totalJours(u1, id1)).toBe(1);
    expect(await totalJours(u2, id2)).toBe(2);
    // La feuille d'un autre n'est pas atteignable, clé ou non.
    expect((await saisir(u2, id1, [1], nouvelleCle())).statusCode).toBeGreaterThanOrEqual(403);
  });

  it("deux requêtes simultanées de même clé : une application, un rejeu", async () => {
    const u = await consultantAffecte(a, m, { Diagnostic: 10 });
    const id = await feuilleDe(u);
    const cle = nouvelleCle();
    const [r1, r2] = await Promise.all([saisir(u, id, [1], cle), saisir(u, id, [1], cle)]);
    expect([r1.statusCode, r2.statusCode]).toEqual([200, 200]);
    const rejeux = [r1, r2].filter((r) => r.headers["idempotency-replayed"] === "true");
    expect(rejeux).toHaveLength(1);
    const n = await proprietaire((cl) =>
      cl.query("SELECT count(*)::int AS n FROM saisies_idempotence WHERE cle = $1", [cle]),
    );
    expect(n.rows[0].n).toBe(1);
  });

  it("format de clé invalide : 400 ; les clés de plus de 30 jours sont purgées au fil des saisies", async () => {
    const u = await consultantAffecte(a, m, { Diagnostic: 10 });
    const id = await feuilleDe(u);
    for (const cle of ["court", "a b c d e f g h", "é".repeat(12), "x".repeat(101)]) {
      const r = await saisir(u, id, [1], cle);
      expect(r.statusCode, cle).toBe(400);
    }
    const ancienne = nouvelleCle();
    expect((await saisir(u, id, [1], ancienne)).statusCode).toBe(200);
    await proprietaire((cl) =>
      cl.query(
        "UPDATE saisies_idempotence SET cree_le = now() - interval '31 days' WHERE cle = $1",
        [ancienne],
      ),
    );
    expect((await saisir(u, id, [1], nouvelleCle())).statusCode).toBe(200);
    const restantes = await proprietaire((cl) =>
      cl.query("SELECT 1 FROM saisies_idempotence WHERE cle = $1", [ancienne]),
    );
    expect(restantes.rowCount).toBe(0);
  });

  it("isolation : le portail et le rôle applicatif ne modifient jamais une clé", async () => {
    const u = await consultantAffecte(a, m, { Diagnostic: 10 });
    const id = await feuilleDe(u);
    expect((await saisir(u, id, [1], nouvelleCle())).statusCode).toBe(200);
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query("UPDATE saisies_idempotence SET empreinte = empreinte"),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});
