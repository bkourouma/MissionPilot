import {
  composerOrdreDuJourKpi,
  type ActionRevueKpi,
  type DecisionRevueKpi,
  type KpiRevueKpi,
} from "@missionpilot/engines";
import {
  dateArreteMax,
  kpiDecisionCreationSchema,
  kpiDecisionStatutSchema,
  kpiRevueCreationSchema,
  kpiRevueModificationSchema,
  kpiRevueOrdreDuJourSchema,
  kpiRevuesQuerySchema,
  kpiRevueTenueSchema,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import { clauseSet } from "../db/outils.js";
import type { Db } from "../db/pool.js";
import { AppError, conflit, interdit, introuvable, requeteInvalide } from "../errors.js";
import { decoderCurseur, paginer } from "../http/outils.js";
import {
  exigerMissionModifiable,
  exigerMissionVisible,
  peutModifierMission,
  type MissionAcces,
} from "../missions/acces.js";
import { destinatairesKpiAutorises } from "./acces.js";
import { definitionsDeMission } from "./donnees.js";
import { dossierRevue } from "./dossier-revue.js";
import { efficaciteAction, COLONNES_ACTION, vueAction, type LigneAction } from "./actions.js";
import {
  actionsDeRevue,
  decisionsDeRevue,
  COLONNES_DECISION,
  COLONNES_REVUE,
  JOINTURES_REVUE,
  JOINTURES_DECISION,
  lireRevue,
  vueDecision,
  vueRevue,
  type LigneDecision,
  type LigneRevue,
  type PointOrdreDuJour,
} from "./revues-donnees.js";
import {
  evaluerDefinitions,
  evaluerKpisParIds,
  limiteLecturePilotage,
  plafonnerLecture,
} from "./pilotage-donnees.js";
import { qualiteDesKpi } from "./qualite-donnees.js";

/*
 * Revue de performance ritualisée (KPI-17), migration 0441. Cycle : planifiée (ordre du jour
 * proposé par le moteur, éditable) → tenue (dossier FIGÉ) → clôturée (toutes les décisions et
 * actions liées terminées ou abandonnées) ; ou annulée tant qu'elle n'est pas tenue. Chaque
 * écriture est journalisée dans sa transaction ; les décisions ont un historique en ajout seul.
 *
 * Compte rendu : saisi tant que la revue est planifiée ou à l'instant de la tenue, puis FIGÉ
 * (MPK22, 0443) comme l'ordre du jour et le dossier ; le dossier est figé en « brouillon »
 * confidentiel : aucun circuit de validation n'existe, il ne porte donc jamais « Validé ».
 *
 * Droits : lire = `kpi.lire` et mission visible ; planifier, éditer, tenir, clôturer, annuler
 * et enregistrer une décision = `kpi.gerer` et mission modifiable (non clôturée) ; changer
 * le statut d'une décision = `kpi.saisir` ET (directeur/chef/« modifier toutes » ou
 * responsable de la décision). Un identifiant d'une autre mission, d'un autre cabinet ou
 * invisible répond 404. L'ordre du jour est proposé par le moteur déterministe
 * (packages/engines/src/kpi/revue.ts) : aucun texte ni chiffre produit par un modèle.
 */

export async function exigerRevueVisible(
  db: Db,
  auth: Auth,
  id: string,
): Promise<{ revue: LigneRevue; mission: MissionAcces }> {
  const revue = await lireRevue(db, id);
  if (!revue) throw introuvable("Revue");
  const mission = await exigerMissionVisible(db, auth, revue.mission_id).catch((e: unknown) => {
    throw e instanceof AppError && e.statut === 404 ? introuvable("Revue") : e;
  });
  return { revue, mission };
}

/** Revue dont la mission est modifiable (404 / 403 / 409), verrouillée. */
async function exigerRevueGerable(db: Db, auth: Auth, id: string) {
  const { revue } = await exigerRevueVisible(db, auth, id);
  const mission = await exigerMissionModifiable(db, auth, revue.mission_id);
  const verrouillee = await lireRevue(db, id, true);
  if (!verrouillee) throw introuvable("Revue");
  return { revue: verrouillee, mission };
}

const TRANSITIONS_DECISION: Record<LigneDecision["statut"], readonly LigneDecision["statut"][]> = {
  ouverte: ["en_cours", "executee", "abandonnee"],
  en_cours: ["executee", "abandonnee"],
  executee: [],
  abandonnee: [],
};

async function exigerAnimateurValide(db: Db, missionId: string, id: string | null | undefined) {
  if (!id) return;
  if ((await destinatairesKpiAutorises(db, missionId, [id])).length === 0) {
    throw requeteInvalide(
      "L'animateur d'une revue est un membre actif de l'équipe de la mission qui lit les KPI.",
    );
  }
}

export async function creerRevue(db: Db, auth: Auth, missionId: string, corps: unknown) {
  const c = kpiRevueCreationSchema.parse(corps);
  await exigerMissionModifiable(db, auth, missionId);
  await exigerAnimateurValide(db, missionId, c.animateur_id);
  const reference = c.date_reference ?? c.date_prevue;
  if (reference > dateArreteMax()) {
    throw requeteInvalide("La date d'arrêté dépasse l'horizon admis (aujourd'hui + 366 jours).");
  }
  const r = await db.query(
    `INSERT INTO kpi_revues (cabinet_id, mission_id, numero, titre, date_prevue, date_reference,
       animateur_id, cree_par)
     VALUES ($1, $2, 0, $3, $4, $5, $6, $7) RETURNING id`,
    [
      auth.cabinetId,
      missionId,
      c.titre,
      c.date_prevue,
      reference,
      c.animateur_id ?? null,
      auth.utilisateurId,
    ],
  );
  const id = r.rows[0].id as string;
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "kpi.revue.creer",
    entite: "kpi_revue",
    entiteId: id,
    details: { mission_id: missionId, date_prevue: c.date_prevue },
  });
  const revue = await lireRevue(db, id);
  if (!revue) throw introuvable("Revue");
  return vueRevue(revue);
}

export async function listerRevues(db: Db, auth: Auth, missionId: string, query: unknown) {
  const q = kpiRevuesQuerySchema.parse(query);
  const apres = decoderCurseur(q.curseur);
  if (apres && !/^\d{1,9}$/.test(apres[0])) throw requeteInvalide("Curseur invalide.");
  await exigerMissionVisible(db, auth, missionId);
  const r = await db.query(
    `SELECT ${COLONNES_REVUE}, r.numero::text AS cle_tri ${JOINTURES_REVUE}
     WHERE r.mission_id = $1 AND ($2::text IS NULL OR r.statut = $2)
       AND ($3::int IS NULL OR r.numero < $3::int)
     ORDER BY r.numero DESC LIMIT $4`,
    [missionId, q.statut ?? null, apres ? Number(apres[0]) : null, q.limite + 1],
  );
  const page = paginer(r.rows as (LigneRevue & { cle_tri: string; id: string })[], q.limite);
  return {
    elements: (page.elements as unknown as LigneRevue[]).map(vueRevue),
    curseur_suivant: page.curseur_suivant,
  };
}

export async function detailRevue(db: Db, auth: Auth, id: string) {
  const { revue } = await exigerRevueVisible(db, auth, id);
  const decisions = await decisionsDeRevue(db, id);
  const actions = await actionsDeRevue(db, id);
  const lecture = await db.query(
    `SELECT e.id, e.decision_id, e.type, e.statut_avant, e.statut_apres, e.commentaire,
       e.auteur_id, u.nom AS auteur_nom, e.cree_le
     FROM kpi_revue_decision_evenements e
     JOIN kpi_revue_decisions d ON d.id = e.decision_id
     LEFT JOIN utilisateurs u ON u.id = e.auteur_id
     WHERE d.revue_id = $1 ORDER BY e.cree_le, e.id LIMIT $2`,
    [id, limiteLecturePilotage()],
  );
  const evenements = plafonnerLecture(lecture.rows);
  const evalues = await evaluerKpisParIds(
    db,
    actions.lignes.filter((a) => a.statut === "terminee").map((a) => a.kpi_id),
    revue.date_reference,
  );
  return {
    ...vueRevue(revue),
    decisions: decisions.lignes.map(vueDecision),
    actions: actions.lignes.map((a) => vueAction(a, efficaciteAction(a, evalues.get(a.kpi_id)))),
    evenements_decisions: evenements.lignes,
    // Une liste plafonnée (500 lignes) le dit : jamais de troncature silencieuse.
    decisions_tronque: decisions.tronque,
    actions_tronque: actions.tronque,
    evenements_decisions_tronque: evenements.tronque,
  };
}

export async function modifierRevue(db: Db, auth: Auth, id: string, corps: unknown) {
  const modif = kpiRevueModificationSchema.parse(corps);
  const { revue } = await exigerRevueGerable(db, auth, id);
  const { compte_rendu: compteRendu, ...structure } = modif;
  const structurel = Object.values(structure).some((v) => v !== undefined);
  if (structurel && revue.statut !== "planifiee") {
    throw conflit("Seule une revue planifiée change de titre, de date ou d'animateur.");
  }
  if (compteRendu !== undefined && revue.statut !== "planifiee") {
    throw conflit(
      "Le compte rendu est figé dès la tenue de la revue : saisissez-le avant, ou au moment de la tenir.",
    );
  }
  if (structure.animateur_id)
    await exigerAnimateurValide(db, revue.mission_id, structure.animateur_id);
  if (structure.date_reference && structure.date_reference > dateArreteMax()) {
    throw requeteInvalide("La date d'arrêté dépasse l'horizon admis (aujourd'hui + 366 jours).");
  }
  const set = clauseSet(modif, 3);
  await db.query(`UPDATE kpi_revues SET ${set.sql}, modifie_par = $2 WHERE id = $1`, [
    id,
    auth.utilisateurId,
    ...set.valeurs,
  ]);
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "kpi.revue.modifier",
    entite: "kpi_revue",
    entiteId: id,
    details: {
      champs: Object.keys(modif).filter((k) => modif[k as keyof typeof modif] !== undefined),
    },
  });
  const apres = await lireRevue(db, id);
  if (!apres) throw introuvable("Revue");
  return vueRevue(apres);
}

async function enregistrerOrdreDuJour(
  db: Db,
  auth: Auth,
  revue: LigneRevue,
  points: PointOrdreDuJour[],
  action: string,
  details: Record<string, unknown>,
) {
  await db.query(
    "UPDATE kpi_revues SET ordre_du_jour = $3::jsonb, modifie_par = $2 WHERE id = $1",
    [revue.id, auth.utilisateurId, JSON.stringify(points)],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action,
    entite: "kpi_revue",
    entiteId: revue.id,
    details: { ...details, points: points.length },
  });
}

/** Propose l'ordre du jour par le moteur (remplace le précédent, revue planifiée seulement). */
export async function genererOrdreDuJour(db: Db, auth: Auth, id: string) {
  const { revue } = await exigerRevueGerable(db, auth, id);
  if (revue.statut !== "planifiee") throw conflit("L'ordre du jour d'une revue tenue est figé.");
  const date = revue.date_reference;
  const defs = await definitionsDeMission(db, revue.mission_id, true);
  const evalues = await evaluerDefinitions(db, defs, date);
  const qualites = await qualiteDesKpi(db, defs, date);
  const niveau = new Map(qualites.map((q) => [q.def.id, q.qualite.niveau]));
  const kpis: KpiRevueKpi[] = defs.map((d) => {
    const e = evalues.get(d.id)?.evaluation;
    return {
      id: d.id,
      libelle: d.libelle,
      statut: e?.statut ?? "non_mesure",
      evolution: e?.tendance.evolution ?? "indeterminee",
      nombreAlertes: e?.alertes.length ?? 0,
      qualite: niveau.get(d.id) ?? null,
    };
  });
  const actionsLues = await db.query(
    `SELECT ${COLONNES_ACTION} FROM kpi_actions a
     JOIN kpi_definitions k ON k.id = a.kpi_id LEFT JOIN utilisateurs u ON u.id = a.responsable_id
     WHERE a.mission_id = $1 ORDER BY a.numero DESC LIMIT $2`,
    [revue.mission_id, limiteLecturePilotage()],
  );
  const actionsPlafonnees = plafonnerLecture(actionsLues.rows as LigneAction[]);
  const lignes = actionsPlafonnees.lignes;
  const evaluesActions = await evaluerKpisParIds(
    db,
    lignes.filter((a) => a.statut === "terminee").map((a) => a.kpi_id),
    date,
  );
  const actions: ActionRevueKpi[] = lignes.map((a) => ({
    id: a.id,
    libelle: a.titre,
    kpiId: a.kpi_id,
    echeance: a.echeance,
    statut: a.statut,
    efficacite: (efficaciteAction(a, evaluesActions.get(a.kpi_id))?.verdict ??
      null) as ActionRevueKpi["efficacite"],
  }));
  const dec = await db.query(
    `SELECT d.id, d.libelle, d.echeance::text AS echeance FROM kpi_revue_decisions d
     JOIN kpi_revues r ON r.id = d.revue_id
     WHERE r.mission_id = $1 AND r.id <> $2 AND d.statut IN ('ouverte', 'en_cours')
     ORDER BY d.cree_le, d.id LIMIT $3`,
    [revue.mission_id, id, limiteLecturePilotage()],
  );
  const decisionsPlafonnees = plafonnerLecture(dec.rows);
  const decisionsOuvertes: DecisionRevueKpi[] = decisionsPlafonnees.lignes.map((d) => ({
    id: d.id as string,
    libelle: d.libelle as string,
    echeance: (d.echeance as string | null) ?? null,
  }));
  const ordre = composerOrdreDuJourKpi({
    dateReference: date,
    kpis,
    actions,
    decisionsOuvertes,
  });
  const points: PointOrdreDuJour[] = ordre.points.map((p) => ({
    rang: p.rang,
    code: p.code,
    libelle: p.libelle,
    kpi_id: p.kpiId,
    action_id: p.actionId,
    decision_id: p.decisionId,
    priorite: p.priorite,
    duree_minutes: p.dureeMinutes,
    origine: "moteur",
  }));
  await enregistrerOrdreDuJour(db, auth, revue, points, "kpi.revue.ordre_du_jour.generer", {
    ecartes: ordre.ecartes,
  });
  return {
    revue_id: id,
    date_reference: date,
    points,
    duree_totale_minutes: ordre.dureeTotaleMinutes,
    ecartes: ordre.ecartes,
    // Actions ou décisions de la mission au-delà de 500 : l'ordre du jour proposé est partiel.
    sources_tronquees: actionsPlafonnees.tronque || decisionsPlafonnees.tronque,
  };
}

/** Remplace l'ordre du jour par une liste saisie (revue planifiée seulement). */
export async function remplacerOrdreDuJour(db: Db, auth: Auth, id: string, corps: unknown) {
  const c = kpiRevueOrdreDuJourSchema.parse(corps);
  const { revue } = await exigerRevueGerable(db, auth, id);
  if (revue.statut !== "planifiee") throw conflit("L'ordre du jour d'une revue tenue est figé.");
  const ids = [...new Set(c.points.flatMap((p) => (p.kpi_id ? [p.kpi_id] : [])))];
  if (ids.length > 0) {
    const r = await db.query(
      "SELECT id FROM kpi_definitions WHERE id = ANY ($1::uuid[]) AND mission_id = $2",
      [ids, revue.mission_id],
    );
    if (r.rows.length !== ids.length)
      throw requeteInvalide("Un KPI de l'ordre du jour est inconnu.");
  }
  const points: PointOrdreDuJour[] = c.points.map((p, i) => ({
    rang: i + 1,
    code: "MANUEL",
    libelle: p.libelle,
    kpi_id: p.kpi_id ?? null,
    action_id: null,
    decision_id: null,
    priorite: 0,
    duree_minutes: p.duree_minutes,
    origine: "manuel",
  }));
  await enregistrerOrdreDuJour(db, auth, revue, points, "kpi.revue.ordre_du_jour.remplacer", {});
  return { revue_id: id, points };
}

/** Tient la revue : fige le dossier tel qu'examiné (statut « tenue »). */
export async function tenirRevue(db: Db, auth: Auth, id: string, corps: unknown) {
  const c = kpiRevueTenueSchema.parse(corps ?? {});
  const { revue } = await exigerRevueGerable(db, auth, id);
  if (revue.statut !== "planifiee") throw conflit("Seule une revue planifiée peut être tenue.");
  if (revue.ordre_du_jour.length === 0) {
    throw conflit("Générez ou saisissez l'ordre du jour avant de tenir la revue.");
  }
  // « brouillon » : aucun circuit de validation n'existe pour ce dossier ; il ne se dit pas « Validé ».
  const dossier = await dossierRevue(db, revue, "brouillon");
  await db.query(
    `UPDATE kpi_revues SET statut = 'tenue', dossier = $3::jsonb, tenue_le = now(), tenue_par = $2,
       compte_rendu = coalesce($4, compte_rendu), modifie_par = $2 WHERE id = $1`,
    [id, auth.utilisateurId, JSON.stringify(dossier), c.compte_rendu ?? null],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "kpi.revue.tenir",
    entite: "kpi_revue",
    entiteId: id,
    details: { date_reference: revue.date_reference, points: revue.ordre_du_jour.length },
  });
  const apres = await lireRevue(db, id);
  if (!apres) throw introuvable("Revue");
  return vueRevue(apres);
}

/** Clôture : refusée tant qu'une décision ou une action liée est ouverte (409 + liste). */
export async function cloturerRevue(db: Db, auth: Auth, id: string) {
  const { revue } = await exigerRevueGerable(db, auth, id);
  if (revue.statut !== "tenue") throw conflit("Seule une revue tenue peut être clôturée.");
  const d = await db.query(
    "SELECT id FROM kpi_revue_decisions WHERE revue_id = $1 AND statut IN ('ouverte', 'en_cours') ORDER BY numero",
    [id],
  );
  const a = await db.query(
    "SELECT id FROM kpi_actions WHERE revue_id = $1 AND statut IN ('a_faire', 'en_cours') ORDER BY numero",
    [id],
  );
  if (d.rows.length > 0 || a.rows.length > 0) {
    throw new AppError(
      409,
      "KPI_REVUE_OUVERTE",
      "Des décisions ou des actions de la revue sont encore ouvertes : terminez-les ou abandonnez-les (avec motif).",
      {
        manquants: [
          ...d.rows.map((l) => `decision:${l.id}`),
          ...a.rows.map((l) => `action:${l.id}`),
        ],
      },
    );
  }
  await db.query(
    `UPDATE kpi_revues SET statut = 'cloturee', cloturee_le = now(), cloturee_par = $2, modifie_par = $2
     WHERE id = $1`,
    [id, auth.utilisateurId],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "kpi.revue.cloturer",
    entite: "kpi_revue",
    entiteId: id,
  });
  const apres = await lireRevue(db, id);
  if (!apres) throw introuvable("Revue");
  return vueRevue(apres);
}

export async function annulerRevue(db: Db, auth: Auth, id: string) {
  const { revue } = await exigerRevueGerable(db, auth, id);
  if (revue.statut !== "planifiee") throw conflit("Seule une revue planifiée peut être annulée.");
  await db.query("UPDATE kpi_revues SET statut = 'annulee', modifie_par = $2 WHERE id = $1", [
    id,
    auth.utilisateurId,
  ]);
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "kpi.revue.annuler",
    entite: "kpi_revue",
    entiteId: id,
  });
  const apres = await lireRevue(db, id);
  if (!apres) throw introuvable("Revue");
  return vueRevue(apres);
}

async function evenementDecision(
  db: Db,
  auth: Auth,
  decisionId: string,
  e: {
    type: "creation" | "statut" | "modification";
    avant: string | null;
    apres: string;
    commentaire: string | null;
  },
) {
  await db.query(
    `INSERT INTO kpi_revue_decision_evenements (cabinet_id, decision_id, type, statut_avant,
       statut_apres, commentaire, auteur_id) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [auth.cabinetId, decisionId, e.type, e.avant, e.apres, e.commentaire, auth.utilisateurId],
  );
}

export async function creerDecision(db: Db, auth: Auth, revueId: string, corps: unknown) {
  const c = kpiDecisionCreationSchema.parse(corps);
  const { revue } = await exigerRevueGerable(db, auth, revueId);
  if (revue.statut !== "tenue") {
    throw conflit("Une décision se prend dans une revue tenue et non clôturée.");
  }
  if (c.kpi_id) {
    const k = await db.query("SELECT 1 FROM kpi_definitions WHERE id = $1 AND mission_id = $2", [
      c.kpi_id,
      revue.mission_id,
    ]);
    if (k.rows.length === 0) throw requeteInvalide("Le KPI de la décision est inconnu.");
  }
  if (c.responsable_id) {
    if ((await destinatairesKpiAutorises(db, revue.mission_id, [c.responsable_id])).length === 0) {
      throw requeteInvalide(
        "Le responsable d'une décision est un membre actif de l'équipe de la mission qui lit les KPI.",
      );
    }
  }
  const r = await db.query(
    `INSERT INTO kpi_revue_decisions (cabinet_id, revue_id, numero, libelle, kpi_id, responsable_id,
       echeance, cree_par)
     VALUES ($1, $2, 0, $3, $4, $5, $6, $7) RETURNING id`,
    [
      auth.cabinetId,
      revueId,
      c.libelle,
      c.kpi_id ?? null,
      c.responsable_id ?? null,
      c.echeance ?? null,
      auth.utilisateurId,
    ],
  );
  const id = r.rows[0].id as string;
  await evenementDecision(db, auth, id, {
    type: "creation",
    avant: null,
    apres: "ouverte",
    commentaire: null,
  });
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "kpi.revue.decision.creer",
    entite: "kpi_revue_decision",
    entiteId: id,
    details: {
      revue_id: revueId,
      kpi_id: c.kpi_id ?? null,
      responsable_id: c.responsable_id ?? null,
    },
  });
  const d = await db.query(`SELECT ${COLONNES_DECISION} ${JOINTURES_DECISION} WHERE d.id = $1`, [
    id,
  ]);
  return vueDecision(d.rows[0] as LigneDecision);
}

export async function changerStatutDecision(db: Db, auth: Auth, id: string, corps: unknown) {
  const c = kpiDecisionStatutSchema.parse(corps);
  const lue = await db.query(`SELECT ${COLONNES_DECISION} ${JOINTURES_DECISION} WHERE d.id = $1`, [
    id,
  ]);
  const decision = lue.rows[0] as LigneDecision | undefined;
  if (!decision) throw introuvable("Décision");
  const { revue, mission } = await exigerRevueVisible(db, auth, decision.revue_id).catch(
    (e: unknown) => {
      throw e instanceof AppError && e.statut === 404 ? introuvable("Décision") : e;
    },
  );
  if (!(peutModifierMission(auth, mission) || decision.responsable_id === auth.utilisateurId)) {
    throw interdit();
  }
  if (mission.statut === "cloturee") throw conflit("La mission est clôturée.");
  if (revue.statut !== "tenue") throw conflit("La revue n'est pas en cours de suivi (tenue).");
  const verrou = await db.query("SELECT statut FROM kpi_revue_decisions WHERE id = $1 FOR UPDATE", [
    id,
  ]);
  const statut = verrou.rows[0].statut as LigneDecision["statut"];
  if (!TRANSITIONS_DECISION[statut].includes(c.statut)) {
    throw conflit(`Une décision « ${statut} » ne peut pas passer à « ${c.statut} ».`);
  }
  const terminal = c.statut === "executee" || c.statut === "abandonnee";
  await db.query(
    `UPDATE kpi_revue_decisions SET statut = $3, motif = $4,
       cloturee_le = CASE WHEN $5::boolean THEN now() ELSE NULL END, modifie_par = $2
     WHERE id = $1`,
    [id, auth.utilisateurId, c.statut, c.motif ?? null, terminal],
  );
  await evenementDecision(db, auth, id, {
    type: "statut",
    avant: statut,
    apres: c.statut,
    commentaire: c.motif ?? c.commentaire ?? null,
  });
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "kpi.revue.decision.statut",
    entite: "kpi_revue_decision",
    entiteId: id,
    details: { avant: statut, apres: c.statut },
  });
  const d = await db.query(`SELECT ${COLONNES_DECISION} ${JOINTURES_DECISION} WHERE d.id = $1`, [
    id,
  ]);
  return vueDecision(d.rows[0] as LigneDecision);
}
