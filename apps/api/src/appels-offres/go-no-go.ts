import { evaluerGoNoGo, type Rapprochement } from "@missionpilot/engines";
import { aPermission, type DecisionGoNoGoCorps, type EvaluationGoNoGo } from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, conflit } from "../errors.js";
import { changerStatut, lireFiche } from "./fiches.js";

/*
 * Score go/no-go (AO-02) : calculé par le moteur `evaluerGoNoGo` à partir d'entrées saisies
 * (adéquation et références pertinentes par défaut tirées du rapprochement AO-01), conservé en
 * ajout seul ; la DÉCISION revient à un associé (`ao.decider`, doublé en base : MPA03), motivée,
 * sur la dernière évaluation. Une première évaluation fait passer la fiche « détectée » en
 * « go/no-go » ; la décision la fait passer « en réponse » (go) ou « no-go ».
 *
 * FIN-02 : la marge estimée ne se saisit qu'avec `finance.lire` ; sans ce droit, la réponse ne
 * porte NI la marge, NI sa cible, NI sa note, NI l'éliminatoire qui la révèle, NI l'indicateur de
 * sa saisie (champs absents, jamais un zéro), et le score et la recommandation sont recalculés
 * SANS la marge à partir des entrées (`vueEvaluation`).
 */

export const margeReservee = () =>
  new AppError(
    403,
    "MARGE_RESERVEE",
    "La marge estimée est une donnée financière réservée aux associés et gestionnaires.",
  );

/** Entrées enregistrées d'une évaluation (la marge et sa cible sont facultatives). */
interface EntreesEvaluation {
  adequation: number;
  references_pertinentes: number;
  references_exigees: number;
  jours_disponibles: number;
  jours_requis: number;
  concurrents_connus: number;
  concurrents_forts: number;
}

/**
 * Évaluation servie selon les droits financiers de l'utilisateur. Sans `finance.lire`, le score
 * et la recommandation sont RECALCULÉS par le moteur sans la marge (sinon la note de marge se
 * déduirait du score et un « no_go » trahirait une marge nulle ou négative) ; ni la marge, ni sa
 * cible, ni sa note, ni son éliminatoire, ni l'indicateur « marge renseignée » ne sont servis.
 */
export function vueEvaluation(ligne: Record<string, unknown>, voitFinance: boolean) {
  if (voitFinance) return ligne;
  const source = ligne.entrees as EntreesEvaluation;
  const entrees: Record<string, number> = { ...source };
  delete entrees.marge_estimee_bp;
  delete entrees.marge_cible_bp;
  const reste = { ...ligne };
  delete reste.marge_renseignee;
  const recalcul = evaluerGoNoGo({
    adequation: source.adequation,
    references: { pertinentes: source.references_pertinentes, exigees: source.references_exigees },
    charge: { joursDisponibles: source.jours_disponibles, joursRequis: source.jours_requis },
    marge: null,
    concurrence: { connus: source.concurrents_connus, forts: source.concurrents_forts },
  });
  return {
    ...reste,
    entrees,
    score: recalcul.score,
    recommandation: recalcul.recommandation,
    resultat: {
      criteres: recalcul.criteres.filter((c) => c.critere !== "marge"),
      eliminatoires: recalcul.eliminatoires,
      score: recalcul.score,
      recommandation: recalcul.recommandation,
    },
  };
}

const COLONNES_EVAL = `e.id, e.ao_id, e.numero, e.entrees, e.score, e.recommandation, e.resultat,
  e.marge_renseignee, e.auteur_id, u.nom AS auteur_nom, e.cree_le`;

export async function lireGoNoGo(db: Db, auth: Auth, aoId: string) {
  const voitFinance = aPermission(auth.roles, "finance.lire");
  const evaluations = await db.query(
    `SELECT ${COLONNES_EVAL} FROM ao_evaluations e JOIN utilisateurs u ON u.id = e.auteur_id
     WHERE e.ao_id = $1 ORDER BY e.numero DESC`,
    [aoId],
  );
  const decisions = await db.query(
    `SELECT d.id, d.evaluation_id, d.decision, d.motif, d.decideur_id, u.nom AS decideur_nom,
       d.cree_le
     FROM ao_decisions d JOIN utilisateurs u ON u.id = d.decideur_id
     WHERE d.ao_id = $1 ORDER BY d.cree_le DESC, d.id DESC`,
    [aoId],
  );
  return {
    evaluations: evaluations.rows.map((e) => vueEvaluation(e, voitFinance)),
    decisions: decisions.rows,
  };
}

/** Calcule et enregistre une évaluation go/no-go (fiche détectée ou en go/no-go). */
export async function evaluerFiche(db: Db, auth: Auth, aoId: string, corps: EvaluationGoNoGo) {
  const voitFinance = aPermission(auth.roles, "finance.lire");
  const marge = corps.marge_estimee_bp ?? null;
  if (marge !== null && !voitFinance) throw margeReservee();
  const fiche = await lireFiche(db, aoId, true);
  if (fiche.statut !== "detecte" && fiche.statut !== "go_no_go") {
    throw conflit("La décision go/no-go est déjà prise : aucune nouvelle évaluation.");
  }
  const rap = fiche.rapprochement as Rapprochement;
  const entrees = {
    adequation: corps.adequation ?? fiche.score_rapprochement,
    references_pertinentes: corps.references_pertinentes ?? rap.referencesSecteur,
    references_exigees: corps.references_exigees,
    jours_disponibles: corps.jours_disponibles,
    jours_requis: corps.jours_requis,
    concurrents_connus: corps.concurrents_connus,
    concurrents_forts: corps.concurrents_forts,
    ...(marge !== null ? { marge_estimee_bp: marge, marge_cible_bp: corps.marge_cible_bp } : {}),
  };
  const resultat = evaluerGoNoGo({
    adequation: entrees.adequation,
    references: {
      pertinentes: entrees.references_pertinentes,
      exigees: entrees.references_exigees,
    },
    charge: { joursDisponibles: entrees.jours_disponibles, joursRequis: entrees.jours_requis },
    marge: marge !== null ? { tauxBp: marge, cibleBp: corps.marge_cible_bp } : null,
    concurrence: { connus: entrees.concurrents_connus, forts: entrees.concurrents_forts },
  });
  const r = await db.query(
    `INSERT INTO ao_evaluations (cabinet_id, ao_id, numero, entrees, score, recommandation,
       resultat, marge_renseignee, auteur_id)
     SELECT $1, $2, coalesce(max(numero), 0) + 1, $3, $4, $5, $6, $7, $8
     FROM ao_evaluations WHERE ao_id = $2
     RETURNING id`,
    [
      auth.cabinetId,
      aoId,
      JSON.stringify(entrees),
      resultat.score,
      resultat.recommandation,
      JSON.stringify(resultat),
      marge !== null,
      auth.utilisateurId,
    ],
  );
  const id = r.rows[0].id as string;
  if (fiche.statut === "detecte") await changerStatut(db, auth, fiche, "go_no_go", null);
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "evaluation_go_no_go",
    entite: "appel_offres",
    entiteId: aoId,
    // Jamais la marge : score et recommandation seulement.
    details: { evaluation_id: id, score: resultat.score, recommandation: resultat.recommandation },
  });
  const ligne = await db.query(
    `SELECT ${COLONNES_EVAL} FROM ao_evaluations e JOIN utilisateurs u ON u.id = e.auteur_id
     WHERE e.id = $1`,
    [id],
  );
  return vueEvaluation(ligne.rows[0], voitFinance);
}

/** Décision go/no-go de l'associé, motivée, sur la DERNIÈRE évaluation. */
export async function deciderFiche(db: Db, auth: Auth, aoId: string, corps: DecisionGoNoGoCorps) {
  const fiche = await lireFiche(db, aoId, true);
  if (
    fiche.statut !== "go_no_go" &&
    !(fiche.statut === "en_reponse" && corps.decision === "no_go")
  ) {
    throw conflit(
      fiche.statut === "detecte"
        ? "Évaluez d'abord l'appel d'offres : la décision porte sur un score go/no-go."
        : "Aucune décision go/no-go n'est attendue pour cet appel d'offres.",
    );
  }
  const derniere = await db.query(
    "SELECT id FROM ao_evaluations WHERE ao_id = $1 ORDER BY numero DESC LIMIT 1",
    [aoId],
  );
  if (derniere.rows[0]?.id !== corps.evaluation_id) {
    throw new AppError(
      409,
      "AO_EVALUATION_PERIMEE",
      "La décision porte sur la dernière évaluation go/no-go : rechargez la fiche.",
    );
  }
  const r = await db.query(
    `INSERT INTO ao_decisions (cabinet_id, ao_id, evaluation_id, decision, motif, decideur_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, cree_le`,
    [auth.cabinetId, aoId, corps.evaluation_id, corps.decision, corps.motif, auth.utilisateurId],
  );
  await changerStatut(
    db,
    auth,
    fiche,
    corps.decision === "go" ? "en_reponse" : "no_go",
    corps.motif,
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "decision_go_no_go",
    entite: "appel_offres",
    entiteId: aoId,
    details: { decision_id: r.rows[0].id, decision: corps.decision },
  });
  return { id: r.rows[0].id as string, decision: corps.decision, statut: fiche.statut };
}
