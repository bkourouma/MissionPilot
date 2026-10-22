import {
  aPermission,
  RECOMMANDATION_GO_NO_GO_LIBELLES,
  STATUT_APPEL_OFFRES_LIBELLES,
  STATUT_CONFORMITE_AO_LIBELLES,
  CATEGORIE_EXIGENCE_AO_LIBELLES,
  type CategorieExigenceAo,
  type StatutAppelOffres,
  type StatutConformiteAo,
  type Role,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import type { AlerteFiche, Recommandation } from "./appels-offres-types";

// --- Droits d'affichage ----------------------------------------------------------------------

export interface DroitsAo {
  lire: boolean;
  gerer: boolean;
  decider: boolean;
  /** Marge estimée (FIN-02). */
  finance: boolean;
  /** Confier une étape par une tâche assignée. */
  assigner: boolean;
  ia: boolean;
}

export function droitsAppelsOffres(roles: readonly Role[]): DroitsAo {
  return {
    lire: aPermission(roles, "ao.lire"),
    gerer: aPermission(roles, "ao.gerer"),
    decider: aPermission(roles, "ao.decider"),
    finance: aPermission(roles, "finance.lire"),
    assigner: aPermission(roles, "tache.assigner"),
    ia: aPermission(roles, "ia.utiliser"),
  };
}

// --- Libellés et tonalités -------------------------------------------------------------------

export const libelleStatutAo = (s: StatutAppelOffres) => STATUT_APPEL_OFFRES_LIBELLES[s] ?? s;

export function tonaliteStatutAo(s: StatutAppelOffres): TonaliteStatut {
  if (s === "gagne") return "succes";
  if (s === "perdu" || s === "no_go") return "danger";
  if (s === "go_no_go" || s === "depose") return "attention";
  return "neutre";
}

export const libelleRecommandation = (r: Recommandation) => RECOMMANDATION_GO_NO_GO_LIBELLES[r];

export function tonaliteRecommandation(r: Recommandation): TonaliteStatut {
  return r === "go" ? "succes" : r === "no_go" ? "danger" : "attention";
}

export const libelleConformite = (s: StatutConformiteAo) => STATUT_CONFORMITE_AO_LIBELLES[s];

export function tonaliteConformite(s: StatutConformiteAo): TonaliteStatut {
  if (s === "conforme") return "succes";
  if (s === "non_conforme") return "danger";
  if (s === "partiel" || s === "en_cours") return "attention";
  return "neutre";
}

export const libelleCategorie = (c: CategorieExigenceAo) => CATEGORIE_EXIGENCE_AO_LIBELLES[c];

export const LIBELLES_CRITERES: Record<string, string> = {
  adequation: "Adéquation",
  references: "Références",
  charge: "Charge",
  marge: "Marge estimée",
  concurrence: "Concurrence connue",
};

export const LIBELLES_ELIMINATOIRES: Record<string, string> = {
  marge_non_positive: "Marge nulle ou négative",
  references_insuffisantes: "Références exigées non atteintes",
};

export const LIBELLES_SIGNAUX: Record<string, string> = {
  ignorer_consignes: "consigne d'ignorer les instructions",
  changement_role: "changement de rôle demandé",
  invite_systeme: "prétendu message système",
  demande_action: "demande d'action",
  autorite_pretendue: "autorité prétendue",
  sortie_imposee: "format de réponse imposé",
  caracteres_invisibles: "caractères invisibles",
};

/** « dans 3 jours », « demain », « aujourd'hui », « dépassée de 2 jours ». */
export function texteJoursRestants(n: number): string {
  if (n === 0) return "aujourd'hui";
  if (n === 1) return "demain";
  if (n > 1) return `dans ${n} jours`;
  if (n === -1) return "dépassée d'un jour";
  return `dépassée de ${-n} jours`;
}

/** Texte d'une alerte (fiche ou cabinet). */
export function texteAlerte(a: {
  type: AlerteFiche["type"];
  joursRestants: number;
  etapeLibelle?: string | null;
}): string {
  if (a.type === "date_limite") return `Date limite ${texteJoursRestants(a.joursRestants)}`;
  const etape = a.etapeLibelle ?? "Étape";
  if (a.type === "etape_du_jour") return `${etape} : prévue aujourd'hui`;
  return `${etape} : en retard (${texteJoursRestants(a.joursRestants)})`;
}

export function tonaliteAlerte(joursRestants: number): TonaliteStatut {
  if (joursRestants <= 1) return "danger";
  return "attention";
}
