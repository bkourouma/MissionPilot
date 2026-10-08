import { kpiCreationSchema, PERSPECTIVES_PLAN, type PerspectivePlan } from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { conflit, introuvable } from "../errors.js";
import { insererKpi } from "../kpi/creation.js";
import { exigerPlanRedigeable, exigerPlanVisible } from "./acces.js";
import { elementsCourants, type VersionDb } from "./elements.js";

/*
 * KPI créés depuis les objectifs du plan (PLA-10).
 *
 * Le KPI est créé DANS le module de pilotage (`kpi_definitions`, 0160), sur la
 * mission du plan, avec les mêmes règles que POST /missions/:id/kpi
 * (kpi/creation.ts, `insererKpi`, partagé avec routes/kpi.ts) :
 * corps `kpiCreationSchema`, mission modifiable (responsable, non clôturée),
 * plafond MAX_KPI_PAR_MISSION, propriétaire admis, début de suivi ramené au
 * début de sa période par le moteur KPI. Le rattachement à l'objectif est
 * tracé dans `plan_objectif_kpis` (0183, ajout seul) avec la version de
 * l'objectif. Sans perspective dans le corps, le KPI prend celle de
 * l'objectif. Permissions (routes/plans.ts) : « plan.ecrire » ET
 * « kpi.gerer » ; lecture : « plan.lire » ET « kpi.lire ».
 *
 * Aucun chiffre n'est produit ici : la cible éventuelle est saisie par
 * l'utilisateur ; statuts et taux d'atteinte viennent du moteur KPI.
 */

interface KpiLie {
  objectif_id: string;
  objectif_version: number;
  id: string;
  libelle: string;
  unite: string;
  perspective: string | null;
  frequence: string;
  actif: boolean;
  cree_le: string;
}

function vueObjectif(v: VersionDb, kpis: readonly KpiLie[]) {
  const c = v.contenu as {
    titre?: string;
    perspective?: string;
    indicateur?: string | null;
    cible?: string | null;
  };
  return {
    id: v.element_id,
    parent_id: v.parent_id,
    version: v.version,
    statut_contenu: v.statut_contenu,
    retire: v.retire,
    titre: c.titre ?? "",
    perspective: c.perspective ?? null,
    indicateur: c.indicateur ?? null,
    cible: c.cible ?? null,
    kpis: kpis.filter((k) => k.objectif_id === v.element_id).map(({ objectif_id: _o, ...k }) => k),
  };
}

async function kpisLies(db: Db, planId: string): Promise<KpiLie[]> {
  const r = await db.query(
    `SELECT l.objectif_id, l.objectif_version, k.id, k.libelle, k.unite, k.perspective, k.frequence,
       k.actif, l.cree_le
     FROM plan_objectif_kpis l JOIN kpi_definitions k ON k.id = l.kpi_id
     WHERE l.plan_id = $1 ORDER BY l.cree_le, k.id`,
    [planId],
  );
  return r.rows as KpiLie[];
}

/** Objectifs du plan (retirés compris s'ils portent un KPI) et KPI qui en sont issus. */
export async function lireKpiObjectifs(db: Db, auth: Auth, planId: string) {
  await exigerPlanVisible(db, auth, planId);
  const kpis = await kpisLies(db, planId);
  const avecKpi = new Set(kpis.map((k) => k.objectif_id));
  const objectifs = (await elementsCourants(db, planId)).filter(
    (v) => v.type === "objectif" && (!v.retire || avecKpi.has(v.element_id)),
  );
  return { plan_id: planId, objectifs: objectifs.map((o) => vueObjectif(o, kpis)) };
}

/** Crée un KPI dans le module de pilotage à partir d'un objectif actif du plan. */
export async function creerKpiObjectif(
  db: Db,
  auth: Auth,
  planId: string,
  objectifId: string,
  corps: unknown,
) {
  const c = kpiCreationSchema.parse(corps);
  const plan = await exigerPlanRedigeable(db, auth, planId);
  const objectif = (await elementsCourants(db, planId)).find(
    (v) => v.element_id === objectifId.toLowerCase() && v.type === "objectif",
  );
  if (!objectif) throw introuvable("Objectif du plan");
  if (objectif.retire) throw conflit("Cet objectif est retiré du plan.");
  const perspectiveObjectif = (objectif.contenu as { perspective?: string }).perspective;
  const kpiId = await insererKpi(db, auth, plan.mission_id, c, {
    perspectiveParDefaut: PERSPECTIVES_PLAN.includes(perspectiveObjectif as PerspectivePlan)
      ? (perspectiveObjectif as PerspectivePlan)
      : null,
    detailsAudit: { plan_id: planId },
  });
  await db.query(
    `INSERT INTO plan_objectif_kpis (cabinet_id, plan_id, objectif_id, kpi_id, objectif_version,
       cree_par)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [auth.cabinetId, planId, objectif.element_id, kpiId, objectif.version, auth.utilisateurId],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "plan.objectif.kpi.creer",
    entite: "plan_element",
    entiteId: objectif.element_id,
    details: { plan_id: planId, kpi_id: kpiId, objectif_version: objectif.version },
  });
  const kpis = await kpisLies(db, planId);
  return vueObjectif(objectif, kpis);
}
