import {
  calculerEfficaciteInitiative,
  EFFICACITE_SEUIL_OBSERVATIONS_PAR_DEFAUT,
  scoresParContexte,
  type MesureBruteEfficacite,
  type ObservationEfficaciteRecommandation,
  type SensEfficacite,
} from "@missionpilot/engines";
import type {
  efficaciteAbandonSchema,
  efficaciteListeQuerySchema,
  efficaciteMiseEnOeuvreSchema,
  efficaciteRecommandationCreationSchema,
  efficaciteScoresQuerySchema,
} from "@missionpilot/shared";
import type { z } from "zod";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, interdit, introuvable } from "../errors.js";
import {
  exigerMissionVisible,
  filtreVisibilite,
  voitToutesLesMissions,
} from "../missions/acces.js";
import { estResponsableMission } from "./retours.js";

/*
 * Efficacité des recommandations (CAP-03). Lecture : `connaissance.lire` ; le détail et le libellé
 * d'une recommandation exigent en plus une mission visible (sinon libellé et mission masqués dans
 * la liste, 404 sur le détail). Écriture : `mission.planifier`, `plan.lire` et `kpi.lire` (vérifiés
 * par la route) ET responsable de la mission. Tout chiffre sort du moteur ; le plan et les KPI ne
 * sont que LUS. L'IA n'intervient pas. Chaque écriture est journalisée.
 */

type Creation = z.infer<typeof efficaciteRecommandationCreationSchema>;

function visibilite(auth: Auth) {
  return {
    sql: `(${filtreVisibilite(1, 2)})`,
    params: [voitToutesLesMissions(auth), auth.utilisateurId],
  };
}

async function dernierInstantane(db: Db, id: string) {
  const r = await db.query(
    `SELECT id, evaluable, score, raison_code, raison, delai_effet_jours,
            base_date::text AS base_date, base_valeur::text AS base_valeur,
            effet_date::text AS effet_date, effet_valeur::text AS effet_valeur,
            cible::text AS cible, ecart_attendu::text AS ecart_attendu,
            ecart_realise::text AS ecart_realise, part_comblee_pour_mille,
            calcule_le::text AS calcule_le
     FROM cap_efficacite_mesures WHERE recommandation_id = $1
     ORDER BY calcule_le DESC, id DESC LIMIT 1`,
    [id],
  );
  return r.rows[0] ?? null;
}

/** Recommandation + mission (verrou facultatif), mission visible exigée (404 sinon). */
async function chargerRecommandation(db: Db, auth: Auth, id: string, verrouiller = false) {
  const r = await db.query(
    `SELECT r.id, r.mission_id, r.kpi_id, r.plan_initiative_id, r.libelle, r.type_initiative,
            r.secteur, r.taille, r.valeur_cible::text AS valeur_cible, r.statut,
            r.mise_en_oeuvre_le::text AS mise_en_oeuvre_le, r.cree_par, r.cree_le::text AS cree_le
     FROM cap_recommandations r WHERE r.id = $1 ${verrouiller ? "FOR UPDATE" : ""}`,
    [id],
  );
  const rec = r.rows[0] as
    | {
        id: string;
        mission_id: string;
        kpi_id: string;
        statut: string;
        valeur_cible: string;
        mise_en_oeuvre_le: string | null;
        [k: string]: unknown;
      }
    | undefined;
  if (!rec) throw introuvable("Recommandation");
  const mission = await exigerMissionVisible(db, auth, rec.mission_id);
  return { rec, mission };
}

async function exigerResponsable(db: Db, auth: Auth, id: string) {
  const c = await chargerRecommandation(db, auth, id, true);
  if (!estResponsableMission(auth, c.mission)) throw interdit();
  return c;
}

export async function creerRecommandation(db: Db, auth: Auth, corps: Creation) {
  const mission = await exigerMissionVisible(db, auth, corps.mission_id, true);
  if (!estResponsableMission(auth, mission)) throw interdit();
  const kpi = await db.query(`SELECT id FROM kpi_definitions WHERE id = $1 AND mission_id = $2`, [
    corps.kpi_id,
    corps.mission_id,
  ]);
  if (!kpi.rows[0]) throw introuvable("KPI");
  if (corps.plan_initiative_id) {
    const i = await db.query(
      `SELECT e.id FROM plan_elements e JOIN plans_strategiques p ON p.id = e.plan_id
       WHERE e.id = $1 AND e.type = 'initiative' AND p.mission_id = $2`,
      [corps.plan_initiative_id, corps.mission_id],
    );
    if (!i.rows[0]) throw introuvable("Initiative du plan");
  }
  const client = await db.query(`SELECT secteur, taille FROM clients WHERE id = $1`, [
    mission.client_id,
  ]);
  const ctx = client.rows[0] ?? { secteur: null, taille: null };
  const r = await db.query(
    `INSERT INTO cap_recommandations (cabinet_id, mission_id, kpi_id, plan_initiative_id, libelle,
       type_initiative, secteur, taille, valeur_cible, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [
      auth.cabinetId,
      corps.mission_id,
      corps.kpi_id,
      corps.plan_initiative_id ?? null,
      corps.libelle,
      corps.type_initiative,
      ctx.secteur ? String(ctx.secteur).slice(0, 120) : null,
      ctx.taille ?? null,
      corps.valeur_cible,
      auth.utilisateurId,
    ],
  );
  const id = r.rows[0].id as string;
  await db.query(
    `INSERT INTO cap_recommandation_statuts (cabinet_id, recommandation_id, statut, par)
     VALUES ($1, $2, 'recommandee', $3)`,
    [auth.cabinetId, id, auth.utilisateurId],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "capitalisation.efficacite.recommander",
    entite: "cap_recommandation",
    entiteId: id,
    details: { mission_id: corps.mission_id, kpi_id: corps.kpi_id },
  });
  return lireRecommandation(db, auth, id);
}

async function exigerAujourdhui(db: Db, date: string) {
  const r = await db.query(`SELECT $1::date > current_date AS futur`, [date]);
  if (r.rows[0].futur) {
    throw new AppError(
      400,
      "DATE_FUTURE",
      "La date de mise en oeuvre ne peut pas être dans le futur.",
    );
  }
}

export async function mettreEnOeuvre(
  db: Db,
  auth: Auth,
  id: string,
  corps: z.infer<typeof efficaciteMiseEnOeuvreSchema>,
) {
  const { rec } = await exigerResponsable(db, auth, id);
  if (rec.statut !== "recommandee") {
    throw new AppError(409, "TRANSITION_INTERDITE", "Cette recommandation est déjà décidée.");
  }
  await exigerAujourdhui(db, corps.mise_en_oeuvre_le);
  await db.query(
    `UPDATE cap_recommandations SET statut = 'mise_en_oeuvre', mise_en_oeuvre_le = $2 WHERE id = $1`,
    [id, corps.mise_en_oeuvre_le],
  );
  await db.query(
    `INSERT INTO cap_recommandation_statuts (cabinet_id, recommandation_id, statut,
       mise_en_oeuvre_le, par) VALUES ($1, $2, 'mise_en_oeuvre', $3, $4)`,
    [auth.cabinetId, id, corps.mise_en_oeuvre_le, auth.utilisateurId],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "capitalisation.efficacite.mettre_en_oeuvre",
    entite: "cap_recommandation",
    entiteId: id,
    details: { mise_en_oeuvre_le: corps.mise_en_oeuvre_le },
  });
  return lireRecommandation(db, auth, id);
}

export async function abandonner(
  db: Db,
  auth: Auth,
  id: string,
  corps: z.infer<typeof efficaciteAbandonSchema>,
) {
  const { rec } = await exigerResponsable(db, auth, id);
  if (rec.statut !== "recommandee") {
    throw new AppError(409, "TRANSITION_INTERDITE", "Cette recommandation est déjà décidée.");
  }
  await db.query(`UPDATE cap_recommandations SET statut = 'abandonnee' WHERE id = $1`, [id]);
  await db.query(
    `INSERT INTO cap_recommandation_statuts (cabinet_id, recommandation_id, statut, motif, par)
     VALUES ($1, $2, 'abandonnee', $3, $4)`,
    [auth.cabinetId, id, corps.motif, auth.utilisateurId],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "capitalisation.efficacite.abandonner",
    entite: "cap_recommandation",
    entiteId: id,
    details: {},
  });
  return lireRecommandation(db, auth, id);
}

/** « Mesurer l'effet » : instantané calculé par le moteur, ajouté à l'historique. */
export async function mesurerEffet(db: Db, auth: Auth, id: string) {
  const { rec } = await exigerResponsable(db, auth, id);
  if (rec.statut !== "mise_en_oeuvre" || !rec.mise_en_oeuvre_le) {
    throw new AppError(
      409,
      "NON_MISE_EN_OEUVRE",
      "L'effet ne se mesure que pour une recommandation mise en oeuvre.",
    );
  }
  const k = await db.query(`SELECT sens FROM kpi_definitions WHERE id = $1`, [rec.kpi_id]);
  if (!k.rows[0]) throw introuvable("KPI");
  const m = await db.query(
    `SELECT id, date_mesure::text AS date_mesure, valeur::text AS valeur, annulation, remplace_id
     FROM kpi_mesures WHERE kpi_id = $1 ORDER BY date_mesure, numero`,
    [rec.kpi_id],
  );
  const resultat = calculerEfficaciteInitiative({
    sens: k.rows[0].sens as SensEfficacite,
    mise_en_oeuvre_le: rec.mise_en_oeuvre_le,
    valeur_cible: rec.valeur_cible,
    mesures: m.rows as MesureBruteEfficacite[],
  });
  const i = await db.query(
    `INSERT INTO cap_efficacite_mesures (cabinet_id, recommandation_id, evaluable, score,
       raison_code, raison, delai_effet_jours, base_date, base_valeur, effet_date, effet_valeur,
       cible, ecart_attendu, ecart_realise, part_comblee_pour_mille, resultat, calcule_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     RETURNING id`,
    [
      auth.cabinetId,
      id,
      resultat.evaluable,
      resultat.score,
      resultat.raison_code,
      resultat.raison,
      resultat.delai_effet_jours,
      resultat.base?.date_mesure ?? null,
      resultat.base?.valeur ?? null,
      resultat.effet?.date_mesure ?? null,
      resultat.effet?.valeur ?? null,
      resultat.cible,
      resultat.ecart_attendu,
      resultat.ecart_realise,
      resultat.part_comblee_pour_mille,
      JSON.stringify(resultat),
      auth.utilisateurId,
    ],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "capitalisation.efficacite.mesurer",
    entite: "cap_recommandation",
    entiteId: id,
    details: { instantane_id: i.rows[0].id, evaluable: resultat.evaluable, score: resultat.score },
  });
  return { recommandation_id: id, resultat };
}

export async function lireRecommandation(db: Db, auth: Auth, id: string) {
  const { rec, mission } = await chargerRecommandation(db, auth, id);
  const historique = await db.query(
    `SELECT s.statut, s.mise_en_oeuvre_le::text AS mise_en_oeuvre_le, s.motif, s.le::text AS le,
            u.nom AS par_nom
     FROM cap_recommandation_statuts s LEFT JOIN utilisateurs u ON u.id = s.par
     WHERE s.recommandation_id = $1 ORDER BY s.le, s.id`,
    [id],
  );
  const instantanes = await db.query(
    `SELECT id, evaluable, score, raison, base_date::text AS base_date,
            base_valeur::text AS base_valeur, effet_date::text AS effet_date,
            effet_valeur::text AS effet_valeur, cible::text AS cible,
            part_comblee_pour_mille, calcule_le::text AS calcule_le
     FROM cap_efficacite_mesures WHERE recommandation_id = $1
     ORDER BY calcule_le DESC, id DESC LIMIT 50`,
    [id],
  );
  return {
    ...rec,
    cree_par: undefined,
    client_id: undefined,
    peut_agir: estResponsableMission(auth, mission),
    historique: historique.rows,
    instantanes: instantanes.rows,
    dernier_instantane: await dernierInstantane(db, id),
  };
}

export async function listerRecommandations(
  db: Db,
  auth: Auth,
  q: z.infer<typeof efficaciteListeQuerySchema>,
) {
  const v = visibilite(auth);
  const r = await db.query(
    `SELECT r.id, r.statut, r.cree_le::text AS cree_le,
            r.mise_en_oeuvre_le::text AS mise_en_oeuvre_le, ${v.sql} AS visible,
            CASE WHEN ${v.sql} THEN r.type_initiative END AS type_initiative,
            CASE WHEN ${v.sql} THEN r.secteur END AS secteur,
            CASE WHEN ${v.sql} THEN r.taille END AS taille,
            CASE WHEN ${v.sql} THEN r.libelle END AS libelle,
            CASE WHEN ${v.sql} THEN r.mission_id END AS mission_id,
            CASE WHEN ${v.sql} THEN m.intitule END AS mission_intitule,
            CASE WHEN ${v.sql} THEN d.score END AS score,
            CASE WHEN ${v.sql} THEN d.evaluable END AS evaluable,
            CASE WHEN ${v.sql} THEN d.raison END AS raison,
            d.calcule_le::text AS mesure_le
     FROM cap_recommandations r JOIN missions m ON m.id = r.mission_id
     LEFT JOIN LATERAL (
       SELECT x.score, x.evaluable, x.raison, x.calcule_le FROM cap_efficacite_mesures x
       WHERE x.recommandation_id = r.id ORDER BY x.calcule_le DESC, x.id DESC LIMIT 1) d ON true
     WHERE ($3::uuid IS NULL OR (r.mission_id = $3 AND ${v.sql}))
       AND ($4::text IS NULL OR r.statut = $4)
     ORDER BY r.cree_le DESC, r.id DESC LIMIT $5`,
    [...v.params, q.mission_id ?? null, q.statut ?? null, q.limite],
  );
  return { elements: r.rows };
}

/** Scores par contexte : agrégats du cabinet, sans nom de client ni de mission. */
export async function scoresEfficacite(db: Db, q: z.infer<typeof efficaciteScoresQuerySchema>) {
  const r = await db.query(
    `SELECT r.type_initiative, r.secteur, r.taille, d.score
     FROM cap_recommandations r
     LEFT JOIN LATERAL (
       SELECT x.score FROM cap_efficacite_mesures x WHERE x.recommandation_id = r.id
       ORDER BY x.calcule_le DESC, x.id DESC LIMIT 1) d ON true
     WHERE r.statut = 'mise_en_oeuvre'`,
  );
  const observations = r.rows.map((l) => ({
    score: l.score === null ? null : Number(l.score),
    type_initiative: l.type_initiative as string,
    secteur: (l.secteur as string | null) ?? null,
    taille: (l.taille as string | null) ?? null,
  })) satisfies ObservationEfficaciteRecommandation[];
  const seuil = q.seuil ?? EFFICACITE_SEUIL_OBSERVATIONS_PAR_DEFAUT;
  return {
    seuil,
    recommandations_suivies: observations.length,
    evaluees: observations.filter((o) => o.score !== null).length,
    elements: scoresParContexte(observations, { seuilMin: seuil }),
  };
}

/** KPI et initiatives du plan d'une mission, pour préparer une recommandation. */
export async function optionsMission(db: Db, auth: Auth, missionId: string) {
  const mission = await exigerMissionVisible(db, auth, missionId);
  if (!estResponsableMission(auth, mission)) throw interdit();
  const kpi = await db.query(
    `SELECT d.id, d.libelle, d.unite, d.sens,
            EXISTS (SELECT 1 FROM cap_recommandations r WHERE r.kpi_id = d.id) AS deja_recommande
     FROM kpi_definitions d WHERE d.mission_id = $1 AND d.actif ORDER BY lower(d.libelle) LIMIT 200`,
    [missionId],
  );
  const initiatives = await db.query(
    `SELECT e.id, v.contenu->>'titre' AS titre
     FROM plan_elements e JOIN plans_strategiques p ON p.id = e.plan_id
     JOIN LATERAL (SELECT x.contenu, x.retire FROM plan_element_versions x
                   WHERE x.element_id = e.id ORDER BY x.version DESC LIMIT 1) v ON true
     WHERE p.mission_id = $1 AND e.type = 'initiative' AND NOT v.retire
     ORDER BY e.cree_le, e.id LIMIT 200`,
    [missionId],
  );
  return { kpi: kpi.rows, initiatives: initiatives.rows };
}
