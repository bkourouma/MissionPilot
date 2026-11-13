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
import type { Langue } from "@missionpilot/shared";
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

export const MESSAGES_PILOTAGE_EN: Record<string, string> = {
  KPI_REVUE_OUVERTE:
    "Decisions or actions of the review are still open: complete them, or abandon them with a reason, before closing.",
  KPI_ARBRE_TROP_GRAND:
    "A tree has at most 50 active nodes, 200 nodes in total (disabled ones included) and 6 levels below the root.",
  KPI_NOEUD_PARENT_INVALIDE:
    "The node's parent is disabled or belongs to another tree: reactivate the parent first.",
  KPI_REVUE_FIGEE:
    "The content of a held review (agenda, file, minutes) is frozen: it can no longer change.",
  KPI_ACTION_REVUE:
    "An action can only be linked to a decision of a held, unclosed review: this review is not held, or it is already closed. Choose another decision, or leave this field empty.",
  KPI_ARBRE_UNITES:
    "Different units: the sum makes no sense. Link a KPI with the same unit, or have the parent node combined by a product.",
  KPI_COEFFICIENT_PRODUIT: "Under a product, a driver's coefficient is 1.",
  KPI_NOEUD_NON_DESACTIVABLE:
    "First disable the children of this node; the root cannot be disabled.",
  TROP_DE_DOSSIERS_REVUE:
    "Too many review files downloaded in a short time: try again in a few minutes.",
  RENDU_PDF_INDISPONIBLE:
    "PDF rendering is unavailable on this server: choose the Word or PowerPoint format.",
};

/** Message affiché pour une erreur du pilotage augmenté (message propre, sinon celui des KPI). */
export function messagePilotage(e: unknown, langue: Langue = "fr"): string {
  if (e instanceof ErreurApi) {
    const propre = (langue === "en" ? MESSAGES_PILOTAGE_EN : MESSAGES_PILOTAGE)[e.code];
    if (propre) return propre;
  }
  return messageKpi(e, langue);
}
