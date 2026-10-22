/**
 * Pilotage augmenté des KPI côté cabinet (PRD complémentaire §11.4) : arbres d'indicateurs
 * (KPI-13), qualité des données (KPI-15), revues de performance (KPI-17) et actions correctives
 * (KPI-18). Contrats des réponses de l'API, chemins, libellés, contrôles de saisie et mise en
 * forme. Logique pure, testée dans `kpi-pilotage.test.ts`.
 *
 * Tous les chiffres (contributions, scores de qualité, efficacité, ordre du jour) sont ceux des
 * moteurs de l'API (`packages/engines/src/kpi`) : ce module les met en forme et ne les recalcule
 * jamais. Rien n'est conservé dans le navigateur.
 *
 * Sous-modules : `kpi-pilotage-types` (contrats), `kpi-pilotage-chemins` (chemins, dossier de
 * revue), `kpi-pilotage-libelles` (libellés, mise en forme), `kpi-pilotage-saisies` (contrôles
 * de saisie).
 */
import { ErreurApi } from "./api";
import { messageKpi } from "./kpi";

export * from "./kpi-pilotage-types";
export * from "./kpi-pilotage-chemins";
export * from "./kpi-pilotage-libelles";
export * from "./kpi-pilotage-saisies";

/** Messages propres aux refus du pilotage augmenté (les autres passent par `messageKpi`). */
export const MESSAGES_PILOTAGE: Record<string, string> = {
  KPI_REVUE_OUVERTE:
    "Des décisions ou des actions de la revue sont encore ouvertes : terminez-les, ou abandonnez-les avec un motif, avant de clôturer.",
  KPI_ARBRE_TROP_GRAND:
    "Un arbre compte au plus 50 nœuds actifs, 200 nœuds au total (désactivés compris) et 6 niveaux sous la racine.",
  KPI_NOEUD_PARENT_INVALIDE:
    "Le parent du nœud est désactivé ou d'un autre arbre : réactivez d'abord le parent.",
  KPI_REVUE_FIGEE:
    "Le contenu d'une revue tenue (ordre du jour, dossier, compte rendu) est figé : il ne change plus.",
  KPI_ACTION_REVUE:
    "Une action ne se rattache qu'à une décision d'une revue tenue et non clôturée : cette revue n'est pas tenue, ou elle est déjà clôturée. Choisissez une autre décision, ou laissez ce champ vide.",
  KPI_ARBRE_UNITES:
    "Unités différentes : la somme n'a pas de sens. Liez un KPI de même unité, ou faites combiner le nœud parent par un produit.",
  KPI_COEFFICIENT_PRODUIT: "Sous un produit, le coefficient d'un levier est 1.",
  KPI_NOEUD_NON_DESACTIVABLE:
    "Désactivez d'abord les enfants de ce nœud ; la racine ne se désactive pas.",
  TROP_DE_DOSSIERS_REVUE:
    "Trop de dossiers de revue téléchargés en peu de temps : réessayez dans quelques minutes.",
  RENDU_PDF_INDISPONIBLE:
    "Le rendu PDF est indisponible sur ce serveur : choisissez le format Word ou PowerPoint.",
};

/** Message affiché pour une erreur du pilotage augmenté (message propre, sinon celui des KPI). */
export function messagePilotage(e: unknown): string {
  if (e instanceof ErreurApi) {
    const propre = MESSAGES_PILOTAGE[e.code];
    if (propre) return propre;
  }
  return messageKpi(e);
}
