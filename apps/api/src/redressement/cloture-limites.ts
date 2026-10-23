import type { PlafondDebit } from "./limites.js";

/*
 * Plafonds de débit du bilan de clôture (RED-08). Valeur PROVISOIRE, à calibrer : chaque version est
 * en ajout seul et la base en plafonne 30 par dossier (MPZ10), donc une boucle de requêtes épuiserait
 * définitivement le plafond d'un dossier sans ce débit. La génération du rapport de clôture réutilise
 * le débit des rapports (rapports/enregistrement.ts : 10 générations par utilisateur sur 10 minutes).
 */
export const DEBIT_CLOTURES: PlafondDebit = {
  entite: "red_cloture",
  action: "creation",
  maximum: 10,
  fenetreMinutes: 10,
  code: "RED_TROP_DE_BILANS",
  message: "Au plus 10 bilans de clôture par 10 minutes : réessayez plus tard.",
};
