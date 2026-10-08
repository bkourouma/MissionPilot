import {
  classeRisqueMax,
  estClasseRisque,
  evaluerPromotion,
  niveauEffectif,
  rangClasseRisque,
  rangNiveauAutonomie,
  retrogradationAuto,
  SEUILS_PROMOTION_AUTONOMIE_DEFAUT,
  statistiquesAutonomie,
  type ClasseRisque,
  type EvaluationPromotion,
  type NiveauAutonomie,
  type NiveauEffectif,
  type RaisonRefusPromotion,
  type StatistiquesAutonomie,
} from "@missionpilot/engines";
import {
  aPermission,
  type BriqueAgentCreation,
  type DecisionAutonomie,
  type GraviteIncidentAutonomieApi,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { interdit, introuvable } from "../errors.js";
import { decoderCurseur, paginer } from "../http/outils.js";
import {
  actionReservee,
  agentInactif,
  avecErreursAgents,
  briqueExiste,
  classeSousPlancher,
  coupeCircuitInchange,
  niveauInchange,
  plafondAgent,
  plafondBrique,
  promotionNonEligible,
  promotionParPalier,
} from "./erreurs.js";
import { lireAgent, niveauMin, type AgentCabinet } from "./registre.js";

/*
 * Autonomie de l'IA par brique et par cabinet (AGT-03, migration 0262).
 *
 * - Niveau ACCORDÉ : dernier événement de la brique (ajout seul).
 * - Niveau EFFECTIF : moteur pur `niveauEffectif(plafond, accordé, classe,
 *   { coupeCircuitN4 })`, le plafond étant le plus bas de celui de la brique et
 *   de celui de l'agent pour le cabinet (désactivé → N0).
 * - Éligibilité : moteur pur (`statistiquesAutonomie`, `evaluerPromotion`) sur
 *   les exécutions DÉCIDÉES depuis le passage au niveau actuel et les incidents
 *   des 90 derniers jours. N3 → N4 applique les mêmes critères au niveau N3,
 *   plus classe R0 et plafond N4 (DECISIONS.md, 2026-10-08).
 * - Une promotion en N3 ou N4 est une DÉCISION d'associé (`autonomie.decider`,
 *   doublée en base, MPG03), motivée et journalisée ; une hausse jusqu'à N2 (le
 *   contenu reste validé par un humain) se décide sans critère d'éligibilité.
 * - Un incident MAJEUR rétrograde automatiquement N3 ou N4 en N2 (moteur
 *   `retrogradationAuto`), sans intervention humaine, journalisé ; le signaler
 *   exige `agent.gerer` ou `autonomie.decider` (un incident mineur reste ouvert à
 *   `agent.lire`).
 * - Les exécutions en MODE DÉGRADÉ (gabarit déterministe, aucun modèle) ne
 *   comptent pas pour l'éligibilité : elles ne mesurent pas l'agent.
 * - Classe de risque d'une brique : jamais sous le PLANCHER de la méthode (classe
 *   la plus haute des briques du référentiel de même code, moteur `qualite`
 *   `classeRisqueMax`) ; une brique R0 (seule à pouvoir aller jusqu'à N4) est
 *   déclarée par un associé (`autonomie.decider`). Doublé en base (0267, MPG07).
 */

export interface BriqueDb {
  id: string;
  brique_code: string;
  agent_code: string;
  classe_risque: ClasseRisque;
  niveau_max: NiveauAutonomie;
  cree_par: string;
  cree_le: string;
  niveau_accorde: NiveauAutonomie;
  /** Date du passage au niveau accordé. */
  depuis: Date;
}

const COLONNES_BRIQUE = `b.id, b.brique_code, b.agent_code, b.classe_risque, b.niveau_max, b.cree_par,
  b.cree_le, e.niveau_apres AS niveau_accorde, e.cree_le AS depuis`;
const DEPUIS_BRIQUE = `agents_briques b
  JOIN LATERAL (SELECT niveau_apres, cree_le FROM autonomie_evenements v WHERE v.brique_id = b.id
    ORDER BY v.id DESC LIMIT 1) e ON true`;

export async function lireBrique(db: Db, code: string, verrouiller = false): Promise<BriqueDb> {
  if (verrouiller) {
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      `agents_brique:${code}`,
    ]);
  }
  const r = await db.query(
    `SELECT ${COLONNES_BRIQUE} FROM ${DEPUIS_BRIQUE} WHERE b.brique_code = $1`,
    [code],
  );
  if (!r.rows[0]) throw introuvable("Brique");
  return r.rows[0] as BriqueDb;
}

export async function lireBriqueParId(db: Db, id: string): Promise<BriqueDb | null> {
  const r = await db.query(`SELECT ${COLONNES_BRIQUE} FROM ${DEPUIS_BRIQUE} WHERE b.id = $1`, [id]);
  return (r.rows[0] as BriqueDb | undefined) ?? null;
}

/* ----- Coupe-circuit N4 ----- */

export interface CoupeCircuit {
  actif: boolean;
  motif: string | null;
  auteur_id: string | null;
  modifie_le: string | null;
}

export async function lireCoupeCircuit(db: Db): Promise<CoupeCircuit> {
  const r = await db.query(
    "SELECT actif, motif, auteur_id, cree_le FROM autonomie_coupe_circuit ORDER BY id DESC LIMIT 1",
  );
  const l = r.rows[0];
  return l
    ? { actif: l.actif, motif: l.motif, auteur_id: l.auteur_id, modifie_le: l.cree_le }
    : { actif: false, motif: null, auteur_id: null, modifie_le: null };
}

/**
 * Coupe-circuit N4 du cabinet. L'activer (couper) : `agent.gerer` ou `autonomie.decider` ;
 * le lever : `autonomie.decider` seulement (associé, doublé en base).
 */
export async function changerCoupeCircuit(
  db: Db,
  auth: Auth,
  demande: { actif: boolean; motif: string },
): Promise<CoupeCircuit> {
  const decide = aPermission(auth.roles, "autonomie.decider");
  if (demande.actif ? !(decide || aPermission(auth.roles, "agent.gerer")) : !decide) {
    throw interdit();
  }
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `agents_coupe_circuit:${auth.cabinetId}`,
  ]);
  if ((await lireCoupeCircuit(db)).actif === demande.actif) throw coupeCircuitInchange();
  await avecErreursAgents(() =>
    db.query(
      `INSERT INTO autonomie_coupe_circuit (cabinet_id, actif, motif, auteur_id)
       VALUES ($1, $2, $3, $4)`,
      [auth.cabinetId, demande.actif, demande.motif, auth.utilisateurId],
    ),
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: demande.actif ? "coupe_circuit_n4_active" : "coupe_circuit_n4_leve",
    entite: "autonomie_coupe_circuit",
    entiteId: null,
    details: { motif: demande.motif },
  });
  return lireCoupeCircuit(db);
}

/* ----- Niveau effectif ----- */

export interface EtatAutonomie {
  niveau_accorde: NiveauAutonomie;
  /** Plus bas du plafond de la brique et de celui de l'agent pour le cabinet. */
  plafond: NiveauAutonomie;
  niveau_effectif: NiveauEffectif["niveau"];
  raisons: NiveauEffectif["raisons"];
  coupe_circuit_n4: boolean;
}

export function etatAutonomie(
  brique: BriqueDb,
  agent: AgentCabinet,
  coupe: Pick<CoupeCircuit, "actif">,
): EtatAutonomie {
  const plafond = niveauMin(brique.niveau_max, agent.niveau_max);
  const e = niveauEffectif(plafond, brique.niveau_accorde, brique.classe_risque, {
    coupeCircuitN4: coupe.actif,
  });
  return {
    niveau_accorde: brique.niveau_accorde,
    plafond,
    niveau_effectif: e.niveau,
    raisons: e.raisons,
    coupe_circuit_n4: coupe.actif,
  };
}

/* ----- Statistiques et éligibilité ----- */

const jourIso = (d: Date | string) => new Date(d).toISOString().slice(0, 10);

export interface Eligibilite {
  statistiques: StatistiquesAutonomie;
  evaluation: EvaluationPromotion;
  /** Niveau qu'une décision pourrait accorder ensuite (null au plafond). */
  niveau_suivant: NiveauAutonomie | null;
  /** Le niveau suivant exige les critères d'éligibilité (N3, N4). */
  criteres_requis: boolean;
}

const SUIVANT: Record<NiveauAutonomie, NiveauAutonomie | null> = {
  N0: "N1",
  N1: "N2",
  N2: "N3",
  N3: "N4",
  N4: null,
};

/** Statistiques et éligibilité à la promotion d'une brique à la date `maintenant`. */
export async function eligibilite(
  db: Db,
  brique: BriqueDb,
  plafond: NiveauAutonomie,
  maintenant: Date,
): Promise<Eligibilite> {
  const fenetre = SEUILS_PROMOTION_AUTONOMIE_DEFAUT.fenetreIncidentsJours;
  const ex = await db.query(
    `SELECT e.cree_le, d.decision FROM agents_executions e
     JOIN agents_execution_decisions d ON d.execution_id = e.id
     WHERE e.brique_id = $1 AND e.cree_le >= $2 AND NOT e.mode_degrade`,
    [brique.id, brique.depuis],
  );
  const inc = await db.query(
    "SELECT gravite, cree_le FROM autonomie_incidents WHERE brique_id = $1 AND cree_le >= $2",
    [brique.id, new Date(maintenant.getTime() - (fenetre + 1) * 86_400_000)],
  );
  const statistiques = statistiquesAutonomie({
    niveauActuel: brique.niveau_accorde,
    niveauMaxBrique: plafond,
    executions: ex.rows.map((x) => ({
      date: jourIso(x.cree_le),
      acceptee: x.decision !== "rejetee",
      modificationMajeure: x.decision === "modifiee",
    })),
    incidents: inc.rows.map((x) => ({ date: jourIso(x.cree_le), gravite: x.gravite })),
    dateReference: jourIso(maintenant),
  });
  const suivant = SUIVANT[brique.niveau_accorde];
  let evaluation = evaluerPromotion(statistiques);
  if (brique.niveau_accorde === "N3") {
    // N3 → N4 : mêmes critères au niveau N3, puis plafond N4 et classe R0.
    const base = evaluerPromotion({ ...statistiques, niveauActuel: "N2" });
    const raisons: RaisonRefusPromotion[] = base.raisons.filter((r) => r !== "PLAFOND_BRIQUE");
    if (rangNiveauAutonomie(plafond) < rangNiveauAutonomie("N4")) raisons.push("PLAFOND_BRIQUE");
    const r0 = brique.classe_risque === "R0";
    const eligible = raisons.length === 0 && r0;
    evaluation = {
      ...base,
      niveauActuel: "N3",
      eligible,
      niveauPropose: eligible ? "N4" : null,
      raisons: r0 ? raisons : [...raisons, "PLAFOND_BRIQUE"],
    };
  }
  return {
    statistiques,
    evaluation,
    niveau_suivant: suivant,
    criteres_requis: suivant !== null && rangNiveauAutonomie(suivant) >= 3,
  };
}

/* ----- Déclaration d'une brique ----- */

/** Plancher de classe de risque d'une brique : classe la plus haute des briques de méthode du code. */
export async function plancherClasseBrique(db: Db, code: string): Promise<ClasseRisque | null> {
  const r = await db.query("SELECT classe_risque FROM methode_briques WHERE code = $1", [code]);
  return classeRisqueMax(r.rows.map((l) => l.classe_risque as unknown).filter(estClasseRisque));
}

/** Confie une brique à un agent ; niveau initial : N2 au plus (validation humaine). */
export async function declarerBrique(
  db: Db,
  auth: Auth,
  b: BriqueAgentCreation,
): Promise<BriqueDb> {
  if (b.classe_risque === "R0" && !aPermission(auth.roles, "autonomie.decider")) {
    throw actionReservee("Une brique R0 (jusqu'à N4) est déclarée par un associé.");
  }
  const plancher = await plancherClasseBrique(db, b.brique_code);
  if (plancher && rangClasseRisque(b.classe_risque) < rangClasseRisque(plancher)) {
    throw classeSousPlancher(plancher);
  }
  const agent = await lireAgent(db, b.agent_code);
  if (!agent.actif) throw agentInactif();
  if (rangNiveauAutonomie(b.niveau_max) > rangNiveauAutonomie(agent.niveau_max)) {
    throw plafondAgent();
  }
  const existe = await db.query("SELECT 1 FROM agents_briques WHERE brique_code = $1", [
    b.brique_code,
  ]);
  if (existe.rows[0]) throw briqueExiste();
  const id = await avecErreursAgents(async () => {
    const r = await db.query(
      `INSERT INTO agents_briques (cabinet_id, brique_code, agent_code, classe_risque, niveau_max, cree_par)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        auth.cabinetId,
        b.brique_code,
        b.agent_code,
        b.classe_risque,
        b.niveau_max,
        auth.utilisateurId,
      ],
    );
    const brique = r.rows[0].id as string;
    await db.query(
      `INSERT INTO autonomie_evenements (cabinet_id, brique_id, type, niveau_apres, motif, auteur_id)
       VALUES ($1, $2, 'initial', $3, 'Déclaration de la brique.', $4)`,
      [auth.cabinetId, brique, niveauMin(b.niveau_max, "N2"), auth.utilisateurId],
    );
    return brique;
  });
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "declaration_brique_agent",
    entite: "agent_brique",
    entiteId: id,
    details: { ...b },
  });
  return lireBrique(db, b.brique_code);
}

/** Briques du cabinet, par code, paginées par curseur. */
export async function listerBriques(
  db: Db,
  q: { limite: number; curseur?: string | undefined },
): Promise<{ elements: BriqueDb[]; curseur_suivant: string | null }> {
  const apres = decoderCurseur(q.curseur);
  const r = await db.query(
    `SELECT ${COLONNES_BRIQUE}, b.brique_code AS cle_tri FROM ${DEPUIS_BRIQUE}
     WHERE ($1::text IS NULL OR (b.brique_code, b.id) > ($1, $2::uuid))
     ORDER BY b.brique_code, b.id LIMIT $3`,
    [apres?.[0] ?? null, apres?.[1] ?? null, q.limite + 1],
  );
  const page = paginer(r.rows as (BriqueDb & { cle_tri: string })[], q.limite);
  return { elements: page.elements as BriqueDb[], curseur_suivant: page.curseur_suivant };
}

/* ----- Décision d'un associé ----- */

/** Nouveau niveau accordé (autonomie.decider) : hausse palier par palier, baisse libre. */
export async function deciderAutonomie(
  db: Db,
  auth: Auth,
  code: string,
  d: DecisionAutonomie,
  maintenant: Date,
): Promise<BriqueDb> {
  const brique = await lireBrique(db, code, true);
  const agent = await lireAgent(db, brique.agent_code);
  const plafond = niveauMin(brique.niveau_max, agent.niveau_max);
  const avant = brique.niveau_accorde;
  if (d.niveau === avant) throw niveauInchange();
  const hausse = rangNiveauAutonomie(d.niveau) > rangNiveauAutonomie(avant);
  let evaluation: EvaluationPromotion | null = null;
  if (hausse) {
    if (rangNiveauAutonomie(d.niveau) !== rangNiveauAutonomie(avant) + 1)
      throw promotionParPalier();
    if (rangNiveauAutonomie(d.niveau) > rangNiveauAutonomie(plafond)) throw plafondBrique();
    if (rangNiveauAutonomie(d.niveau) >= 3) {
      evaluation = (await eligibilite(db, brique, plafond, maintenant)).evaluation;
      if (!evaluation.eligible) throw promotionNonEligible(evaluation.raisons);
    }
  }
  await avecErreursAgents(() =>
    db.query(
      `INSERT INTO autonomie_evenements (cabinet_id, brique_id, type, niveau_avant, niveau_apres,
         motif, auteur_id, evaluation)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        auth.cabinetId,
        brique.id,
        hausse ? "promotion" : "abaissement",
        avant,
        d.niveau,
        d.motif,
        auth.utilisateurId,
        evaluation ? JSON.stringify(evaluation) : null,
      ],
    ),
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: hausse ? "promotion_autonomie_ia" : "abaissement_autonomie_ia",
    entite: "agent_brique",
    entiteId: brique.id,
    details: { brique: code, avant, apres: d.niveau, motif: d.motif },
  });
  return lireBrique(db, code);
}

/* ----- Incidents et rétrogradation automatique ----- */

export interface ResultatIncident {
  incident_id: string;
  retrograde: boolean;
  niveau_avant: NiveauAutonomie;
  niveau_apres: NiveauAutonomie;
}

/**
 * Incident sur une brique ; un incident majeur (agent.gerer ou autonomie.decider) ramène N3 ou
 * N4 à N2, sans décision humaine. L'exécution citée est vérifiée VISIBLE par l'appelant (route).
 */
export async function signalerIncident(
  db: Db,
  auth: Auth,
  code: string,
  i: {
    gravite: GraviteIncidentAutonomieApi;
    description: string;
    execution_id?: string | undefined;
  },
): Promise<ResultatIncident> {
  if (
    i.gravite === "majeur" &&
    !aPermission(auth.roles, "agent.gerer") &&
    !aPermission(auth.roles, "autonomie.decider")
  ) {
    throw interdit();
  }
  const brique = await lireBrique(db, code, true);
  const incidentId = await avecErreursAgents(async () => {
    const r = await db.query(
      `INSERT INTO autonomie_incidents (cabinet_id, brique_id, gravite, description, execution_id,
         signale_par) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        auth.cabinetId,
        brique.id,
        i.gravite,
        i.description,
        i.execution_id ?? null,
        auth.utilisateurId,
      ],
    );
    return r.rows[0].id as string;
  });
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "incident_agent_ia",
    entite: "agent_brique",
    entiteId: brique.id,
    details: { brique: code, gravite: i.gravite, incident_id: incidentId },
  });
  const r = retrogradationAuto({ niveauActuel: brique.niveau_accorde, gravite: i.gravite });
  if (r.retrograde) {
    await avecErreursAgents(() =>
      db.query(
        `INSERT INTO autonomie_evenements (cabinet_id, brique_id, type, niveau_avant, niveau_apres,
           motif, incident_id)
         VALUES ($1, $2, 'retrogradation_auto', $3, $4, 'Incident majeur : rétrogradation automatique.', $5)`,
        [auth.cabinetId, brique.id, r.niveauAvant, r.niveauApres, incidentId],
      ),
    );
    await journaliser(db, {
      cabinetId: auth.cabinetId,
      utilisateurId: null,
      action: "retrogradation_autonomie_ia",
      entite: "agent_brique",
      entiteId: brique.id,
      details: {
        brique: code,
        avant: r.niveauAvant,
        apres: r.niveauApres,
        incident_id: incidentId,
      },
    });
  }
  return {
    incident_id: incidentId,
    retrograde: r.retrograde,
    niveau_avant: r.niveauAvant,
    niveau_apres: r.niveauApres,
  };
}

/** Éléments d'historique servis au plus (les plus récents) ; la troncature est signalée. */
export const HISTORIQUE_BRIQUE_MAX = 100;

/** Historique d'une brique : événements de niveau et incidents (les plus récents d'abord). */
export async function historiqueBrique(db: Db, brique: BriqueDb) {
  const ev = await db.query(
    `SELECT v.id, v.type, v.niveau_avant, v.niveau_apres, v.motif, v.auteur_id, u.nom AS auteur_nom,
       v.incident_id, v.evaluation, v.cree_le
     FROM autonomie_evenements v LEFT JOIN utilisateurs u ON u.id = v.auteur_id
     WHERE v.brique_id = $1 ORDER BY v.id DESC LIMIT $2`,
    [brique.id, HISTORIQUE_BRIQUE_MAX + 1],
  );
  const inc = await db.query(
    `SELECT i.id, i.gravite, i.description, i.execution_id, i.signale_par, u.nom AS signale_par_nom,
       i.cree_le
     FROM autonomie_incidents i JOIN utilisateurs u ON u.id = i.signale_par
     WHERE i.brique_id = $1 ORDER BY i.cree_le DESC, i.id DESC LIMIT $2`,
    [brique.id, HISTORIQUE_BRIQUE_MAX + 1],
  );
  return {
    evenements: ev.rows.slice(0, HISTORIQUE_BRIQUE_MAX),
    incidents: inc.rows.slice(0, HISTORIQUE_BRIQUE_MAX),
    tronque: ev.rows.length > HISTORIQUE_BRIQUE_MAX || inc.rows.length > HISTORIQUE_BRIQUE_MAX,
  };
}
