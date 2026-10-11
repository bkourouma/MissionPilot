import { rangNiveauAutonomie, type NiveauAutonomie } from "@missionpilot/engines";
import {
  FENETRE_MESSAGES_COPILOTE_MINUTES,
  MESSAGES_COPILOTE_PAR_FENETRE,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { lireAgent } from "../agents/registre.js";
import {
  copiloteActionNonAutorisee,
  copiloteDesactive,
  tropDeMessagesCopilote,
} from "./erreurs.js";

/** Action du journal qui sert de compteur de débit (modèle : routes/factures-pdf.ts). */
export const ACTION_MESSAGE_COPILOTE = "copilote.message";

/**
 * Plafond de débit : au plus MESSAGES_COPILOTE_PAR_FENETRE messages par utilisateur sur
 * FENETRE_MESSAGES_COPILOTE_MINUTES minutes (429 sinon). Le message est compté ICI, sous un verrou
 * propre à l'utilisateur et dans la transaction qui l'inscrit au journal : deux messages
 * simultanés ne dépassent pas la limite. Le journal ne contient jamais le texte du message.
 */
export async function compterMessage(db: Db, auth: Auth, longueur: number): Promise<void> {
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `copilote_debit:${auth.utilisateurId}`,
  ]);
  const r = await db.query(
    `SELECT count(*)::int AS n FROM journal_audit
     WHERE utilisateur_id = $1 AND action = $2 AND cree_le > now() - make_interval(mins => $3)`,
    [auth.utilisateurId, ACTION_MESSAGE_COPILOTE, FENETRE_MESSAGES_COPILOTE_MINUTES],
  );
  if ((r.rows[0].n as number) >= MESSAGES_COPILOTE_PAR_FENETRE) throw tropDeMessagesCopilote();
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: ACTION_MESSAGE_COPILOTE,
    entite: "copilote",
    details: { longueur },
  });
}

/** Action du journal qui sert de compteur de débit de l'outil « KPI au rouge ». */
export const ACTION_KPI_ROUGES_COPILOTE = "copilote.kpi_rouges";
/** Plafond propre à l'outil « KPI au rouge » : 5 évaluations par 10 minutes et par utilisateur (à valider). */
export const KPI_ROUGES_PAR_FENETRE = 5;
export const FENETRE_KPI_ROUGES_MINUTES = 10;
export const MESSAGE_KPI_ROUGES_LIMITE = `Cette analyse est limitée à ${KPI_ROUGES_PAR_FENETRE} demandes par ${FENETRE_KPI_ROUGES_MINUTES} minutes : réessayez plus tard.`;

/**
 * Plafond de débit de l'outil « KPI au rouge » : il évalue le tableau de bord de jusqu'à
 * MISSIONS_KPI_MAX missions par message, bien plus qu'une lecture ordinaire. Comme le débit général,
 * le compte vient du journal et se prend sous un verrou propre à l'utilisateur, dans la transaction
 * qui inscrit la demande. Renvoie false (rien n'est évalué) quand le plafond est atteint : la
 * réponse du copilote le dit en français plutôt que de lever une erreur.
 */
export async function compterKpiRouges(db: Db, auth: Auth): Promise<boolean> {
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `copilote_kpi_debit:${auth.utilisateurId}`,
  ]);
  const r = await db.query(
    `SELECT count(*)::int AS n FROM journal_audit
     WHERE utilisateur_id = $1 AND action = $2 AND cree_le > now() - make_interval(mins => $3)`,
    [auth.utilisateurId, ACTION_KPI_ROUGES_COPILOTE, FENETRE_KPI_ROUGES_MINUTES],
  );
  if ((r.rows[0].n as number) >= KPI_ROUGES_PAR_FENETRE) return false;
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: ACTION_KPI_ROUGES_COPILOTE,
    entite: "copilote",
    details: {},
  });
  return true;
}

/** Code de l'agent « copilote » du registre (migration 0260). */
export const CODE_AGENT_COPILOTE = "copilote";

/**
 * Niveau d'autonomie MINIMAL pour proposer et confirmer une action modifiante : N2 (la proposition
 * est le brouillon, la confirmation de l'utilisateur la validation humaine). La lecture reste permise
 * dès N1. Un cabinet qui plafonne l'agent « copilote » à N1 interdit donc toute écriture.
 */
export const NIVEAU_MIN_ACTION_COPILOTE: NiveauAutonomie = "N2";

/**
 * Coupe-circuit du cabinet : l'agent « copilote » désactivé, ou plafonné à N0, arrête le
 * copilote (409). Pour une ACTION (proposition ou confirmation), le niveau maximal effectif de
 * l'agent doit en plus atteindre N2 (409 « action non autorisée »). L'activation de l'IA
 * (paramètres IA) est un coupe-circuit distinct : elle ne gouverne que l'appel au modèle ; sans
 * elle, le copilote répond en mode sans IA.
 */
export async function exigerCopiloteActif(
  db: Db,
  usage: "lecture" | "action" = "lecture",
): Promise<void> {
  const agent = await lireAgent(db, CODE_AGENT_COPILOTE);
  if (!agent.actif || agent.niveau_max === "N0") throw copiloteDesactive();
  if (
    usage === "action" &&
    rangNiveauAutonomie(agent.niveau_max) < rangNiveauAutonomie(NIVEAU_MIN_ACTION_COPILOTE)
  ) {
    throw copiloteActionNonAutorisee();
  }
}
