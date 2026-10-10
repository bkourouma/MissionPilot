import {
  optimiserPortefeuille,
  POIDS_PORTEFEUILLE_DEFAUT,
  scorerInitiative,
  type CandidatPortefeuille,
  type PropositionPortefeuille,
} from "@missionpilot/engines";
import type {
  PlanArbitrage,
  PlanContraintesPortefeuille,
  PlanEvaluationPortefeuille,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { montant, traduireErreursPg } from "../db/outils.js";
import { AppError, conflit, introuvable, requeteInvalide } from "../errors.js";
import { decoderCurseur, paginer } from "../http/outils.js";
import { exigerPlanPilotable, exigerPlanRedigeable, exigerPlanVisible } from "./acces.js";
import { elementsCourants, type VersionDb } from "./elements.js";

/*
 * Priorisation du portefeuille d'initiatives (PLA-14).
 *
 * - Évaluation d'une initiative (« plan.ecrire », plan rédigeable) : valeur,
 *   effort, risque (1 à 5) et charge en jours-homme, en versions (0423).
 * - Candidates : initiatives actives du plan (ni retirées, ni terminées, ni
 *   abandonnées) ÉVALUÉES ; une initiative en cours est retenue d'office (déjà
 *   engagée) ; le coût est son budget (0180).
 * - Proposition (« plan.lire », sans écriture métier) : score et optimisation sous
 *   contraintes de budget et de capacité par le moteur (optimiserPortefeuille) ; au plus
 *   PROPOSITIONS_PORTEFEUILLE_PAR_FENETRE par utilisateur sur la fenêtre (429
 *   TROP_DE_PROPOSITIONS), comptées sur le journal d'audit.
 * - Arbitrage (« plan.valider » et responsable de la mission) : la proposition
 *   est RECALCULÉE ici avec les contraintes reçues, jamais reçue du navigateur ;
 *   chaque écart de la décision humaine exige un motif (400 MOTIF_REQUIS,
 *   doublé en base, MPS08) ; tout est figé dans `plan_portefeuille_arbitrages`
 *   (ajout seul) et journalisé.
 * Aucun chiffre n'est calculé ici : scores, totaux et sélection sortent du moteur.
 */

export const MOTEUR_PORTEFEUILLE = "engines/plan-strategique/portefeuille@1";

const STATUTS_HORS_PORTEFEUILLE = new Set(["terminee", "abandonnee"]);

interface Evaluation {
  initiative_id: string;
  version: number;
  valeur: number;
  effort: number;
  risque: number;
  charge_jours: number;
  commentaire: string | null;
  auteur_id: string;
  cree_le: string;
}

async function evaluationsCourantes(db: Db, planId: string): Promise<Map<string, Evaluation>> {
  const r = await db.query(
    `SELECT DISTINCT ON (initiative_id) initiative_id, version, valeur, effort, risque, charge_jours,
       commentaire, auteur_id, cree_le
     FROM plan_portefeuille_evaluations WHERE plan_id = $1
     ORDER BY initiative_id, version DESC`,
    [planId],
  );
  return new Map((r.rows as Evaluation[]).map((e) => [e.initiative_id, e]));
}

const actives = (elements: readonly VersionDb[]) =>
  elements.filter(
    (e) =>
      e.type === "initiative" &&
      !e.retire &&
      !STATUTS_HORS_PORTEFEUILLE.has(e.statut_initiative ?? ""),
  );

interface Etat {
  initiatives: VersionDb[];
  evaluations: Map<string, Evaluation>;
}

async function etatPortefeuille(db: Db, planId: string): Promise<Etat> {
  const initiatives = actives(await elementsCourants(db, planId));
  return { initiatives, evaluations: await evaluationsCourantes(db, planId) };
}

function vueInitiative(e: VersionDb, ev: Evaluation | undefined) {
  return {
    id: e.element_id,
    titre: String((e.contenu as { titre?: string }).titre ?? ""),
    statut: e.statut_initiative,
    statut_contenu: e.statut_contenu,
    budget: montant(e.budget),
    responsable_id: e.responsable_id,
    evaluation: ev
      ? {
          version: ev.version,
          valeur: ev.valeur,
          effort: ev.effort,
          risque: ev.risque,
          charge_jours: ev.charge_jours,
          commentaire: ev.commentaire,
          auteur_id: ev.auteur_id,
          cree_le: ev.cree_le,
          // Score aux poids par défaut, calculé par le moteur.
          score: scorerInitiative(ev),
        }
      : null,
  };
}

function vueProposition(p: PropositionPortefeuille) {
  return {
    decisions: p.decisions,
    retenues: p.retenues,
    totaux: p.totaux,
    realisable: p.realisable,
    optimal: p.optimal,
    noeuds_explores: p.noeudsExplores,
    poids: p.poids,
  };
}

/** Initiatives du portefeuille, évaluations courantes et dernier arbitrage. */
export async function lirePortefeuille(db: Db, auth: Auth, planId: string) {
  const plan = await exigerPlanVisible(db, auth, planId);
  const { initiatives, evaluations } = await etatPortefeuille(db, planId);
  const dernier = await db.query(
    `SELECT a.id, a.retenues, a.decide_par, u.nom AS decideur_nom, a.decide_le
     FROM plan_portefeuille_arbitrages a JOIN utilisateurs u ON u.id = a.decide_par
     WHERE a.plan_id = $1 ORDER BY a.decide_le DESC, a.id DESC LIMIT 1`,
    [planId],
  );
  return {
    plan_id: planId,
    devise: plan.devise,
    poids_defaut: POIDS_PORTEFEUILLE_DEFAUT,
    initiatives: initiatives.map((e) => vueInitiative(e, evaluations.get(e.element_id))),
    dernier_arbitrage: dernier.rows[0] ?? null,
  };
}

/** Nouvelle évaluation d'une initiative active du plan. */
export async function evaluerInitiative(
  db: Db,
  auth: Auth,
  planId: string,
  elementId: string,
  corps: PlanEvaluationPortefeuille,
) {
  await exigerPlanRedigeable(db, auth, planId);
  const { initiatives, evaluations } = await etatPortefeuille(db, planId);
  const initiative = initiatives.find((e) => e.element_id === elementId.toLowerCase());
  if (!initiative) throw introuvable("Initiative active du plan");
  const courante = evaluations.get(initiative.element_id);
  const commentaire = corps.commentaire ?? null;
  if (
    courante &&
    courante.valeur === corps.valeur &&
    courante.effort === corps.effort &&
    courante.risque === corps.risque &&
    courante.charge_jours === corps.charge_jours &&
    courante.commentaire === commentaire
  ) {
    throw conflit("Évaluation identique à la courante.");
  }
  const version = (courante?.version ?? 0) + 1;
  await traduireErreursPg(
    db.query(
      `INSERT INTO plan_portefeuille_evaluations (cabinet_id, plan_id, initiative_id, version, valeur,
         effort, risque, charge_jours, commentaire, auteur_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        auth.cabinetId,
        planId,
        initiative.element_id,
        version,
        corps.valeur,
        corps.effort,
        corps.risque,
        corps.charge_jours,
        commentaire,
        auth.utilisateurId,
      ],
    ),
    {
      plan_portefeuille_evaluations_initiative_id_version_key:
        "L'évaluation vient d'être modifiée : rechargez la page.",
    },
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "plan.portefeuille.evaluer",
    entite: "plan_element",
    entiteId: initiative.element_id,
    details: { plan_id: planId, version },
  });
  const apres = await evaluationsCourantes(db, planId);
  return vueInitiative(initiative, apres.get(initiative.element_id));
}

/** Candidats du moteur ; 400 si une initiative citée n'est pas une candidate (active, évaluée). */
function candidats(etat: Etat, c: PlanContraintesPortefeuille) {
  const evaluees = etat.initiatives.filter((e) => etat.evaluations.has(e.element_id));
  const ids = new Set(evaluees.map((e) => e.element_id));
  const obligatoires = new Set(c.obligatoires.map((x) => x.toLowerCase()));
  const exclues = new Set(c.exclues.map((x) => x.toLowerCase()));
  if ([...obligatoires, ...exclues].some((x) => !ids.has(x))) {
    throw requeteInvalide("Obligatoires et exclues : initiatives actives et évaluées du plan.");
  }
  const liste: CandidatPortefeuille[] = evaluees.map((e) => {
    const ev = etat.evaluations.get(e.element_id) as Evaluation;
    return {
      id: e.element_id,
      valeur: ev.valeur,
      effort: ev.effort,
      risque: ev.risque,
      cout: montant(e.budget) ?? 0,
      charge: ev.charge_jours,
      // Une initiative en cours est déjà engagée : retenue d'office.
      obligatoire: obligatoires.has(e.element_id) || e.statut_initiative === "en_cours",
      exclue: exclues.has(e.element_id),
      dependances: (e.contenu.dependances as string[] | undefined) ?? [],
    };
  });
  return {
    liste,
    nonEvaluees: etat.initiatives.filter((e) => !ids.has(e.element_id)).map((e) => e.element_id),
  };
}

function proposer(etat: Etat, c: PlanContraintesPortefeuille) {
  const { liste, nonEvaluees } = candidats(etat, c);
  const proposition = optimiserPortefeuille(liste, {
    budgetMax: c.budget_max,
    capaciteMax: c.capacite_max,
    poids: c.poids ?? POIDS_PORTEFEUILLE_DEFAUT,
  });
  return { proposition, nonEvaluees };
}

/** Propositions admises par utilisateur sur la fenêtre glissante (à calibrer au pilote). */
export const PROPOSITIONS_PORTEFEUILLE_PAR_FENETRE = 30;
export const FENETRE_PROPOSITIONS_MINUTES = 10;
const ACTION_PROPOSITION = "proposition_portefeuille";

/**
 * 429 si l'utilisateur a déjà demandé PROPOSITIONS_PORTEFEUILLE_PAR_FENETRE propositions sur la
 * fenêtre : le calcul d'optimisation sous contraintes coûte au serveur et la route est ouverte à
 * tout lecteur du plan. Le débit se compte sur les lignes du journal (modèle :
 * routes/factures-pdf.ts), contrôlé avant le calcul ; un calcul refusé ne compte pas.
 */
export async function verifierDebitPropositions(db: Db, auth: Auth): Promise<void> {
  const r = await db.query(
    `SELECT count(*)::int AS n FROM journal_audit
     WHERE utilisateur_id = $1 AND action = $2 AND cree_le > now() - make_interval(mins => $3)`,
    [auth.utilisateurId, ACTION_PROPOSITION, FENETRE_PROPOSITIONS_MINUTES],
  );
  if ((r.rows[0].n as number) >= PROPOSITIONS_PORTEFEUILLE_PAR_FENETRE) {
    throw new AppError(
      429,
      "TROP_DE_PROPOSITIONS",
      `Au plus ${PROPOSITIONS_PORTEFEUILLE_PAR_FENETRE} propositions de portefeuille par ${FENETRE_PROPOSITIONS_MINUTES} minutes : réessayez plus tard.`,
    );
  }
}

/** Proposition du moteur, sans écriture métier (une ligne de journal alimente le plafond de débit). */
export async function proposerPortefeuille(
  db: Db,
  auth: Auth,
  planId: string,
  contraintes: PlanContraintesPortefeuille,
) {
  await exigerPlanVisible(db, auth, planId);
  await verifierDebitPropositions(db, auth);
  const { proposition, nonEvaluees } = proposer(await etatPortefeuille(db, planId), contraintes);
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: ACTION_PROPOSITION,
    entite: "plan",
    entiteId: planId,
  });
  return {
    plan_id: planId,
    moteur: MOTEUR_PORTEFEUILLE,
    contraintes,
    proposition: vueProposition(proposition),
    non_evaluees: nonEvaluees,
  };
}

/** Arbitrage humain tracé : proposition recalculée, écarts motivés, enregistrement figé. */
export async function arbitrerPortefeuille(
  db: Db,
  auth: Auth,
  planId: string,
  corps: PlanArbitrage,
) {
  await exigerPlanPilotable(db, auth, planId);
  const etat = await etatPortefeuille(db, planId);
  const { proposition, nonEvaluees } = proposer(etat, corps.contraintes);
  const candidates = new Set(proposition.decisions.map((d) => d.id));
  const retenues = corps.retenues.map((x) => x.toLowerCase());
  if (retenues.some((x) => !candidates.has(x))) {
    throw requeteInvalide("Seules des initiatives actives et évaluées du plan se retiennent.");
  }
  const proposees = new Set(proposition.retenues);
  const choisies = new Set(retenues);
  const motifs = new Map(corps.motifs.map((m) => [m.initiative_id.toLowerCase(), m.motif]));
  const ecarts = [...candidates].filter((id) => proposees.has(id) !== choisies.has(id));
  const manquants = ecarts.filter((id) => !motifs.get(id));
  if (manquants.length) {
    throw new AppError(
      400,
      "MOTIF_REQUIS",
      "Chaque écart à la proposition du moteur exige un motif.",
      { manquants },
    );
  }
  const motifsEcarts = ecarts.map((id) => ({ initiative_id: id, motif: motifs.get(id) as string }));
  const r = await db.query(
    `INSERT INTO plan_portefeuille_arbitrages (cabinet_id, plan_id, contraintes, proposition, retenues,
       motifs, commentaire, moteur, decide_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, decide_le`,
    [
      auth.cabinetId,
      planId,
      JSON.stringify(corps.contraintes),
      JSON.stringify(vueProposition(proposition)),
      JSON.stringify(retenues),
      JSON.stringify(motifsEcarts),
      corps.commentaire ?? null,
      MOTEUR_PORTEFEUILLE,
      auth.utilisateurId,
    ],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "plan.portefeuille.arbitrer",
    entite: "plan_strategique",
    entiteId: planId,
    details: { arbitrage_id: r.rows[0].id, retenues: retenues.length, ecarts: ecarts.length },
  });
  return {
    id: r.rows[0].id as string,
    plan_id: planId,
    decide_le: r.rows[0].decide_le,
    contraintes: corps.contraintes,
    proposition: vueProposition(proposition),
    retenues,
    motifs: motifsEcarts,
    non_evaluees: nonEvaluees,
  };
}

/** Historique des arbitrages, du plus récent au plus ancien. */
export async function listerArbitrages(
  db: Db,
  auth: Auth,
  planId: string,
  q: { limite: number; curseur?: string | undefined },
) {
  await exigerPlanVisible(db, auth, planId);
  const apres = decoderCurseur(q.curseur);
  const r = await db.query(
    `SELECT lpad(((extract(epoch FROM a.decide_le) * 1000000)::bigint)::text, 17, '0') AS cle_tri,
       a.id, a.contraintes, a.proposition, a.retenues, a.motifs, a.commentaire, a.moteur,
       a.decide_par, u.nom AS decideur_nom, a.decide_le
     FROM plan_portefeuille_arbitrages a JOIN utilisateurs u ON u.id = a.decide_par
     WHERE a.plan_id = $1
       AND ($2::text IS NULL
            OR (lpad(((extract(epoch FROM a.decide_le) * 1000000)::bigint)::text, 17, '0'), a.id)
               < ($2, $3::uuid))
     ORDER BY a.decide_le DESC, a.id DESC LIMIT $4`,
    [planId, apres?.[0] ?? null, apres?.[1] ?? null, q.limite + 1],
  );
  return paginer(r.rows as { cle_tri: string; id: string }[], q.limite);
}
