/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LISTE_BLANCHE_PORTAIL, routeOuverteAuPortail } from "../src/portail/garde.js";
import { api, type Api } from "./api.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import {
  creerMission,
  preparerCabinet,
  type ApiUtilisateur,
  type CabinetMissions,
} from "./missions-outils.js";
import { CLE_INTERDITE, clesDe, inviterClient, type UtilisateurPortail } from "./portail-outils.js";

/*
 * Ateliers côté portail (PLA-15) : liste blanche stricte, rôles client, même 404 pour inexistant,
 * d'autrui, non invité ou non ouvert, projection (aucun agrégat, aucune contribution d'un autre, aucune
 * synthèse, aucun nom du cabinet, aucun identifiant du plan ou de la mission) et RLS du portail au
 * niveau SQL.
 */

let ctx: Contexte;
let a: CabinetMissions;
let b: CabinetMissions;
let consultant: ApiUtilisateur;
let planId: string;
let atelierId: string;
let brouillonId: string;
let options: { id: string; libelle: string }[];
let d1: UtilisateurPortail;
let d2: UtilisateurPortail;
let nonInvite: UtilisateurPortail;
let autreClient: UtilisateurPortail;
let dirigeantB: UtilisateurPortail;
let contributeur: UtilisateurPortail;
let investisseur: UtilisateurPortail;
let autreClientId: string;

const INCONNU = "00000000-0000-4000-8000-000000000000";

type Reponse = Awaited<ReturnType<Api["get"]>>;
function attendu(statut: number, r: Reponse) {
  expect(r.statusCode, r.body).toBe(statut);
  return r.json();
}
const erreur = (r: Reponse) => r.json().erreur.code as string;
const portail = (id: string) => `/api/portail/ateliers/${id}`;

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerCabinet(ctx, "Portail ateliers A");
  b = await preparerCabinet(ctx, "Portail ateliers B");
  const missionId = (await creerMission(a)).id;
  consultant = await a.avecRoles(["consultant"]);
  attendu(
    201,
    await a.chef.post(`/api/missions/${missionId}/equipe`, {
      utilisateur_id: consultant.utilisateurId,
    }),
  );
  planId = attendu(
    201,
    await a.chef.post(`/api/missions/${missionId}/plans`, { titre: "Plan portail" }),
  ).id;
  autreClientId = attendu(
    201,
    await a.associe.post("/api/clients", { raison_sociale: "Autre client" }),
  ).id;
  d1 = await inviterClient(ctx, a.associe, a.clientId, ["client_dirigeant"]);
  d2 = await inviterClient(ctx, a.associe, a.clientId, ["client_dirigeant"]);
  nonInvite = await inviterClient(ctx, a.associe, a.clientId, ["client_dirigeant"]);
  contributeur = await inviterClient(ctx, a.associe, a.clientId, ["client_contributeur"]);
  investisseur = await inviterClient(ctx, a.associe, a.clientId, ["client_investisseur"]);
  autreClient = await inviterClient(ctx, a.associe, autreClientId, ["client_dirigeant"]);
  dirigeantB = await inviterClient(ctx, b.associe, b.clientId, ["client_dirigeant"]);

  const corps = {
    titre: "Atelier du portail",
    consigne: "Répartissez vos points.",
    methodes: ["vote", "priorisation"],
    budget_points: 10,
    plafond_par_option: 8,
    options: [{ libelle: "Option un" }, { libelle: "Option deux" }, { libelle: "Option trois" }],
  };
  const at = attendu(201, await a.chef.post(`/api/plans/${planId}/ateliers`, corps));
  atelierId = at.id;
  options = at.options;
  brouillonId = attendu(201, await a.chef.post(`/api/plans/${planId}/ateliers`, corps)).id;
  for (const u of [consultant, d1, d2]) {
    attendu(
      201,
      await a.chef.post(`/api/plans/${planId}/ateliers/${atelierId}/participants`, {
        utilisateur_id: u.utilisateurId,
      }),
    );
  }
  // L'atelier « brouillon » invite d1 aussi : invisible tant qu'il n'est pas ouvert.
  attendu(
    201,
    await a.chef.post(`/api/plans/${planId}/ateliers/${brouillonId}/participants`, {
      utilisateur_id: d1.utilisateurId,
    }),
  );
  attendu(200, await a.chef.post(`/api/plans/${planId}/ateliers/${atelierId}/ouvrir`));
}, 240_000);

afterAll(() => ctx.fermer());

describe("liste blanche et rôles", () => {
  it("trois routes exactes, enregistrées ; tout le reste des ateliers du cabinet reste fermé (403)", async () => {
    const motifs = LISTE_BLANCHE_PORTAIL.filter((r) => r.motif.includes("/ateliers")).map((r) => [
      r.methodes.join(","),
      r.motif,
    ]);
    expect(motifs).toEqual([
      ["GET,HEAD", "/api/portail/ateliers"],
      ["GET,HEAD", "/api/portail/ateliers/:id"],
      ["PUT", "/api/portail/ateliers/:id/contribution/:methode"],
    ]);
    const enregistrees = ctx.app.routesInventoriees.filter((r) => r.motif.includes("/ateliers"));
    expect(enregistrees.length).toBeGreaterThan(10);
    for (const { methode, motif } of enregistrees) {
      if (methode === "OPTIONS" || methode === "HEAD") continue;
      const ouverte = routeOuverteAuPortail(methode, motif);
      expect(ouverte, `${methode} ${motif}`).toBe(motif.startsWith("/api/portail/ateliers"));
    }
    // Les routes du cabinet : 403 PORTAIL_ROUTE_INTERDITE avant tout accès aux données.
    const p = `/api/plans/${planId}/ateliers/${atelierId}`;
    for (const r of [
      await d1.get(`/api/plans/${planId}/ateliers`),
      await d1.get(p),
      await d1.get(`${p}/synthese`),
      await d1.get(`${p}/candidats`),
      await d1.get(`${p}/contribution`),
      await d1.put(`${p}/contribution/vote`, {
        points: [{ option_id: options[0]?.id, points: 1 }],
      }),
      await d1.post(`${p}/clore`),
      await d1.post(`${p}/synthese`),
      await d1.post(`${p}/participants`, { utilisateur_id: d1.utilisateurId }),
    ]) {
      expect(r.statusCode, r.body).toBe(403);
      expect(erreur(r)).toBe("PORTAIL_ROUTE_INTERDITE");
    }
  });

  it("contributeur et investisseur : 403 sur les trois routes ; anonyme : 401", async () => {
    for (const u of [contributeur, investisseur]) {
      for (const r of [
        await u.get("/api/portail/ateliers"),
        await u.get(portail(atelierId)),
        await u.put(`${portail(atelierId)}/contribution/vote`, {
          points: [{ option_id: options[0]?.id, points: 1 }],
        }),
      ]) {
        expect(r.statusCode, r.body).toBe(403);
      }
    }
    expect((await api(ctx).get("/api/portail/ateliers")).statusCode).toBe(401);
    // Un membre du cabinet n'est pas un utilisateur du portail.
    expect((await a.chef.get("/api/portail/ateliers")).statusCode).toBe(403);
  });
});

describe("dirigeant invité", () => {
  it("liste : SES ateliers ouverts seulement (pas le brouillon) ; projection sans donnée interne", async () => {
    const l = attendu(200, await d1.get("/api/portail/ateliers"));
    expect(l.elements).toHaveLength(1);
    expect(l.elements[0]).toMatchObject({
      id: atelierId,
      titre: "Atelier du portail",
      methodes: ["vote", "priorisation"],
      a_contribue: false,
    });
    expect(clesDe(l).filter((k) => CLE_INTERDITE.test(k))).toEqual([]);
    // Un dirigeant du même client NON invité, d'un autre client, d'un autre cabinet : liste vide.
    for (const u of [nonInvite, autreClient, dirigeantB]) {
      expect(attendu(200, await u.get("/api/portail/ateliers")).elements).toEqual([]);
    }
  });

  it("détail : énoncé, options, SA contribution ; jamais d'identifiant du plan ni de la mission", async () => {
    const d = attendu(200, await d1.get(portail(atelierId)));
    expect(d).toMatchObject({
      id: atelierId,
      consigne: "Répartissez vos points.",
      points_a_repartir: 10,
      plafond_points_par_option: 8,
      ma_contribution: {},
    });
    expect(d.options.map((o: any) => o.libelle)).toEqual([
      "Option un",
      "Option deux",
      "Option trois",
    ]);
    expect(clesDe(d).filter((k) => CLE_INTERDITE.test(k))).toEqual([]);
    const texte = JSON.stringify(d);
    for (const interdit of [
      planId,
      "plan_id",
      "mission_id",
      "resultats",
      "participation",
      "synthese",
      "participants",
      "nom",
    ]) {
      expect(texte, interdit).not.toContain(interdit);
    }
  });

  it("dépose puis remplace SA contribution ; budget, plafond, option inconnue, méthode : 400", async () => {
    const [o1, o2, o3] = options as [any, any, any];
    const url = (m: string) => `${portail(atelierId)}/contribution/${m}`;
    expect(
      (
        await d1.put(url("vote"), {
          points: [
            { option_id: o1.id, points: 6 },
            { option_id: o2.id, points: 5 },
          ],
        })
      ).statusCode,
    ).toBe(400);
    // Plafond de 8 points par option.
    expect(
      (await d1.put(url("vote"), { points: [{ option_id: o1.id, points: 9 }] })).statusCode,
    ).toBe(400);
    expect(erreur(await d1.put(url("vote"), { points: [{ option_id: INCONNU, points: 1 }] }))).toBe(
      "ATELIER_OPTION_INCONNUE",
    );
    expect(
      (
        await d1.put(url("vote"), {
          points: [
            { option_id: o1.id, points: 1 },
            { option_id: o1.id, points: 1 },
          ],
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await d1.put(url("matrice"), { positions: [{ option_id: o1.id, x: 1, y: 1 }] })).statusCode,
    ).toBe(400);
    expect(
      (await d1.put(url("vote"), { points: [{ option_id: o1.id, points: 1 }], intrus: 1 }))
        .statusCode,
    ).toBe(400);
    expect(
      attendu(
        200,
        await d1.put(url("vote"), {
          points: [
            { option_id: o1.id, points: 4 },
            { option_id: o2.id, points: 6 },
          ],
        }),
      ).version,
    ).toBe(1);
    expect(
      attendu(
        200,
        await d1.put(url("vote"), {
          points: [
            { option_id: o1.id, points: 8 },
            { option_id: o3.id, points: 2 },
          ],
        }),
      ).version,
    ).toBe(2);
    attendu(200, await d1.put(url("priorisation"), { classement: [o3.id, o1.id] }));
    // d2 vote autrement : d1 ne voit jamais la contribution de d2, et inversement.
    attendu(200, await d2.put(url("vote"), { points: [{ option_id: o2.id, points: 7 }] }));
    const moi = attendu(200, await d1.get(portail(atelierId))).ma_contribution;
    expect(moi.vote.version).toBe(2);
    expect(moi.vote.points).toEqual(
      expect.arrayContaining([
        { option_id: o1.id, points: 8 },
        { option_id: o3.id, points: 2 },
      ]),
    );
    expect(moi.priorisation.classement).toEqual([o3.id, o1.id]);
    const lui = attendu(200, await d2.get(portail(atelierId))).ma_contribution;
    expect(lui.vote.points).toEqual([{ option_id: o2.id, points: 7 }]);
    expect(lui.priorisation).toBeUndefined();
    expect(attendu(200, await d1.get("/api/portail/ateliers")).elements[0].a_contribue).toBe(true);
  });

  it("journal : contribution tracée sans contenu", async () => {
    const lignes = await proprietaire(
      async (c) =>
        (
          await c.query(
            "SELECT action, details FROM journal_audit WHERE action = 'portail_atelier_contribution' AND entite_id = $1",
            [atelierId],
          )
        ).rows,
    );
    expect(lignes.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(lignes)).toContain('"methode":"vote"');
    expect(JSON.stringify(lignes)).not.toContain("option_id");
    expect(JSON.stringify(lignes)).not.toContain('points":');
  });
});

describe("même 404 : inexistant, d'autrui, non invité, non ouvert", () => {
  it("réponses identiques pour tous les cas", async () => {
    const cas: [string, UtilisateurPortail][] = [
      [INCONNU, d1],
      [atelierId, nonInvite],
      [atelierId, autreClient],
      [atelierId, dirigeantB],
      [brouillonId, d1],
    ];
    const corps = { points: [{ option_id: options[0]?.id, points: 1 }] };
    const reference = await d1.get(portail(INCONNU));
    expect(reference.statusCode).toBe(404);
    for (const [id, u] of cas) {
      const g = await u.get(portail(id));
      expect(g.statusCode, id).toBe(404);
      expect(g.json()).toEqual(reference.json());
      const p = await u.put(`${portail(id)}/contribution/vote`, corps);
      expect(p.statusCode).toBe(404);
      expect(p.json()).toEqual(reference.json());
    }
  });
});

describe("RLS du portail au niveau SQL", () => {
  const dansPortail = <T>(clientId: string, utilisateurId: string, fn: (db: any) => Promise<T>) =>
    ctx.db.withTenant(a.cabinetId, async (db) => {
      await db.query(
        `SELECT set_config('app.portail_client_id', $1, true),
           set_config('app.portail_utilisateur_id', $2, true)`,
        [clientId, utilisateurId],
      );
      return fn(db);
    });
  const code = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      return "ok";
    } catch (e) {
      return (e as { code?: string }).code ?? String(e);
    }
  };

  it("ne lit que ses lignes : atelier ouvert invité, ses options, sa participation, ses contributions", async () => {
    const vu = await dansPortail(a.clientId, d1.utilisateurId, async (db) => ({
      ateliers: (await db.query("SELECT id FROM plan_ateliers")).rows.map((r: any) => r.id),
      options: (await db.query("SELECT count(*)::int AS n FROM plan_atelier_options")).rows[0].n,
      participants: (await db.query("SELECT utilisateur_id FROM plan_atelier_participants")).rows,
      contributions: (
        await db.query("SELECT DISTINCT utilisateur_id FROM plan_atelier_contributions")
      ).rows,
      lignes: (await db.query("SELECT count(*)::int AS n FROM plan_atelier_contribution_lignes"))
        .rows[0].n,
    }));
    expect(vu.ateliers).toEqual([atelierId]);
    expect(vu.options).toBe(3);
    // Ses invitations seulement (celle du brouillon comprise : sa propre ligne, rien d'autrui).
    expect(vu.participants).toHaveLength(2);
    expect(vu.participants.every((p: any) => p.utilisateur_id === d1.utilisateurId)).toBe(true);
    expect(vu.contributions).toEqual([{ utilisateur_id: d1.utilisateurId }]);
    expect(vu.lignes).toBe(2 + 2 + 2);
    // Autre client, non invité, autre utilisateur : rien.
    for (const [client, utilisateur] of [
      [autreClientId, d1.utilisateurId],
      [a.clientId, nonInvite.utilisateurId],
      [b.clientId, dirigeantB.utilisateurId],
    ] as const) {
      const rien = await dansPortail(client, utilisateur, async (db) => [
        (await db.query("SELECT 1 FROM plan_ateliers")).rows.length,
        (await db.query("SELECT 1 FROM plan_atelier_options")).rows.length,
        (await db.query("SELECT 1 FROM plan_atelier_participants")).rows.length,
        (await db.query("SELECT 1 FROM plan_atelier_contributions")).rows.length,
        (await db.query("SELECT 1 FROM plan_atelier_contribution_lignes")).rows.length,
      ]);
      expect(rien).toEqual([0, 0, 0, 0, 0]);
    }
  });

  it("n'écrit que SA contribution : ni atelier, ni option, ni invitation, ni contribution d'autrui", async () => {
    const ateliers = await dansPortail(a.clientId, d1.utilisateurId, async (db) => {
      const m = await db.query("UPDATE plan_ateliers SET titre = 'piraté' WHERE id = $1", [
        atelierId,
      ]);
      const s = await db.query("DELETE FROM plan_atelier_options WHERE atelier_id = $1", [
        atelierId,
      ]);
      return [m.rowCount, s.rowCount];
    });
    expect(ateliers).toEqual([0, 0]);
    // Refusée : par la politique (42501) ou, avant elle, par le déclencheur (MQL04).
    expect(["42501", "MQL04"]).toContain(
      await code(() =>
        dansPortail(a.clientId, d1.utilisateurId, (db) =>
          db.query(
            "INSERT INTO plan_atelier_participants (cabinet_id, atelier_id, utilisateur_id, partie, client_id, invite_par) VALUES ($1, $2, $3, 'client', $4, $3)",
            [a.cabinetId, atelierId, nonInvite.utilisateurId, a.clientId],
          ),
        ),
      ),
    );
    const politiques = await proprietaire(async (c) =>
      (
        await c.query(
          `SELECT tablename, policyname FROM pg_policies
             WHERE tablename IN ('plan_ateliers', 'plan_atelier_options', 'plan_atelier_participants')
               AND policyname LIKE 'portail%' ORDER BY 1, 2`,
        )
      ).rows.map((r) => `${r.tablename}.${r.policyname}`),
    );
    for (const t of ["plan_ateliers", "plan_atelier_options", "plan_atelier_participants"]) {
      for (const n of [
        "portail",
        "portail_sans_insert",
        "portail_sans_update",
        "portail_sans_delete",
      ]) {
        expect(politiques).toContain(`${t}.${n}`);
      }
    }
    const entete = (cid: string, uid: string, pid: string, v: number) =>
      `INSERT INTO plan_atelier_contributions (cabinet_id, atelier_id, participant_id, utilisateur_id, client_id, methode, version, nombre_lignes)
       VALUES ('${a.cabinetId}', '${atelierId}', '${pid}', '${uid}', '${cid}', 'vote', ${v}, 1)`;
    const parts = (
      await proprietaire((c) =>
        c.query("SELECT id, utilisateur_id FROM plan_atelier_participants WHERE atelier_id = $1", [
          atelierId,
        ]),
      )
    ).rows as { id: string; utilisateur_id: string }[];
    const p2 = parts.find((p) => p.utilisateur_id === d2.utilisateurId)?.id as string;
    // Les déclencheurs BEFORE répondent avant la politique : refus par l'un ou l'autre (42501, MQL04).
    // Contribution au nom de d2 : le participant de d2 n'est même pas visible de d1.
    expect(["42501", "MQL04"]).toContain(
      await code(() =>
        dansPortail(a.clientId, d1.utilisateurId, (db) =>
          db.query(entete(a.clientId, d2.utilisateurId, p2, 2)),
        ),
      ),
    );
    // Client d'un autre : refusée.
    const p1 = parts.find((p) => p.utilisateur_id === d1.utilisateurId)?.id as string;
    expect(["42501", "MQL04"]).toContain(
      await code(() =>
        dansPortail(a.clientId, d1.utilisateurId, (db) =>
          db.query(entete(autreClientId, d1.utilisateurId, p1, 3)),
        ),
      ),
    );
    // La sienne passe la politique ; le déclencheur exige alors une ligne complète (MQL06 à la validation).
    expect(
      await code(() =>
        dansPortail(a.clientId, d1.utilisateurId, (db) =>
          db.query(entete(a.clientId, d1.utilisateurId, p1, 3)),
        ),
      ),
    ).toBe("MQL06");
    // Ajout seul pour le portail aussi : pas d'UPDATE d'une contribution (privilège révoqué).
    expect(
      await code(() =>
        dansPortail(a.clientId, d1.utilisateurId, (db) =>
          db.query("UPDATE plan_atelier_contributions SET version = 9 WHERE atelier_id = $1", [
            atelierId,
          ]),
        ),
      ),
    ).toBe("42501");
  });

  it("après la clôture, plus rien à lire ni à écrire pour le portail", async () => {
    attendu(200, await a.chef.post(`/api/plans/${planId}/ateliers/${atelierId}/clore`));
    const rien = await dansPortail(a.clientId, d1.utilisateurId, async (db) => [
      (await db.query("SELECT 1 FROM plan_ateliers")).rows.length,
      (await db.query("SELECT 1 FROM plan_atelier_contributions")).rows.length,
      (await db.query("SELECT 1 FROM plan_atelier_contribution_lignes")).rows.length,
    ]);
    expect(rien).toEqual([0, 0, 0]);
    expect((await d1.get(portail(atelierId))).statusCode).toBe(404);
    expect(attendu(200, await d1.get("/api/portail/ateliers")).elements).toEqual([]);
  });
});
