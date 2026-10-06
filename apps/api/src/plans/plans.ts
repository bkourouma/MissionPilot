import type { PlanCreation } from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { conflit } from "../errors.js";
import { decoderCurseur, paginer } from "../http/outils.js";
import { exigerMissionModifiable, exigerMissionVisible } from "../missions/acces.js";
import { COLONNES_PLAN, exigerPlanPilotable, exigerPlanVisible, type PlanAcces } from "./acces.js";
import { elementsCourants, vueElement, type ElementCourant } from "./elements.js";
import { derniereVersionModele } from "./modele.js";

/*
 * Plans stratégiques d'une mission (PLA-01). Horizon (3 à 5 ans, 5 par
 * défaut) et devise fixés à la création. Rien n'est partagé au client par
 * défaut ; le partage exige tout le contenu validé (déclencheur 0181).
 */

type LignePlan = Omit<PlanAcces, "mission_statut" | "directeur_id" | "chef_id" | "client_id">;

export function vuePlan(p: LignePlan) {
  return {
    id: p.id,
    mission_id: p.mission_id,
    titre: p.titre,
    horizon: p.horizon,
    devise: p.devise,
    partage_client: p.partage_client,
    partage_par: p.partage_par,
    partage_le: p.partage_le,
    cree_par: p.cree_par,
    cree_le: p.cree_le,
  };
}

export async function creerPlan(db: Db, auth: Auth, missionId: string, corps: PlanCreation) {
  await exigerMissionModifiable(db, auth, missionId);
  const r = await db.query(
    `INSERT INTO plans_strategiques (cabinet_id, mission_id, titre, horizon, devise, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [auth.cabinetId, missionId, corps.titre, corps.horizon, corps.devise, auth.utilisateurId],
  );
  const id = r.rows[0].id as string;
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "plan.creer",
    entite: "plan_strategique",
    entiteId: id,
    details: { mission_id: missionId, horizon: corps.horizon, devise: corps.devise },
  });
  return vuePlan(await exigerPlanVisible(db, auth, id));
}

export async function listerPlans(
  db: Db,
  auth: Auth,
  missionId: string,
  q: { limite: number; curseur?: string | undefined },
) {
  await exigerMissionVisible(db, auth, missionId);
  const apres = decoderCurseur(q.curseur);
  const r = await db.query(
    `SELECT lpad(((extract(epoch FROM p.cree_le) * 1000000)::bigint)::text, 17, '0') AS cle_tri,
       ${COLONNES_PLAN}
     FROM plans_strategiques p
     WHERE p.mission_id = $1
       AND ($2::text IS NULL OR (lpad(((extract(epoch FROM p.cree_le) * 1000000)::bigint)::text, 17, '0'), p.id)
            > ($2, $3::uuid))
     ORDER BY p.cree_le, p.id LIMIT $4`,
    [missionId, apres?.[0] ?? null, apres?.[1] ?? null, q.limite + 1],
  );
  const page = paginer(r.rows as (LignePlan & { cle_tri: string })[], q.limite);
  return { elements: page.elements.map(vuePlan), curseur_suivant: page.curseur_suivant };
}

/** Vrai si la version courante de chaque élément est validée (et qu'il y en a au moins un). */
export function contenuValide(elements: readonly ElementCourant[]): boolean {
  return elements.length > 0 && elements.every((e) => e.statut_contenu === "valide");
}

/** Plan, version courante de ses éléments et dernière version de son modèle financier. */
export async function lirePlan(db: Db, auth: Auth, id: string) {
  const plan = await exigerPlanVisible(db, auth, id);
  const elements = (await elementsCourants(db, id)).map(vueElement);
  const modele = await derniereVersionModele(db, id);
  return {
    ...vuePlan(plan),
    client_id: plan.client_id,
    elements,
    modele,
    pret_pour_client: contenuValide(elements) && (modele === null || modele.validation !== null),
  };
}

/** Partage (ou retire le partage) du plan au client : responsable de la mission, contenu validé. */
export async function partagerPlan(db: Db, auth: Auth, id: string, partage: boolean) {
  const plan = await exigerPlanPilotable(db, auth, id);
  if (plan.partage_client === partage) {
    throw conflit(partage ? "Le plan est déjà partagé." : "Le plan n'est pas partagé.");
  }
  await db.query(
    `UPDATE plans_strategiques
     SET partage_client = $2, partage_par = $3, partage_le = CASE WHEN $2 THEN now() END
     WHERE id = $1`,
    [id, partage, partage ? auth.utilisateurId : null],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: partage ? "plan.partager" : "plan.retirer_partage",
    entite: "plan_strategique",
    entiteId: id,
  });
  return vuePlan(await exigerPlanVisible(db, auth, id));
}
