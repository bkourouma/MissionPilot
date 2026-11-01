import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/pool.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import { creerMission, creerMissionSignee, preparerCabinet } from "./missions-outils.js";
import { utilisateurCollaborateur } from "./planification-outils.js";

/*
 * Planification mensuelle de l'activité de démonstration (migration 0584,
 * `planifier_activite_demo`) : fonction SECURITY DEFINER étroite et STRICTE, testée par appels SQL
 * directs avec le rôle applicatif hors contexte de cabinet (comme le planificateur).
 *
 * Le mois visé est 2099-01 : aucune tâche créée ici n'est échue pour un worker d'un autre fichier
 * (base de test partagée) ; elles sont supprimées en fin de fichier, et les cabinets créés ici sont
 * démarqués (est_demo faux), comme dans plateforme-bac-a-sable.test.ts.
 */

let ctx: Contexte;
const CLE = "activite_demo:2099-01";
const PREMIER = "2099-01-01";
const DANS_LE_MOIS = "2099-01-01T04:00:00.000Z";

/** Cabinets du ciblage : un seul est éligible. */
const cabinets = {
  reel: "",
  inactif: "",
  sansUtilisateurActif: "",
  sansMissionEnVol: "",
  eligible: "",
};

/** Appel de la fonction par le rôle applicatif, hors contexte de cabinet (comme le planificateur). */
function planifier(cle: string | null, executeA: string | null, premier: string | null) {
  return ctx.db.withoutTenant(async (db: Db) => {
    const r = await db.query("SELECT planifier_activite_demo($1, $2, $3::date) AS n", [
      cle,
      executeA,
      premier,
    ]);
    return r.rows[0].n as number;
  });
}

/** Message du refus de la fonction, ou null si elle a répondu. */
async function refus(
  cle: string | null,
  executeA: string | null,
  premier: string | null,
): Promise<string | null> {
  try {
    await planifier(cle, executeA, premier);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

/** Tâches du mois visé pour un cabinet (rôle propriétaire). */
async function tachesDu(cabinetId: string) {
  const r = await proprietaire((c) =>
    c.query(
      `SELECT type, charge, statut, execute_a FROM jobs
       WHERE cabinet_id = $1 AND cle = $2 ORDER BY cree_le`,
      [cabinetId, CLE],
    ),
  );
  return r.rows as { type: string; charge: unknown; statut: string; execute_a: Date }[];
}

async function cabinetCible(
  nom: string,
  o: { estDemo: boolean; actif: boolean; utilisateurActif: boolean; missionSignee: boolean },
): Promise<string> {
  const c = await preparerCabinet(ctx, nom);
  if (o.missionSignee) await creerMissionSignee(c, { intitule: `Mission signée ${nom}` });
  else await creerMission(c, { intitule: `Mission en proposition ${nom}` });
  // preparerCabinet crée des collaborateurs SANS utilisateur : seul celui-ci est rattaché.
  const u = await utilisateurCollaborateur(c, ["consultant"]);
  if (!o.utilisateurActif) {
    const sql = "UPDATE utilisateurs SET actif = false WHERE id = $1";
    await proprietaire((cl) => cl.query(sql, [u.utilisateurId]));
  }
  const sql = "UPDATE cabinets SET est_demo = $2, actif = $3 WHERE id = $1";
  await proprietaire((cl) => cl.query(sql, [c.cabinetId, o.estDemo, o.actif]));
  return c.cabinetId;
}

beforeAll(async () => {
  ctx = await demarrer();
  const base = { estDemo: true, actif: true, utilisateurActif: true, missionSignee: true };
  cabinets.reel = await cabinetCible("Activité démo : réel", { ...base, estDemo: false });
  cabinets.inactif = await cabinetCible("Activité démo : désactivé", { ...base, actif: false });
  cabinets.sansUtilisateurActif = await cabinetCible("Activité démo : utilisateur inactif", {
    ...base,
    utilisateurActif: false,
  });
  cabinets.sansMissionEnVol = await cabinetCible("Activité démo : sans mission en vol", {
    ...base,
    missionSignee: false,
  });
  cabinets.eligible = await cabinetCible("Activité démo : éligible", base);
}, 180_000);

afterAll(async () => {
  await proprietaire(async (c) => {
    await c.query("DELETE FROM jobs WHERE type = 'activite_demo' AND cle = $1", [CLE]);
    const sql = "UPDATE cabinets SET est_demo = false, actif = true WHERE id = ANY ($1::uuid[])";
    // Seuls les cabinets créés : une préparation interrompue laisse des identifiants vides.
    await c.query(sql, [Object.values(cabinets).filter(Boolean)]);
  });
  await ctx.fermer();
});

describe("planifier_activite_demo : fonction stricte", () => {
  it("refuse tout paramètre nul", async () => {
    const message = /paramètres obligatoires/;
    expect(await refus(null, DANS_LE_MOIS, PREMIER)).toMatch(message);
    expect(await refus(CLE, null, PREMIER)).toMatch(message);
    expect(await refus(CLE, DANS_LE_MOIS, null)).toMatch(message);
  });

  it("refuse une clé incohérente, un mois 13, un jour autre que le 1er, une autre clé de job ou une clé de suite", async () => {
    const message = /Clé de l'activité de démonstration invalide/;
    // Clé d'un autre mois que le premier jour donné.
    expect(await refus("activite_demo:2099-02", DANS_LE_MOIS, PREMIER)).toMatch(message);
    // Mois 13 : la date passée est valide, la clé non.
    const decembre = "2026-12-01T04:00:00.000Z";
    expect(await refus("activite_demo:2026-13", decembre, "2026-12-01")).toMatch(message);
    // Jour différent de 1, avec une clé cohérente avec le mois.
    expect(await refus(CLE, "2099-01-02T04:00:00.000Z", "2099-01-02")).toMatch(message);
    // Préfixe d'un autre job ; clé de suite hebdomadaire (réservée au handler).
    expect(await refus("avancement_hebdo:2099-01", DANS_LE_MOIS, PREMIER)).toMatch(message);
    expect(await refus(`${CLE}:2099-01-05`, DANS_LE_MOIS, PREMIER)).toMatch(message);
  });

  it("refuse une heure d'exécution hors du mois visé (UTC), sans créer de tâche", async () => {
    const message = /hors du mois visé/;
    expect(await refus(CLE, "2098-12-31T23:59:59.000Z", PREMIER)).toMatch(message);
    expect(await refus(CLE, "2099-02-01T00:00:00.000Z", PREMIER)).toMatch(message);
    for (const id of Object.values(cabinets)) expect(await tachesDu(id)).toEqual([]);
  });
});

describe("planifier_activite_demo : ciblage et idempotence", () => {
  it("une tâche pour le seul cabinet de démonstration actif, peuplé et ayant une mission en vol", async () => {
    // D'autres cabinets de démonstration de la base partagée peuvent aussi être planifiés.
    expect(await planifier(CLE, DANS_LE_MOIS, PREMIER)).toBeGreaterThanOrEqual(1);
    expect(await tachesDu(cabinets.reel)).toEqual([]);
    expect(await tachesDu(cabinets.inactif)).toEqual([]);
    expect(await tachesDu(cabinets.sansUtilisateurActif)).toEqual([]);
    expect(await tachesDu(cabinets.sansMissionEnVol)).toEqual([]);
    const taches = await tachesDu(cabinets.eligible);
    expect(taches).toHaveLength(1);
    expect(taches[0]).toMatchObject({
      type: "activite_demo",
      charge: { mois: "2099-01" },
      statut: "en_attente",
    });
    expect(taches[0]!.execute_a.toISOString()).toBe(DANS_LE_MOIS);
  });

  it("un second appel du mois ne double rien (clé unique par cabinet)", async () => {
    expect(await planifier(CLE, "2099-01-20T04:00:00.000Z", PREMIER)).toBe(0);
    const taches = await tachesDu(cabinets.eligible);
    expect(taches).toHaveLength(1);
    expect(taches[0]!.execute_a.toISOString()).toBe(DANS_LE_MOIS);
  });

  it("aucune tâche de suite hebdomadaire : la fonction ne pose que la tâche mensuelle", async () => {
    const sql = "SELECT cle FROM jobs WHERE cabinet_id = $1 AND type = 'activite_demo'";
    const r = await proprietaire((c) => c.query(sql, [cabinets.eligible]));
    expect(r.rows).toEqual([{ cle: CLE }]);
  });
});

describe("planifier_activite_demo : droits", () => {
  it("SECURITY DEFINER, search_path figé, EXECUTE au seul rôle applicatif, signature exacte", async () => {
    const r = await proprietaire((c) =>
      c.query(
        `SELECT p.prosecdef, p.proconfig, pg_get_function_identity_arguments(p.oid) AS args,
                pg_get_function_result(p.oid) AS resultat,
                has_function_privilege('missionpilot_app', p.oid, 'EXECUTE') AS app,
                has_function_privilege('public', p.oid, 'EXECUTE') AS public,
                array(SELECT DISTINCT a.grantee::regrole::text FROM aclexplode(p.proacl) a
                      WHERE a.grantee <> 0 AND a.grantee <> p.proowner ORDER BY 1) AS autres
         FROM pg_proc p
         WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'planifier_activite_demo'`,
      ),
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({
      prosecdef: true,
      app: true,
      public: false,
      args: "p_cle text, p_execute_a timestamp with time zone, p_premier date",
      resultat: "integer",
      autres: ["missionpilot_app"],
    });
    expect(r.rows[0].proconfig).toContain("search_path=public, pg_temp");
  });

  it("sans la fonction, le rôle applicatif n'écrit pas la tâche d'un autre cabinet (RLS, 42501)", async () => {
    const id = cabinets.reel;
    const sql = `INSERT INTO jobs (cabinet_id, type, charge, execute_a, cle)
                 VALUES ($1, 'activite_demo', '{"mois":"2099-01"}', $2, $3)`;
    let code: string | null = null;
    try {
      await ctx.db.withTenant(cabinets.eligible, (db) => db.query(sql, [id, DANS_LE_MOIS, CLE]));
    } catch (e) {
      code = (e as { code?: string }).code ?? null;
    }
    expect(code).toBe("42501");
    expect(await tachesDu(id)).toEqual([]);
  });
});
