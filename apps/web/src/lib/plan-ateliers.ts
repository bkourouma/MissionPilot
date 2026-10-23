/**
 * Ateliers stratégiques en ligne (PLA-15) : types des réponses de l'API, chemins, contrôle des
 * saisies (atelier, vote, classement, matrice), libellés et droits d'affichage. Logique pure, testée
 * dans `plan-ateliers.test.ts`.
 *
 * Aucun agrégat n'est calculé ici : points, parts, rangs, moyennes et taux de participation sortent du
 * moteur côté API (figés à la clôture). Les conversions de ce module ne font que PRÉSENTER des entiers
 * du moteur (centièmes → décimales). Le portail ne reçoit jamais d'agrégat ni la contribution d'un
 * autre : seuls les types `…Portail` lui servent. Sous-modules : `plan-ateliers-types`,
 * `plan-ateliers-presentation`, `plan-ateliers-saisie`.
 */
import type { MethodeAtelier } from "@missionpilot/shared";
import { ErreurApi, messageErreur } from "./api";
import { CHEMIN_PORTAIL } from "./portail-routes";
import { cheminPlan, hrefPlan } from "./plan-strategique";

export {
  METHODES_ATELIER,
  METHODE_ATELIER_LIBELLES,
  OPTIONS_ATELIER_MAX,
  OPTIONS_ATELIER_MIN,
} from "@missionpilot/shared";
export type { MethodeAtelier, StatutAtelier } from "@missionpilot/shared";
export * from "./plan-ateliers-types";
export * from "./plan-ateliers-presentation";
export * from "./plan-ateliers-saisie";

/* ----- Messages ----- */

export function messageAtelier(e: unknown): string {
  if (e instanceof ErreurApi) {
    switch (e.code) {
      case "ATELIER_ETAT":
      case "ATELIER_FIGE":
        return "L'atelier n'est plus dans l'état attendu : rechargez la page.";
      case "ATELIER_INCOHERENT":
        return "Pour ouvrir l'atelier : au moins deux options et un participant.";
      case "ATELIER_PLAFOND":
        return "Plafond atteint (100 ateliers par plan, 50 options, 100 participants, 20 versions d'une contribution).";
      case "ATELIER_PARTICIPANT_REFUSE":
        return "Cette personne ne peut pas être invitée à cet atelier.";
      case "ATELIER_OPTION_INCONNUE":
        return "Une option n'existe plus dans cet atelier : rechargez la page.";
      case "ATELIER_CONTRIBUTION_INVALIDE":
      case "ATELIER_CONTRIBUTION_INCOMPLETE":
      case "ATELIER_INVALIDE":
        return "Contribution refusée : vérifiez le budget de points, les options et les notes.";
    }
    if (e.statut === 403) return "Votre rôle ne permet pas cette action sur les ateliers.";
    if (e.statut === 404) return "Cet atelier est introuvable ou ne vous est plus accessible.";
    if (e.statut === 409) return e.message;
  }
  return messageErreur(e);
}

/* ----- Chemins ----- */

const seg = (id: string) => encodeURIComponent(id);

export const hrefAteliers = (missionId: string, planId: string) =>
  `${hrefPlan(missionId, planId)}/ateliers`;
export const hrefAtelier = (missionId: string, planId: string, atelierId: string) =>
  `${hrefAteliers(missionId, planId)}/${seg(atelierId)}`;
export const cheminAteliers = (planId: string) => `${cheminPlan(planId)}/ateliers`;
export const cheminListeAteliers = (planId: string, limite = 30) =>
  `${cheminAteliers(planId)}?limite=${limite}`;
export const cheminAtelier = (planId: string, atelierId: string) =>
  `${cheminAteliers(planId)}/${seg(atelierId)}`;
export const cheminOuvrirAtelier = (planId: string, atelierId: string) =>
  `${cheminAtelier(planId, atelierId)}/ouvrir`;
export const cheminCloreAtelier = (planId: string, atelierId: string) =>
  `${cheminAtelier(planId, atelierId)}/clore`;
export const cheminParticipants = (planId: string, atelierId: string) =>
  `${cheminAtelier(planId, atelierId)}/participants`;
export const cheminCandidats = (planId: string, atelierId: string) =>
  `${cheminAtelier(planId, atelierId)}/candidats`;
export const cheminContributions = (planId: string, atelierId: string) =>
  `${cheminAtelier(planId, atelierId)}/contribution`;
export const cheminContribution = (planId: string, atelierId: string, m: MethodeAtelier) =>
  `${cheminContributions(planId, atelierId)}/${m}`;
export const cheminSynthese = (planId: string, atelierId: string) =>
  `${cheminAtelier(planId, atelierId)}/synthese`;

/** Espace client. */
export const CHEMIN_ATELIERS_PORTAIL = `${CHEMIN_PORTAIL}/ateliers`;
export const API_ATELIERS_PORTAIL = "/api/portail/ateliers";
export const cheminAtelierPortail = (id: string) => `${CHEMIN_ATELIERS_PORTAIL}/${seg(id)}`;
export const cheminApiAtelierPortail = (id: string) => `${API_ATELIERS_PORTAIL}/${seg(id)}`;
export const cheminApiContributionPortail = (id: string, m: MethodeAtelier) =>
  `${cheminApiAtelierPortail(id)}/contribution/${m}`;
