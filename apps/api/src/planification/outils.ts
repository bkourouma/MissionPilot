import {
  calculerDatesAuPlusTot,
  estPasValide,
  type DatesTache,
  type Dependance,
  type Granularite,
  type ParametresCalendrier,
  type TachePlanifiee,
} from "@missionpilot/engines";
import { AFFECTATIONS_MAX_PAR_TACHE } from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, conflit, requeteInvalide } from "../errors.js";
import {
  exigerMissionVisible,
  peutModifierMission,
  voitToutesLesMissions,
  type MissionAcces,
} from "../missions/acces.js";
import type { Decoupage } from "../missions/decoupage.js";

/** Mission vue par la planification : accès + date de fin. */
export type MissionPlanifiee = MissionAcces & { date_fin: string | null };

/**
 * Mission dont l'utilisateur peut gérer les affectations (PLN-04) : visible
 * (sinon 404, comme une mission d'un autre cabinet), et dont il est directeur
 * ou chef, ou dont il modifie toutes les missions, ou dont il voit toutes les
 * missions du cabinet (responsable des ressources, qui arbitre le staffing).
 * Un simple membre de l'équipe ne gère pas les affectations (403). Mission
 * clôturée : 409. La ligne de la mission est verrouillée pour la transaction.
 */
export async function exigerMissionAffectable(
  db: Db,
  auth: Auth,
  id: string,
): Promise<MissionPlanifiee> {
  const mission = await exigerMissionVisible(db, auth, id, true);
  if (!peutModifierMission(auth, mission) && !voitToutesLesMissions(auth)) {
    throw new AppError(403, "INTERDIT", "Vous n'avez pas le droit d'effectuer cette action.");
  }
  if (mission.statut === "cloturee") throw conflit("La mission est clôturée.");
  return { ...mission, date_fin: await dateFinMission(db, id) };
}

/**
 * Une affectation exige une mission datée (E1) : sans date de début, ni la
 * fenêtre de la tâche ni les bornes de la mission ne limitent la période.
 * 409 MISSION_SANS_DATES, comme la re-planification.
 */
export function exigerMissionDatee(mission: Pick<MissionAcces, "date_debut">): void {
  if (!mission.date_debut) {
    throw new AppError(
      409,
      "MISSION_SANS_DATES",
      "Renseigner la date de début de la mission avant d'y affecter quelqu'un.",
    );
  }
}

/**
 * Plafond d'affectations par tâche (F5) : 409 au-delà de
 * AFFECTATIONS_MAX_PAR_TACHE. `sauf` : affectation déplacée vers cette tâche
 * (déjà comptée si elle y est). La ligne de la mission est verrouillée par
 * l'appelant (exigerMissionAffectable) : pas de course entre deux créations.
 */
export async function exigerPlaceSurTache(db: Db, tacheId: string, sauf?: string): Promise<void> {
  const r = await db.query(
    "SELECT count(*)::int AS n FROM affectations WHERE tache_id = $1 AND ($2::uuid IS NULL OR id <> $2)",
    [tacheId, sauf ?? null],
  );
  if ((r.rows[0]?.n as number) >= AFFECTATIONS_MAX_PAR_TACHE) {
    throw new AppError(
      409,
      "TROP_D_AFFECTATIONS",
      `Une tâche porte au plus ${AFFECTATIONS_MAX_PAR_TACHE} affectations.`,
    );
  }
}

export async function dateFinMission(db: Db, id: string): Promise<string | null> {
  const r = await db.query("SELECT date_fin::text AS date_fin FROM missions WHERE id = $1", [id]);
  return (r.rows[0]?.date_fin as string | null | undefined) ?? null;
}

/** Granularité de saisie du cabinet (SOC-04) : pas des jours alloués. */
export async function parametresSaisie(
  db: Db,
  cabinetId: string,
): Promise<{ granularite: Granularite; heuresParJour: number }> {
  const r = await db.query(
    "SELECT unite_saisie_temps, heures_par_jour::float8 AS heures FROM cabinets WHERE id = $1",
    [cabinetId],
  );
  return {
    granularite: (r.rows[0]?.unite_saisie_temps as Granularite | undefined) ?? "demi_journee",
    heuresParJour: (r.rows[0]?.heures as number | undefined) ?? 8,
  };
}

/** Refuse des jours hors du pas du cabinet (demi-journée ou minute), via le moteur. */
export async function exigerPasDuCabinet(db: Db, cabinetId: string, jours: number): Promise<void> {
  const p = await parametresSaisie(db, cabinetId);
  if (!estPasValide(jours, p.granularite, p.heuresParJour)) {
    throw requeteInvalide(
      p.granularite === "demi_journee"
        ? "Les jours alloués se saisissent à la demi-journée (pas de 0,5)."
        : "Les jours alloués doivent correspondre à un nombre entier de minutes.",
    );
  }
}

/** Tâches et dépendances au format du moteur planning (début par défaut : celui de la mission). */
export function versMoteurPlanning(
  debutDefaut: string,
  d: Pick<Decoupage, "taches" | "dependances">,
): { taches: TachePlanifiee[]; dependances: Dependance[] } {
  return {
    taches: d.taches.map((t) => ({
      id: t.id as string,
      debut: (t.date_debut as string | null) ?? debutDefaut,
      dureeJoursOuvres: t.duree_jours_ouvres as number,
      phaseId: t.phase_id as string,
    })),
    dependances: d.dependances.map((x) => ({
      predecesseur: x.predecesseur_id as string,
      successeur: x.successeur_id as string,
      decalage: x.decalage as number,
    })),
  };
}

/**
 * Fenêtre planifiée d'une tâche (dates au plus tôt du moteur), ou null quand
 * le planning n'est pas ancré : sans date de début de mission, les dates
 * dépendraient du jour courant et ne peuvent pas servir de contrôle.
 */
export function fenetreTache(
  mission: Pick<MissionAcces, "date_debut">,
  d: Pick<Decoupage, "taches" | "dependances">,
  tacheId: string,
  calendrier: ParametresCalendrier,
): DatesTache | null {
  if (!mission.date_debut) return null;
  const { taches, dependances } = versMoteurPlanning(mission.date_debut, d);
  return calculerDatesAuPlusTot(taches, dependances, calendrier).get(tacheId) ?? null;
}

/** Période hors des bornes de la mission : 400 avec un message explicite. */
export function exigerDansMission(
  mission: { date_debut: string | null; date_fin: string | null },
  periode: { debut: string; fin: string },
): void {
  if (mission.date_debut && periode.debut < mission.date_debut) {
    throw requeteInvalide(`La période commence avant la mission (${mission.date_debut}).`);
  }
  if (mission.date_fin && periode.fin > mission.date_fin) {
    throw requeteInvalide(`La période se termine après la mission (${mission.date_fin}).`);
  }
}

export interface CollaborateurAffectable {
  id: string;
  nom: string;
  type: string;
  grade_id: string | null;
  utilisateur_id: string | null;
}

/**
 * Collaborateur actif du cabinet, dont l'utilisateur rattaché (s'il y en a un)
 * est actif ; sinon 400. Aucune donnée financière n'est lue.
 */
export async function collaborateurAffectable(
  db: Db,
  id: string,
): Promise<CollaborateurAffectable> {
  const r = await db.query(
    `SELECT c.id, c.nom, c.type, c.grade_id, c.utilisateur_id
     FROM collaborateurs c LEFT JOIN utilisateurs u ON u.id = c.utilisateur_id
     WHERE c.id = $1 AND c.actif AND (c.utilisateur_id IS NULL OR u.actif)`,
    [id],
  );
  if (!r.rows[0]) throw requeteInvalide("Collaborateur inconnu ou inactif dans ce cabinet.");
  return r.rows[0] as CollaborateurAffectable;
}

/** Collaborateur actif rattaché à l'utilisateur connecté, ou null. */
export async function collaborateurDe(
  db: Db,
  utilisateurId: string,
): Promise<{ id: string; nom: string; capacite_pct: number } | null> {
  const r = await db.query(
    "SELECT id, nom, capacite_pct FROM collaborateurs WHERE utilisateur_id = $1 AND actif",
    [utilisateurId],
  );
  return (r.rows[0] as { id: string; nom: string; capacite_pct: number } | undefined) ?? null;
}
