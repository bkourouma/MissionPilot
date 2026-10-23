import type { PlafondDebit } from "./limites.js";

/*
 * Plafonds de débit des écritures de covenants et de plan de financement (RED-06, lot 2). Les
 * versions sont en ajout seul et plafonnées à 100 par dossier en base (MPZ10) : sans plafond de
 * débit, une boucle de requêtes épuiserait définitivement le plafond d'un dossier. Valeurs
 * PROVISOIRES (comme `limites.ts`), à calibrer ; `journal_audit` compte les lignes déjà inscrites
 * par chaque écriture (même entité et même action que le journal de l'écriture).
 */
export const DEBIT_VERSIONS_COVENANTS: PlafondDebit = {
  entite: "red_covenants",
  action: "covenants_version",
  maximum: 20,
  fenetreMinutes: 10,
  code: "RED_TROP_DE_VERSIONS_COVENANTS",
  message: "Au plus 20 versions de covenants par 10 minutes : réessayez plus tard.",
};

export const DEBIT_VERSIONS_FINANCEMENT: PlafondDebit = {
  entite: "red_financement",
  action: "financement_version",
  maximum: 20,
  fenetreMinutes: 10,
  code: "RED_TROP_DE_VERSIONS_FINANCEMENT",
  message: "Au plus 20 versions du plan de financement par 10 minutes : réessayez plus tard.",
};
