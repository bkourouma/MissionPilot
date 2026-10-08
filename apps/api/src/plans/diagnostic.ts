import { forcesEtFaiblesses } from "@missionpilot/engines";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, conflit, introuvable } from "../errors.js";
import { filtreVisibilite, voitToutesLesMissions } from "../missions/acces.js";
import { chargerVersion } from "../notation/notations.js";
import { exigerPlanRedigeable, exigerPlanVisible, type PlanAcces } from "./acces.js";
import { retirerPartageApresEcriture } from "./partage.js";

/*
 * Diagnostic du plan : lien vers une notation PUBLIÉE (service #1, PLA-02 ;
 * table `plan_diagnostic_notations`, 0182, ajout seul).
 *
 * - Lire le lien et choisir une notation : « plan.lire » ET « notation.lire »
 *   (routes/plans.ts). Seules les notations du CLIENT du plan, dont la
 *   mission est visible par l'utilisateur, sont proposées ; une version
 *   liée dont la mission n'est plus visible n'expose que la date du lien.
 * - Lier ou délier : « plan.ecrire » ET « notation.lire », plan rédigeable.
 *   La version doit être publiée (409 NOTATION_NON_PUBLIEE, doublé en base,
 *   MPS06) ; une notation invisible répond 404 comme une inexistante. Le
 *   changement de lien retire le partage d'un plan partagé.
 * - Chiffres : score, classe, points forts et faibles sortent du moteur de
 *   notation (score ajusté rejoué par `chargerVersion`, `forcesEtFaiblesses`).
 */

/** Notations publiées proposées au choix (les plus récentes d'abord). */
export const NOTATIONS_PROPOSEES_MAX = 20;

interface LigneLien {
  rang: number;
  notation_version_id: string | null;
  lie_par: string;
  lie_par_nom: string;
  lie_le: string;
}

interface VersionPubliee {
  version_id: string;
  notation_id: string;
  numero: number;
  mission_id: string;
  mission_intitule: string;
  publiee_le: string | null;
}

/** Version publiée d'une notation du client du plan, mission visible, sinon null. */
async function versionPublieeVisible(
  db: Db,
  auth: Auth,
  plan: PlanAcces,
  versionId: string,
): Promise<VersionPubliee | null> {
  const r = await db.query(
    `SELECT v.id AS version_id, v.notation_id, v.numero, m.id AS mission_id,
       m.intitule AS mission_intitule,
       (SELECT e.le FROM notation_evenements e
        WHERE e.version_id = v.id AND e.action = 'publication') AS publiee_le
     FROM notation_versions v
     JOIN notations n ON n.id = v.notation_id
     JOIN missions m ON m.id = n.mission_id
     WHERE v.id = $1 AND n.client_id = $2 AND ${filtreVisibilite(3, 4)}`,
    [versionId, plan.client_id, voitToutesLesMissions(auth), auth.utilisateurId],
  );
  return (r.rows[0] as VersionPubliee | undefined) ?? null;
}

/** Score ajusté (moteur), classe, points forts et faibles d'une version publiée. */
async function resumeVersion(db: Db, v: VersionPubliee) {
  const chargee = await chargerVersion(db, v.notation_id, v.numero);
  if (!chargee || chargee.statut !== "publiee") return null;
  const { forces, faiblesses } = forcesEtFaiblesses(chargee.etat);
  return {
    notation_id: v.notation_id,
    version_id: v.version_id,
    numero: v.numero,
    mission_id: v.mission_id,
    mission_intitule: v.mission_intitule,
    publiee_le: v.publiee_le,
    score: chargee.etat.score,
    classe: chargee.etat.classe,
    notable: chargee.etat.notable,
    forces,
    faiblesses,
  };
}

async function lienCourant(db: Db, planId: string): Promise<LigneLien | null> {
  const r = await db.query(
    `SELECT l.rang, l.notation_version_id, l.lie_par, u.nom AS lie_par_nom, l.lie_le
     FROM plan_diagnostic_notations l JOIN utilisateurs u ON u.id = l.lie_par
     WHERE l.plan_id = $1 ORDER BY l.rang DESC LIMIT 1`,
    [planId],
  );
  return (r.rows[0] as LigneLien | undefined) ?? null;
}

async function vueLien(db: Db, auth: Auth, plan: PlanAcces) {
  const lien = await lienCourant(db, plan.id);
  if (!lien?.notation_version_id) {
    return { plan_id: plan.id, lien: null, modifie_le: lien?.lie_le ?? null };
  }
  const v = await versionPublieeVisible(db, auth, plan, lien.notation_version_id);
  const notation = v ? await resumeVersion(db, v) : null;
  return {
    plan_id: plan.id,
    lien: {
      lie_par: { id: lien.lie_par, nom: lien.lie_par_nom },
      lie_le: lien.lie_le,
      accessible: notation !== null,
      notation,
    },
    modifie_le: lien.lie_le,
  };
}

/** Lien courant du diagnostic vers une notation publiée (ou null). */
export async function lireLienNotation(db: Db, auth: Auth, planId: string) {
  const plan = await exigerPlanVisible(db, auth, planId);
  return vueLien(db, auth, plan);
}

/** Versions publiées des notations du client du plan (missions visibles), à lier au diagnostic. */
export async function listerNotationsPubliees(db: Db, auth: Auth, planId: string) {
  const plan = await exigerPlanVisible(db, auth, planId);
  const r = await db.query(
    `SELECT v.id AS version_id, v.notation_id, v.numero, m.id AS mission_id,
       m.intitule AS mission_intitule, e.le AS publiee_le
     FROM notation_versions v
     JOIN notation_evenements e ON e.version_id = v.id AND e.action = 'publication'
     JOIN notations n ON n.id = v.notation_id
     JOIN missions m ON m.id = n.mission_id
     WHERE n.client_id = $1 AND ${filtreVisibilite(2, 3)}
     ORDER BY e.le DESC, v.id LIMIT $4`,
    [plan.client_id, voitToutesLesMissions(auth), auth.utilisateurId, NOTATIONS_PROPOSEES_MAX],
  );
  const elements = [];
  for (const v of r.rows as VersionPubliee[]) {
    const resume = await resumeVersion(db, v);
    if (resume) elements.push(resume);
  }
  return { plan_id: plan.id, elements };
}

/** Lie le diagnostic à une version publiée (ou retire le lien avec null). */
export async function lierNotation(db: Db, auth: Auth, planId: string, versionId: string | null) {
  const plan = await exigerPlanRedigeable(db, auth, planId);
  const courant = await lienCourant(db, planId);
  const cible = versionId?.toLowerCase() ?? null;
  if ((courant?.notation_version_id ?? null) === cible) {
    throw conflit(cible ? "Cette notation est déjà liée au diagnostic." : "Aucune notation liée.");
  }
  if (cible) {
    const v = await versionPublieeVisible(db, auth, plan, cible);
    if (!v) throw introuvable("Notation");
    if (!v.publiee_le) {
      throw new AppError(
        409,
        "NOTATION_NON_PUBLIEE",
        "Seule une notation publiée du même client se lie au diagnostic du plan.",
      );
    }
  }
  await db.query(
    `INSERT INTO plan_diagnostic_notations (cabinet_id, plan_id, rang, notation_version_id, lie_par)
     VALUES ($1, $2, $3, $4, $5)`,
    [auth.cabinetId, planId, (courant?.rang ?? 0) + 1, cible, auth.utilisateurId],
  );
  await retirerPartageApresEcriture(db, auth, plan, "diagnostic.notation");
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: cible ? "plan.diagnostic.lier_notation" : "plan.diagnostic.delier_notation",
    entite: "plan_strategique",
    entiteId: planId,
    details: { notation_version_id: cible, avant: courant?.notation_version_id ?? null },
  });
  return vueLien(db, auth, plan);
}
