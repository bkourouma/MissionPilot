import type { PlafondDebit } from "./limites.js";

/*
 * Plafonds de débit des check-lists (RED-03), comptés sur `journal_audit` par `verifierDebit`
 * (limites.ts) : sans eux, une boucle de requêtes épuiserait définitivement les plafonds de volume
 * (modèles, versions, check-lists, réponses), qui sont en ajout seul. Valeurs PROVISOIRES
 * (DECISIONS.md), à calibrer. La ligne de journal comptée est celle de l'écriture elle-même.
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

export const DEBIT_CHECKLIST_MODELES = debit(
  "red_checklist_modele",
  "creation",
  10,
  "RED_TROP_DE_MODELES_CHECKLIST",
  "modèles de check-list",
);
export const DEBIT_CHECKLIST_VERSIONS = debit(
  "red_checklist_version",
  "creation",
  20,
  "RED_TROP_DE_VERSIONS_CHECKLIST",
  "versions de modèle de check-list",
);
export const DEBIT_CHECKLIST_ACTIVATIONS = debit(
  "red_checklist",
  "activation",
  30,
  "RED_TROP_D_ACTIVATIONS_CHECKLIST",
  "activations de check-list",
);
export const DEBIT_CHECKLIST_REPONSES = debit(
  "red_checklist",
  "reponses",
  60,
  "RED_TROP_DE_REPONSES_CHECKLIST",
  "lots de réponses de check-list",
);
