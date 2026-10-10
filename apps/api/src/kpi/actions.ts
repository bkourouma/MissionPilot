import {
  mesurerEfficaciteActionKpi,
  selectionnerPeriodesAvantApres,
  type EfficaciteKpi,
} from "@missionpilot/engines";
import {
  DELAI_DATE_EFFET_SANS_MOTIF_JOURS,
  kpiActionCommentaireSchema,
  kpiActionCreationSchema,
  kpiActionModificationSchema,
  kpiActionsQuerySchema,
  kpiActionStatutSchema,
  kpiEfficaciteQuerySchema,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import { clauseSet } from "../db/outils.js";
import type { Db } from "../db/pool.js";
import { AppError, conflit, interdit, introuvable, requeteInvalide } from "../errors.js";
import { decoderCurseur, paginer } from "../http/outils.js";
import { exigerMissionVisible, peutModifierMission } from "../missions/acces.js";
import { aujourdhui } from "../missions/outils.js";
import { destinatairesKpiAutorises, exigerKpiSaisissable, peutSaisirKpi } from "./acces.js";
import { lireDefinition } from "./donnees.js";
import {
  evaluerKpisParIds,
  limiteLecturePilotage,
  plafonnerLecture,
  type KpiEvaluePilotage,
} from "./pilotage-donnees.js";

/*
 * Registre des actions correctives (KPI-18), migration 0442. Une action porte sur un KPI de la
 * mission, peut être rattachée à l'alerte qui l'a déclenchée et à la décision de revue qui l'a
 * décidée, a un responsable, une échéance et un statut ; chaque changement ajoute un événement
 * (historique en ajout seul) et une ligne au journal d'audit, dans la même transaction.
 *
 * Droits : lire = `kpi.lire` et mission visible ; créer/modifier/changer le statut = `kpi.saisir`
 * ET (directeur/chef de la mission, propriétaire du KPI, membre de l'équipe, ou responsable de
 * l'action) ; mission clôturée = 409 ; tout autre cas répond 404 (invisible) ou 403.
 *
 * L'efficacité n'est JAMAIS stockée ni saisie : elle est recalculée à chaque lecture par le
 * moteur (variation avant/après sur les périodes closes de la date d'effet). C'est une
 * corrélation dans le temps, pas une preuve de causalité.
 */

export interface LigneAction {
  id: string;
  mission_id: string;
  kpi_id: string;
  alerte_id: string | null;
  revue_id: string | null;
  decision_id: string | null;
  numero: number;
  titre: string;
  description: string | null;
  responsable_id: string;
  echeance: string;
  statut: "a_faire" | "en_cours" | "terminee" | "abandonnee";
  date_effet: string | null;
  motif: string | null;
  cree_par: string;
  cree_le: Date;
  modifie_le: Date;
  kpi_libelle: string;
  responsable_nom: string | null;
}

export const COLONNES_ACTION = `a.id, a.mission_id, a.kpi_id, a.alerte_id, a.revue_id, a.decision_id,
  a.numero, a.titre, a.description, a.responsable_id, a.echeance::text AS echeance, a.statut,
  a.date_effet::text AS date_effet, a.motif, a.cree_par, a.cree_le, a.modifie_le,
  k.libelle AS kpi_libelle, u.nom AS responsable_nom`;

const JOINTURES_ACTION = `FROM kpi_actions a
  JOIN kpi_definitions k ON k.id = a.kpi_id
  LEFT JOIN utilisateurs u ON u.id = a.responsable_id`;

const TRANSITIONS: Record<LigneAction["statut"], readonly LigneAction["statut"][]> = {
  a_faire: ["en_cours", "terminee", "abandonnee"],
  en_cours: ["terminee", "abandonnee"],
  terminee: [],
  abandonnee: [],
};

export async function lireAction(
  db: Db,
  id: string,
  verrouiller = false,
): Promise<LigneAction | null> {
  const r = await db.query(
    `SELECT ${COLONNES_ACTION} ${JOINTURES_ACTION} WHERE a.id = $1 ${verrouiller ? "FOR UPDATE OF a" : ""}`,
    [id],
  );
  return (r.rows[0] as LigneAction | undefined) ?? null;
}

export function vueEfficacite(
  e: EfficaciteKpi,
  sel: {
    periodeEffet: string | null;
    avant: readonly { cle: string; valeur: number | null }[];
    apres: readonly { cle: string; valeur: number | null }[];
  },
  dateEffet: string,
) {
  return {
    date_effet: dateEffet,
    verdict: e.verdict,
    periode_effet: sel.periodeEffet,
    moyenne_avant: e.moyenneAvant,
    moyenne_apres: e.moyenneApres,
    variation: e.variation,
    variation_exacte: e.variationExacte,
    variation_relative: e.variationRelative,
    variation_orientee: e.variationOrientee,
    nombre_avant: e.nombreAvant,
    nombre_apres: e.nombreApres,
    manquant_avant: e.manquantAvant,
    manquant_apres: e.manquantApres,
    periodes_avant: sel.avant.map((p) => ({ periode: p.cle, valeur: p.valeur })),
    periodes_apres: sel.apres.map((p) => ({ periode: p.cle, valeur: p.valeur })),
  };
}

/** Efficacité (moteur) d'une action terminée ; null tant qu'elle ne l'est pas. */
export function efficaciteAction(
  action: Pick<LigneAction, "statut" | "date_effet">,
  evalue: KpiEvaluePilotage | undefined,
  fenetre?: number,
) {
  if (action.statut !== "terminee" || !action.date_effet || !evalue) return null;
  const periodes = evalue.evaluation.periodes.map((p) => ({
    cle: p.cle,
    debut: p.debut,
    fin: p.fin,
    close: p.close,
    valeur: p.valeur,
  }));
  const sel = selectionnerPeriodesAvantApres(periodes, action.date_effet, fenetre);
  const e = mesurerEfficaciteActionKpi({
    sens: evalue.def.sens,
    avant: sel.avant.map((p) => p.valeur as number),
    apres: sel.apres.map((p) => p.valeur as number),
  });
  return vueEfficacite(e, sel, action.date_effet);
}

export function vueAction(a: LigneAction, efficacite: ReturnType<typeof efficaciteAction> = null) {
  return {
    id: a.id,
    mission_id: a.mission_id,
    kpi_id: a.kpi_id,
    kpi_libelle: a.kpi_libelle,
    alerte_id: a.alerte_id,
    revue_id: a.revue_id,
    decision_id: a.decision_id,
    numero: a.numero,
    titre: a.titre,
    description: a.description,
    responsable_id: a.responsable_id,
    responsable_nom: a.responsable_nom,
    echeance: a.echeance,
    statut: a.statut,
    date_effet: a.date_effet,
    motif: a.motif,
    cree_le: a.cree_le,
    modifie_le: a.modifie_le,
    efficacite,
  };
}

async function ajouterEvenement(
  db: Db,
  auth: Auth,
  actionId: string,
  e: {
    type: "creation" | "statut" | "modification" | "commentaire";
    avant: string | null;
    apres: string;
    commentaire: string | null;
  },
) {
  await db.query(
    `INSERT INTO kpi_action_evenements (cabinet_id, action_id, type, statut_avant, statut_apres,
       commentaire, auteur_id) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [auth.cabinetId, actionId, e.type, e.avant, e.apres, e.commentaire, auth.utilisateurId],
  );
}

/** Responsable admis : actif, `kpi.lire`, directeur/chef/membre de l'équipe (ou lecteur de tout). */
async function exigerResponsableValide(db: Db, missionId: string, id: string): Promise<void> {
  if ((await destinatairesKpiAutorises(db, missionId, [id])).length === 0) {
    throw requeteInvalide(
      "Le responsable d'une action est un membre actif de l'équipe de la mission qui lit les KPI.",
    );
  }
}

/** Action dont la mission est visible, ou 404 (même réponse qu'une action d'un autre cabinet). */
export async function exigerActionVisible(db: Db, auth: Auth, id: string) {
  const action = await lireAction(db, id);
  if (!action) throw introuvable("Action");
  const mission = await exigerMissionVisible(db, auth, action.mission_id).catch((e: unknown) => {
    throw e instanceof AppError && e.statut === 404 ? introuvable("Action") : e;
  });
  return { action, mission };
}

/** Action modifiable par l'utilisateur (404 / 403 / 409), verrouillée. */
async function exigerActionModifiable(db: Db, auth: Auth, id: string, permettreTerminee = false) {
  const { action, mission } = await exigerActionVisible(db, auth, id);
  const def = await lireDefinition(db, action.kpi_id);
  if (!def) throw introuvable("Action");
  const autorise =
    action.responsable_id === auth.utilisateurId ||
    (await peutSaisirKpi(db, auth, { def, mission })) ||
    peutModifierMission(auth, mission);
  if (!autorise) throw interdit();
  if (mission.statut === "cloturee") throw conflit("La mission est clôturée.");
  const verrouillee = await lireAction(db, id, true);
  if (!verrouillee) throw introuvable("Action");
  if (!permettreTerminee && TRANSITIONS[verrouillee.statut].length === 0) {
    throw conflit("Une action terminée ou abandonnée ne se modifie plus.");
  }
  return { action: verrouillee, mission };
}

async function evaluerPour(db: Db, actions: readonly LigneAction[], date: string) {
  const ids = [...new Set(actions.filter((a) => a.statut === "terminee").map((a) => a.kpi_id))];
  return evaluerKpisParIds(db, ids, date);
}

export async function detailAction(db: Db, action: LigneAction, fenetre?: number) {
  const evalues = await evaluerPour(db, [action], aujourdhui());
  const ev = await db.query(
    `SELECT e.id, e.type, e.statut_avant, e.statut_apres, e.commentaire, e.auteur_id,
       u.nom AS auteur_nom, e.cree_le
     FROM kpi_action_evenements e LEFT JOIN utilisateurs u ON u.id = e.auteur_id
     WHERE e.action_id = $1 ORDER BY e.cree_le, e.id LIMIT $2`,
    [action.id, limiteLecturePilotage()],
  );
  const evenements = plafonnerLecture(ev.rows);
  return {
    ...vueAction(action, efficaciteAction(action, evalues.get(action.kpi_id), fenetre)),
    evenements: evenements.lignes,
    evenements_tronque: evenements.tronque,
  };
}

export async function creerAction(db: Db, auth: Auth, missionId: string, corps: unknown) {
  const c = kpiActionCreationSchema.parse(corps);
  // La numérotation est PAR MISSION (maximum + 1 dans le déclencheur) : deux créations sur deux KPI
  // d'une même mission ne se sérialisent pas par le seul verrou du KPI. On verrouille donc la
  // MISSION d'abord (comme creerRevue), puis le KPI ; un 23505 résiduel est traduit en 409
  // réessayable (kpi/erreurs.ts).
  await exigerMissionVisible(db, auth, missionId, true);
  const { def, mission } = await exigerKpiSaisissable(db, auth, c.kpi_id);
  if (def.mission_id !== missionId || mission.id !== missionId) throw introuvable("KPI");
  await exigerResponsableValide(db, missionId, c.responsable_id);
  if (c.alerte_id) {
    // Inconnue, d'un autre KPI ou d'un autre cabinet : la même réponse (aucune confirmation d'existence).
    const a = await db.query("SELECT 1 FROM kpi_alertes WHERE id = $1 AND kpi_id = $2", [
      c.alerte_id,
      c.kpi_id,
    ]);
    if (a.rows.length === 0) throw introuvable("Alerte");
  }
  let revueId: string | null = null;
  if (c.decision_id) {
    const d = await db.query(
      `SELECT d.revue_id, r.mission_id FROM kpi_revue_decisions d
       JOIN kpi_revues r ON r.id = d.revue_id WHERE d.id = $1`,
      [c.decision_id],
    );
    const ligne = d.rows[0] as { revue_id: string; mission_id: string } | undefined;
    if (!ligne || ligne.mission_id !== missionId) throw introuvable("Décision");
    // Verrou de la revue : la clôture de la revue (qui refuse une action ouverte) et cette
    // création se sérialisent ; le déclencheur MPK27 (0444) redit la règle en base.
    const revue = await db.query("SELECT statut FROM kpi_revues WHERE id = $1 FOR UPDATE", [
      ligne.revue_id,
    ]);
    if (revue.rows[0]?.statut !== "tenue") {
      throw new AppError(
        409,
        "KPI_ACTION_REVUE",
        "Une action se rattache à une décision d'une revue tenue et non clôturée : cette revue n'est pas tenue, ou elle est déjà clôturée.",
      );
    }
    revueId = ligne.revue_id;
  }
  const r = await db.query(
    `INSERT INTO kpi_actions (cabinet_id, mission_id, kpi_id, alerte_id, revue_id, decision_id,
       numero, titre, description, responsable_id, echeance, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $8, $9, $10, $11) RETURNING id`,
    [
      auth.cabinetId,
      missionId,
      c.kpi_id,
      c.alerte_id ?? null,
      revueId,
      c.decision_id ?? null,
      c.titre,
      c.description ?? null,
      c.responsable_id,
      c.echeance,
      auth.utilisateurId,
    ],
  );
  const id = r.rows[0].id as string;
  await ajouterEvenement(db, auth, id, {
    type: "creation",
    avant: null,
    apres: "a_faire",
    commentaire: null,
  });
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "kpi.action.creer",
    entite: "kpi_action",
    entiteId: id,
    details: {
      mission_id: missionId,
      kpi_id: c.kpi_id,
      alerte_id: c.alerte_id ?? null,
      decision_id: c.decision_id ?? null,
      responsable_id: c.responsable_id,
    },
  });
  const action = await lireAction(db, id);
  if (!action) throw introuvable("Action");
  return detailAction(db, action);
}

export async function listerActions(db: Db, auth: Auth, missionId: string, query: unknown) {
  const q = kpiActionsQuerySchema.parse(query);
  const apres = decoderCurseur(q.curseur);
  if (apres && !/^\d{1,9}$/.test(apres[0])) throw requeteInvalide("Curseur invalide.");
  await exigerMissionVisible(db, auth, missionId);
  const r = await db.query(
    `SELECT ${COLONNES_ACTION}, a.numero::text AS cle_tri
     ${JOINTURES_ACTION}
     WHERE a.mission_id = $1
       AND ($2::text IS NULL OR a.statut = $2)
       AND ($3::uuid IS NULL OR a.kpi_id = $3)
       AND ($4::uuid IS NULL OR a.alerte_id = $4)
       AND ($5::uuid IS NULL OR a.responsable_id = $5)
       AND ($6::int IS NULL OR a.numero < $6::int)
     ORDER BY a.numero DESC LIMIT $7`,
    [
      missionId,
      q.statut ?? null,
      q.kpi_id ?? null,
      q.alerte_id ?? null,
      q.responsable_id ?? null,
      apres ? Number(apres[0]) : null,
      q.limite + 1,
    ],
  );
  const page = paginer(r.rows as (LigneAction & { cle_tri: string; id: string })[], q.limite);
  const lignes = page.elements as unknown as LigneAction[];
  const evalues = await evaluerPour(db, lignes, aujourdhui());
  return {
    elements: lignes.map((a) => vueAction(a, efficaciteAction(a, evalues.get(a.kpi_id)))),
    curseur_suivant: page.curseur_suivant,
  };
}

export async function modifierAction(db: Db, auth: Auth, id: string, corps: unknown) {
  const modif = kpiActionModificationSchema.parse(corps);
  const { action } = await exigerActionModifiable(db, auth, id);
  if (modif.responsable_id)
    await exigerResponsableValide(db, action.mission_id, modif.responsable_id);
  const set = clauseSet(modif, 3);
  await db.query(`UPDATE kpi_actions SET ${set.sql}, modifie_par = $2 WHERE id = $1`, [
    id,
    auth.utilisateurId,
    ...set.valeurs,
  ]);
  const champs = Object.keys(modif).filter((k) => modif[k as keyof typeof modif] !== undefined);
  await ajouterEvenement(db, auth, id, {
    type: "modification",
    avant: action.statut,
    apres: action.statut,
    commentaire: `Champs modifiés : ${champs.join(", ")}`,
  });
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "kpi.action.modifier",
    entite: "kpi_action",
    entiteId: id,
    details: { champs },
  });
  const apres = await lireAction(db, id);
  if (!apres) throw introuvable("Action");
  return detailAction(db, apres);
}

export async function changerStatutAction(db: Db, auth: Auth, id: string, corps: unknown) {
  const c = kpiActionStatutSchema.parse(corps);
  const { action } = await exigerActionModifiable(db, auth, id);
  if (!TRANSITIONS[action.statut].includes(c.statut)) {
    throw conflit(`Une action « ${action.statut} » ne peut pas passer à « ${c.statut} ».`);
  }
  const jour = aujourdhui();
  let dateEffet: string | null = null;
  if (c.statut === "terminee") {
    dateEffet = c.date_effet ?? jour;
    if (dateEffet > jour) throw requeteInvalide("La date d'effet ne peut pas être dans le futur.");
    // La date d'effet fixe les fenêtres avant/après de l'efficacité : un recul important sur le
    // passé se justifie (le commentaire est conservé dans l'historique de l'action).
    const recul = (Date.parse(jour) - Date.parse(dateEffet)) / 86_400_000;
    if (recul > DELAI_DATE_EFFET_SANS_MOTIF_JOURS && !c.commentaire) {
      throw requeteInvalide(
        `Une date d'effet antérieure de plus de ${DELAI_DATE_EFFET_SANS_MOTIF_JOURS} jours à aujourd'hui exige un commentaire qui la justifie.`,
      );
    }
  }
  await db.query(
    `UPDATE kpi_actions SET statut = $3, date_effet = $4::date, motif = $5, modifie_par = $2
     WHERE id = $1`,
    [id, auth.utilisateurId, c.statut, dateEffet, c.motif ?? null],
  );
  await ajouterEvenement(db, auth, id, {
    type: "statut",
    avant: action.statut,
    apres: c.statut,
    commentaire: c.motif ?? c.commentaire ?? null,
  });
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "kpi.action.statut",
    entite: "kpi_action",
    entiteId: id,
    details: { avant: action.statut, apres: c.statut, date_effet: dateEffet },
  });
  const apres = await lireAction(db, id);
  if (!apres) throw introuvable("Action");
  return detailAction(db, apres);
}

export async function commenterAction(db: Db, auth: Auth, id: string, corps: unknown) {
  const c = kpiActionCommentaireSchema.parse(corps);
  const { action } = await exigerActionModifiable(db, auth, id, true);
  await ajouterEvenement(db, auth, id, {
    type: "commentaire",
    avant: action.statut,
    apres: action.statut,
    commentaire: c.commentaire,
  });
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "kpi.action.commenter",
    entite: "kpi_action",
    entiteId: id,
  });
  return detailAction(db, action);
}

/** Efficacité détaillée d'une action terminée (lecture), fenêtre et date d'arrêté au choix. */
export async function efficaciteDetaillee(db: Db, auth: Auth, id: string, query: unknown) {
  const q = kpiEfficaciteQuerySchema.parse(query);
  const { action } = await exigerActionVisible(db, auth, id);
  if (action.statut !== "terminee") {
    throw conflit("L'efficacité se mesure sur une action terminée.");
  }
  const evalues = await evaluerKpisParIds(db, [action.kpi_id], q.date ?? aujourdhui());
  return {
    action_id: id,
    kpi_id: action.kpi_id,
    efficacite: efficaciteAction(action, evalues.get(action.kpi_id), q.fenetre),
    avertissement:
      "Variation avant/après : une corrélation dans le temps, pas une preuve que l'action en est la cause.",
  };
}
