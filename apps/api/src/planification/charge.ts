import {
  ajouterJours,
  lundiDeLaSemaine,
  planDeCharge,
  semainesCouvrant,
  SEUILS_CHARGE_DEFAUT,
  type Absence,
  type Affectation,
  type LigneCharge,
  type Periode,
} from "@missionpilot/engines";
import {
  ecartJours,
  PLAN_DE_CHARGE_MAX_ECART_JOURS,
  PLAN_DE_CHARGE_MAX_SEMAINES,
} from "@missionpilot/shared";
import type { Db } from "../db/pool.js";
import { requeteInvalide } from "../errors.js";
import { aujourdhui, chargerCalendrier, nombre } from "../missions/outils.js";

/** Semaines servies par défaut quand la période n'est pas (entièrement) donnée. */
const SEMAINES_PAR_DEFAUT = 12;

const MESSAGE_TROP_DE_SEMAINES = `Le plan de charge couvre ${PLAN_DE_CHARGE_MAX_SEMAINES} semaines au plus par requête.`;

/**
 * Période du plan de charge : ISO-semaines complètes, 26 au plus (refus 400
 * au-delà, plutôt qu'une troncature silencieuse). L'écart en jours est
 * vérifié AVANT de construire les semaines (M2) : une période de l'an 1 à
 * l'an 9999 est refusée sans rien calculer.
 */
export function periodeDuPlan(debut?: string, fin?: string): Periode {
  const d = lundiDeLaSemaine(
    debut ?? (fin ? ajouterJours(fin, -(SEMAINES_PAR_DEFAUT * 7 - 1)) : aujourdhui()),
  );
  const f = fin ?? ajouterJours(d, SEMAINES_PAR_DEFAUT * 7 - 1);
  const ecart = ecartJours(d, f);
  if (!Number.isFinite(ecart) || ecart > PLAN_DE_CHARGE_MAX_ECART_JOURS) {
    throw requeteInvalide(MESSAGE_TROP_DE_SEMAINES);
  }
  const semaines = semainesCouvrant({ debut: d, fin: f });
  if (semaines.length > PLAN_DE_CHARGE_MAX_SEMAINES) {
    throw requeteInvalide(MESSAGE_TROP_DE_SEMAINES);
  }
  const derniere = semaines[semaines.length - 1] as Periode;
  return { debut: d, fin: derniere.fin };
}

export interface CollaborateurPlan {
  id: string;
  nom: string;
  capacite_pct: number;
}

/** Affectations nominatives (format moteur) des collaborateurs, qui chevauchent la période. */
export async function affectationsDe(
  db: Db,
  ids: readonly string[],
  periode: Periode,
): Promise<Affectation[]> {
  if (ids.length === 0) return [];
  const r = await db.query(
    `SELECT id, collaborateur_id, tache_id, jours_alloues::text AS jours,
       date_debut::text AS debut, date_fin::text AS fin
     FROM affectations
     WHERE collaborateur_id = ANY ($1::uuid[]) AND date_debut <= $3 AND date_fin >= $2`,
    [ids, periode.debut, periode.fin],
  );
  return r.rows.map((a) => ({
    id: a.id as string,
    personneId: a.collaborateur_id as string,
    tacheId: a.tache_id as string,
    joursAlloues: nombre(a.jours),
    debut: a.debut as string,
    fin: a.fin as string,
  }));
}

/** Absences VALIDÉES des collaborateurs qui chevauchent la période (jours entiers). */
export async function absencesValidees(
  db: Db,
  ids: readonly string[],
  periode: Periode,
): Promise<Map<string, Absence[]>> {
  const parCollaborateur = new Map<string, Absence[]>();
  if (ids.length === 0) return parCollaborateur;
  const r = await db.query(
    `SELECT collaborateur_id, date_debut::text AS debut, date_fin::text AS fin FROM absences
     WHERE collaborateur_id = ANY ($1::uuid[]) AND statut = 'validee'
       AND date_debut <= $3 AND date_fin >= $2`,
    [ids, periode.debut, periode.fin],
  );
  for (const a of r.rows) {
    const id = a.collaborateur_id as string;
    parCollaborateur.set(id, [...(parCollaborateur.get(id) ?? []), { debut: a.debut, fin: a.fin }]);
  }
  return parCollaborateur;
}

/**
 * Grille collaborateurs × semaines (PLN-06), entièrement calculée par le
 * moteur : capacité = jours ouvrés du calendrier du cabinet (jours travaillés
 * et fériés) − absences validées, × capacité % ; jours affectés répartis au
 * prorata des jours ouvrés de chaque affectation ; taux et état de charge.
 */
export async function calculerPlan(
  db: Db,
  cabinetId: string,
  collaborateurs: readonly CollaborateurPlan[],
  periode: Periode,
): Promise<LigneCharge[]> {
  const ids = collaborateurs.map((c) => c.id);
  const calendrier = await chargerCalendrier(db, cabinetId);
  const absences = await absencesValidees(db, ids, periode);
  return planDeCharge({
    collaborateurs: collaborateurs.map((c) => ({
      id: c.id,
      tempsTravailPct: c.capacite_pct,
      absences: absences.get(c.id) ?? [],
    })),
    affectations: await affectationsDe(db, ids, periode),
    periode,
    calendrier,
    seuils: SEUILS_CHARGE_DEFAUT,
  });
}
