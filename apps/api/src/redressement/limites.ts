import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError } from "../errors.js";

/*
 * Plafonds de débit (SPEC-3a §9.5) : comptés sur `journal_audit` dans la transaction qui inscrit
 * l'écriture, sous verrou consultatif propre à l'utilisateur et à l'action (modèles
 * copilote/limites.ts, routes/factures-pdf.ts). Valeurs PROVISOIRES (DECISIONS.md), à calibrer.
 */

export interface PlafondDebit {
  /** Entité et action de la ligne de journal qui compte (celle de l'écriture elle-même). */
  entite: string;
  action: string;
  maximum: number;
  fenetreMinutes: number;
  code: string;
  message: string;
}

export const DEBIT_URGENCES: PlafondDebit = {
  entite: "red_urgence",
  action: "urgence",
  maximum: 30,
  fenetreMinutes: 10,
  code: "RED_TROP_D_EVALUATIONS",
  message: "Au plus 30 évaluations d'urgence par 10 minutes : réessayez plus tard.",
};

export const DEBIT_SCORES: PlafondDebit = {
  entite: "red_score",
  action: "score",
  maximum: 30,
  fenetreMinutes: 10,
  code: "RED_TROP_DE_SCORES",
  message: "Au plus 30 scores d'alerte par 10 minutes : réessayez plus tard.",
};

export const DEBIT_VERSIONS_TRESORERIE: PlafondDebit = {
  entite: "red_tresorerie",
  action: "tresorerie_version",
  maximum: 60,
  fenetreMinutes: 10,
  code: "RED_TROP_DE_VERSIONS_TRESORERIE",
  message: "Au plus 60 versions de trésorerie par 10 minutes : réessayez plus tard.",
};

/**
 * Refuse (429) si l'utilisateur a déjà atteint le plafond sur la fenêtre. À appeler AVANT
 * l'écriture ; l'écriture journalise ensuite la ligne comptée, dans la même transaction.
 */
export async function verifierDebit(db: Db, auth: Auth, plafond: PlafondDebit): Promise<void> {
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `redressement_debit:${auth.utilisateurId}:${plafond.action}`,
  ]);
  const r = await db.query(
    `SELECT count(*)::int AS n FROM journal_audit
     WHERE utilisateur_id = $1 AND entite = $2 AND action = $3
       AND cree_le > now() - make_interval(mins => $4)`,
    [auth.utilisateurId, plafond.entite, plafond.action, plafond.fenetreMinutes],
  );
  if ((r.rows[0].n as number) >= plafond.maximum) {
    throw new AppError(429, plafond.code, plafond.message);
  }
}

/*
 * Débits de CRÉATION des objets dont le volume est plafonné de façon irréversible en base
 * (ajout seul : seuils, correspondances, versions de plan ; ou nombre borné : actions, créanciers,
 * événements de négociation) : sans eux, une boucle de requêtes épuiserait définitivement le plafond
 * d'un dossier ou d'un secteur (déni de service). Valeurs PROVISOIRES (DECISIONS.md), à calibrer ;
 * `journal_audit` compte les lignes déjà inscrites par chaque écriture.
 */
const debit = (
  entite: string,
  action: string,
  maximum: number,
  code: string,
  libelle: string,
): PlafondDebit => ({
  entite,
  action,
  maximum,
  fenetreMinutes: 10,
  code,
  message: `Au plus ${maximum} ${libelle} par 10 minutes : réessayez plus tard.`,
});

export const DEBIT_SEUILS = debit(
  "red_seuils",
  "creation",
  10,
  "RED_TROP_DE_SEUILS",
  "versions de seuils",
);
export const DEBIT_CORRESPONDANCES = debit(
  "red_correspondance",
  "creation",
  20,
  "RED_TROP_DE_CORRESPONDANCES",
  "versions de correspondance",
);
export const DEBIT_ACTIONS = debit("red_action", "creation", 60, "RED_TROP_D_ACTIONS", "actions");
export const DEBIT_VERSIONS_PLAN = debit(
  "red_plan_version",
  "creation",
  20,
  "RED_TROP_DE_VERSIONS_PLAN",
  "versions de plan",
);
export const DEBIT_CREANCIERS = debit(
  "red_creancier",
  "creation",
  60,
  "RED_TROP_DE_CREANCIERS",
  "créanciers",
);
export const DEBIT_EVENEMENTS = debit(
  "red_creancier",
  "evenement",
  60,
  "RED_TROP_D_EVENEMENTS",
  "événements de négociation",
);
