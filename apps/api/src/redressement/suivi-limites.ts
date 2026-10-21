import type { PlafondDebit } from "./limites.js";

/*
 * Plafonds de débit des écritures du suivi post-mission (RED-09, lot 2). Les plafonds de volume
 * sont en base et irréversibles (ajout seul : 10 relevés et 8 événements par jalon, MPZ10) : sans
 * plafond de débit, une boucle de requêtes épuiserait définitivement ceux d'un jalon. Valeurs
 * PROVISOIRES (comme `limites.ts`), à calibrer ; `journal_audit` compte les lignes déjà inscrites
 * par chaque écriture (même entité et même action que le journal de l'écriture).
 */
export const DEBIT_PLANS_SUIVI: PlafondDebit = {
  entite: "red_suivi_plan",
  action: "plan_creation",
  maximum: 60,
  fenetreMinutes: 10,
  code: "RED_TROP_DE_PLANS_SUIVI",
  message: "Au plus 60 suivis post-mission créés par 10 minutes : réessayez plus tard.",
};

export const DEBIT_RELEVES_SUIVI: PlafondDebit = {
  entite: "red_suivi_releve",
  action: "releve",
  maximum: 30,
  fenetreMinutes: 10,
  code: "RED_TROP_DE_RELEVES_SUIVI",
  message: "Au plus 30 relevés de suivi par 10 minutes : réessayez plus tard.",
};

export const DEBIT_EVENEMENTS_SUIVI: PlafondDebit = {
  entite: "red_suivi_evenement",
  action: "evenement",
  maximum: 30,
  fenetreMinutes: 10,
  code: "RED_TROP_D_EVENEMENTS_SUIVI",
  message: "Au plus 30 événements de jalon par 10 minutes : réessayez plus tard.",
};
