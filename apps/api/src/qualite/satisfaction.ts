import { syntheseNps, type SyntheseNps } from "@missionpilot/engines";
import { satisfactionSchema, type satisfactionSyntheseQuerySchema } from "@missionpilot/shared";
import type { z } from "zod";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError } from "../errors.js";
import { exigerMissionVisible } from "../missions/acces.js";

/*
 * Satisfaction du client (QUA-08) : une note de recommandation de 0 à 10 par jalon et à la
 * clôture, saisie par le cabinet pour le compte du client. Ajout seul : une correction est une
 * nouvelle ligne de même clé et de rang supérieur ; la dernière fait foi. L'agrégat NPS est
 * calculé par `syntheseNps` ; celui du cabinet n'est servi qu'à l'associé.
 */

export interface NoteSatisfaction {
  id: string;
  mission_id: string;
  moment: string;
  jalon_id: string | null;
  jalon_libelle: string | null;
  cle: string;
  rang: number;
  note: number;
  commentaire: string | null;
  repondant: string | null;
  saisi_par: string;
  saisi_le: Date;
}

const COLONNES = `s.id, s.mission_id, s.moment, s.jalon_id, j.libelle AS jalon_libelle, s.cle, s.rang,
  s.note, s.commentaire, s.repondant, s.saisi_par, s.saisi_le`;

/** Notes en vigueur d'une mission (dernier rang de chaque clé). */
async function notesEnVigueur(db: Db, missionId: string): Promise<NoteSatisfaction[]> {
  const r = await db.query(
    `SELECT ${COLONNES} FROM (
       SELECT DISTINCT ON (cle) * FROM qualite_satisfactions WHERE mission_id = $1 ORDER BY cle, rang DESC
     ) s LEFT JOIN mission_jalons j ON j.id = s.jalon_id
     ORDER BY s.saisi_le, s.id`,
    [missionId],
  );
  return r.rows as NoteSatisfaction[];
}

export async function lireSatisfactions(
  db: Db,
  auth: Auth,
  missionId: string,
): Promise<{ notes: NoteSatisfaction[]; synthese: SyntheseNps }> {
  await exigerMissionVisible(db, auth, missionId);
  const notes = await notesEnVigueur(db, missionId);
  return { notes, synthese: syntheseNps(notes.map((n) => n.note)) };
}

export async function saisirSatisfaction(
  db: Db,
  auth: Auth,
  missionId: string,
  brut: unknown,
): Promise<{ notes: NoteSatisfaction[]; synthese: SyntheseNps }> {
  const c = satisfactionSchema.parse(brut);
  const mission = await exigerMissionVisible(db, auth, missionId, true);
  if (c.moment === "cloture" && mission.statut !== "a_cloturer" && mission.statut !== "cloturee") {
    throw new AppError(
      409,
      "CLOTURE_NON_ATTEINTE",
      "La satisfaction de clôture se recueille quand la mission est à clôturer ou clôturée.",
    );
  }
  const cle = c.moment === "cloture" ? "cloture" : (c.jalon_id as string);
  const rang = await db.query(
    "SELECT COALESCE(MAX(rang), 0) + 1 AS rang FROM qualite_satisfactions WHERE mission_id = $1 AND cle = $2",
    [missionId, cle],
  );
  const r = await db.query(
    `INSERT INTO qualite_satisfactions
       (cabinet_id, mission_id, moment, jalon_id, cle, rang, note, commentaire, repondant, saisi_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [
      auth.cabinetId,
      missionId,
      c.moment,
      c.jalon_id ?? null,
      cle,
      rang.rows[0].rang,
      c.note,
      c.commentaire ?? null,
      c.repondant ?? null,
      auth.utilisateurId,
    ],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "qualite.satisfaction.saisir",
    entite: "mission",
    entiteId: missionId,
    details: { satisfaction_id: r.rows[0].id, moment: c.moment, rang: rang.rows[0].rang },
  });
  const notes = await notesEnVigueur(db, missionId);
  return { notes, synthese: syntheseNps(notes.map((n) => n.note)) };
}

export interface SyntheseCabinet {
  synthese: SyntheseNps;
  missions: (SyntheseNps & { mission_id: string; mission_intitule: string })[];
  tronque: boolean;
}

/** NPS du cabinet et par mission (réservé à l'associé par la route). Notes en vigueur seulement. */
export async function syntheseSatisfactionCabinet(
  db: Db,
  requete: z.infer<typeof satisfactionSyntheseQuerySchema>,
): Promise<SyntheseCabinet> {
  const r = await db.query(
    `SELECT s.mission_id, m.intitule, s.note FROM (
       SELECT DISTINCT ON (mission_id, cle) mission_id, note, saisi_le
       FROM qualite_satisfactions ORDER BY mission_id, cle, rang DESC
     ) s JOIN missions m ON m.id = s.mission_id
     WHERE ($1::date IS NULL OR s.saisi_le >= $1::date)
     ORDER BY lower(m.intitule), s.mission_id`,
    [requete.depuis ?? null],
  );
  const parMission = new Map<string, { intitule: string; notes: number[] }>();
  for (const l of r.rows as { mission_id: string; intitule: string; note: number }[]) {
    const m = parMission.get(l.mission_id) ?? { intitule: l.intitule, notes: [] };
    m.notes.push(l.note);
    parMission.set(l.mission_id, m);
  }
  const missions = [...parMission].map(([mission_id, m]) => ({
    mission_id,
    mission_intitule: m.intitule,
    ...syntheseNps(m.notes),
  }));
  return {
    synthese: syntheseNps((r.rows as { note: number }[]).map((l) => l.note)),
    missions: missions.slice(0, requete.limite),
    tronque: missions.length > requete.limite,
  };
}
