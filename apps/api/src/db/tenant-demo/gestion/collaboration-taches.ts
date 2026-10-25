import { ajouterJours } from "@missionpilot/engines";
import type { ContexteTenantDemo } from "../contexte.js";
import type { Casting, CleMission } from "./casting.js";
import { TACHES_ASSIGNEES } from "./collaboration-donnees-taches.js";
import {
  ancrer,
  encadrer,
  equipeDe,
  heureISO,
  jourSur,
  ouvre,
  periode,
  plusTard,
  sansDeclencheurs,
  sessionDe,
  type Acteur,
  type Equipe,
} from "./collaboration-outils.js";
import { ok } from "./outils.js";

/*
 * TÂCHES ASSIGNÉES (SOC-08, migration 0075) : demandes d'un collègue à un autre, liées à une
 * mission, à une de ses tâches ou à une opportunité. Créées par le créateur (`tache.assigner`),
 * avancées et closes par leur ASSIGNÉ (seul le statut change), par `POST` et `PATCH
 * /api/taches-collaboration`. L'identité d'une tâche est figée par déclencheur : ses dates sont
 * remontées sans déclencheurs, comme pour les autres tables en ajout seul. Idempotent : clé
 * (titre, assigné). Les tâches posées par l'automatisation (lot IA) ne sont jamais touchées.
 */

/** Tâche de mission ou mission/opportunité liée : entité résolue. */
async function entiteDe(
  ctx: ContexteTenantDemo,
  casting: Casting,
  t: (typeof TACHES_ASSIGNEES)[number],
): Promise<{ entite_type?: string; entite_id?: string } | null> {
  if (t.opportunite) {
    const r = await ctx.proprietaire.query(
      "SELECT id FROM opportunites WHERE cabinet_id = $1 AND intitule = $2",
      [ctx.cabinetId, t.opportunite],
    );
    const id = r.rows[0]?.id as string | undefined;
    return id ? { entite_type: "opportunite", entite_id: id } : null;
  }
  if (!t.m) return {};
  const m = casting.missions[t.m];
  if (!m) return null;
  if (t.tache) {
    const x = m.taches.find((y) => y.libelle.includes(t.tache as string));
    return x ? { entite_type: "mission_tache", entite_id: x.id } : null;
  }
  return { entite_type: "mission", entite_id: m.id };
}

export async function semerTaches(
  ctx: ContexteTenantDemo,
  casting: Casting,
  acteurs: Map<string, Acteur>,
): Promise<number> {
  const auj = ctx.aujourdhui;
  const equipes = new Map<CleMission | "support", Equipe>();
  const equipeDeMission = async (cle: CleMission | null): Promise<Equipe | null> => {
    // Tâche sans mission (support, pipeline) : l'équipe d'une mission du casting sert à nommer les
    // rôles (directeur, chef, associé, gestionnaire, ressources).
    const k = cle ?? "support";
    const connue = equipes.get(k);
    if (connue) return connue;
    const m = cle ? casting.missions[cle] : casting.missions["baobab-plan"];
    if (!m) return null;
    const e = await equipeDe(ctx, m, acteurs);
    equipes.set(k, e);
    return e;
  };
  let crees = 0;
  for (const t of TACHES_ASSIGNEES) {
    const equipe = await equipeDeMission(t.m);
    if (!equipe) continue;
    const createur = equipe.parRole[t.de];
    const assigne = equipe.parRole[t.a];
    if (createur.id === assigne.id) {
      ctx.journal(`  tâches : « ${t.titre} » ignorée (créateur et assigné identiques).`);
      continue;
    }
    const deja = await ctx.proprietaire.query(
      "SELECT 1 FROM taches_collaboration WHERE cabinet_id = $1 AND titre = $2 AND assignee_id = $3",
      [ctx.cabinetId, t.titre, assigne.id],
    );
    if ((deja.rowCount ?? 0) > 0) continue;
    const entite = await entiteDe(ctx, casting, t);
    if (!entite) {
      ctx.journal(`  tâches : entité introuvable pour « ${t.titre} » (ignorée).`);
      continue;
    }
    const mission = t.m ? casting.missions[t.m] : undefined;
    const base =
      t.ilYa !== undefined
        ? ajouterJours(auj, -t.ilYa)
        : mission
          ? jourSur(periode(ctx, mission), t.q ?? 0.5)
          : ajouterJours(auj, -10);
    const plancher = plusTard(createur.depuis, assigne.depuis);
    const creation = ouvre(plusTard(base, plancher), auj);
    const echeance = ouvre(ajouterJours(creation, t.delai), "9999-12-31");
    const s = sessionDe(ctx, createur);
    const sa = sessionDe(ctx, assigne);
    const graine = t.titre.length;

    // 1. Création par le créateur.
    const { resultat: id, fenetre } = await encadrer(ctx, async () => {
      const r = await s.post("/api/taches-collaboration", {
        titre: t.titre,
        description: t.description,
        assignee_id: assigne.id,
        echeance,
        ...entite,
      });
      ok(201, r, `tâche « ${t.titre} »`);
      return r.json().id as string;
    });
    const instantCreation = heureISO(creation, 8 + (graine % 8), (graine * 7) % 55);
    await ancrer(ctx, fenetre, instantCreation, creation < ajouterJours(auj, -3));

    // 2. Avancement par l'assigné : en cours, puis fait.
    let modifie = instantCreation;
    let faitLe: string | null = null;
    if (t.statut !== "a_faire") {
      const jourDebut = ouvre(ajouterJours(creation, 1), auj);
      const e = await encadrer(ctx, async () => {
        ok(
          200,
          await sa.patch(`/api/taches-collaboration/${id}`, { statut: "en_cours" }),
          "en cours",
        );
      });
      modifie = heureISO(jourDebut, 9 + (graine % 6), (graine * 3) % 55);
      await ancrer(ctx, e.fenetre, modifie, true);
    }
    if (t.statut === "fait") {
      const jourFait = ouvre(ajouterJours(creation, Math.max(2, t.faiteApres ?? t.delai)), auj);
      const e = await encadrer(ctx, async () => {
        ok(
          200,
          await sa.patch(`/api/taches-collaboration/${id}`, { statut: "fait" }),
          "tâche faite",
        );
      });
      faitLe = heureISO(jourFait, 14 + (graine % 4), (graine * 5) % 55);
      modifie = faitLe;
      await ancrer(ctx, e.fenetre, faitLe, jourFait < ajouterJours(auj, -3));
    }
    await sansDeclencheurs(ctx, async (c) => {
      await c.query(
        `UPDATE taches_collaboration
            SET cree_le = $2::timestamptz, modifie_le = $3::timestamptz, fait_le = $4::timestamptz
          WHERE id = $1`,
        [id, instantCreation, modifie, faitLe],
      );
    });
    crees += 1;
  }
  ctx.journal(`  tâches assignées : ${crees} créées.`);
  return crees;
}
