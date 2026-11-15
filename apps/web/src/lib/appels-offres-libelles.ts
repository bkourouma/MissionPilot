import {
  aPermission,
  RECOMMANDATION_GO_NO_GO_LIBELLES,
  STATUT_APPEL_OFFRES_LIBELLES,
  STATUT_CONFORMITE_AO_LIBELLES,
  CATEGORIE_EXIGENCE_AO_LIBELLES,
  type CategorieExigenceAo,
  type Langue,
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

export const STATUT_APPEL_OFFRES_LIBELLES_EN: Record<StatutAppelOffres, string> = {
  detecte: "Detected",
  go_no_go: "Go/no-go",
  en_reponse: "Responding",
  depose: "Submitted",
  gagne: "Won",
  perdu: "Lost",
  no_go: "No-go",
};

export const RECOMMANDATION_GO_NO_GO_LIBELLES_EN: Record<Recommandation, string> = {
  go: "Go recommended",
  a_examiner: "To be reviewed",
  no_go: "No-go recommended",
};

export const STATUT_CONFORMITE_AO_LIBELLES_EN: Record<StatutConformiteAo, string> = {
  a_traiter: "To do",
  en_cours: "In progress",
  conforme: "Compliant",
  partiel: "Partial",
  non_conforme: "Non-compliant",
  sans_objet: "Not applicable",
};

export const CATEGORIE_EXIGENCE_AO_LIBELLES_EN: Record<CategorieExigenceAo, string> = {
  administrative: "Administrative",
  technique: "Technical",
  financiere: "Financial",
  references: "References",
  personnel: "Key personnel",
  autre: "Other",
};

export const libelleStatutAo = (s: StatutAppelOffres, langue: Langue = "fr") =>
  (langue === "en" ? STATUT_APPEL_OFFRES_LIBELLES_EN : STATUT_APPEL_OFFRES_LIBELLES)[s] ?? s;

export function tonaliteStatutAo(s: StatutAppelOffres): TonaliteStatut {
  if (s === "gagne") return "succes";
  if (s === "perdu" || s === "no_go") return "danger";
  if (s === "go_no_go" || s === "depose") return "attention";
  return "neutre";
}

export const libelleRecommandation = (r: Recommandation, langue: Langue = "fr") =>
  (langue === "en" ? RECOMMANDATION_GO_NO_GO_LIBELLES_EN : RECOMMANDATION_GO_NO_GO_LIBELLES)[r];

export function tonaliteRecommandation(r: Recommandation): TonaliteStatut {
  return r === "go" ? "succes" : r === "no_go" ? "danger" : "attention";
}

export const libelleConformite = (s: StatutConformiteAo, langue: Langue = "fr") =>
  (langue === "en" ? STATUT_CONFORMITE_AO_LIBELLES_EN : STATUT_CONFORMITE_AO_LIBELLES)[s];

export function tonaliteConformite(s: StatutConformiteAo): TonaliteStatut {
  if (s === "conforme") return "succes";
  if (s === "non_conforme") return "danger";
  if (s === "partiel" || s === "en_cours") return "attention";
  return "neutre";
}

export const libelleCategorie = (c: CategorieExigenceAo, langue: Langue = "fr") =>
  (langue === "en" ? CATEGORIE_EXIGENCE_AO_LIBELLES_EN : CATEGORIE_EXIGENCE_AO_LIBELLES)[c];

export const LIBELLES_CRITERES: Record<string, string> = {
  adequation: "Adéquation",
  references: "Références",
  charge: "Charge",
  marge: "Marge estimée",
  concurrence: "Concurrence connue",
};

export const LIBELLES_CRITERES_EN: Record<string, string> = {
  adequation: "Fit",
  references: "References",
  charge: "Workload",
  marge: "Estimated margin",
  concurrence: "Known competition",
};

export const LIBELLES_ELIMINATOIRES: Record<string, string> = {
  marge_non_positive: "Marge nulle ou négative",
  references_insuffisantes: "Références exigées non atteintes",
};

export const LIBELLES_ELIMINATOIRES_EN: Record<string, string> = {
  marge_non_positive: "Zero or negative margin",
  references_insuffisantes: "Required references not met",
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

export const LIBELLES_SIGNAUX_EN: Record<string, string> = {
  ignorer_consignes: "instruction to ignore instructions",
  changement_role: "role change requested",
  invite_systeme: "fake system message",
  demande_action: "action request",
  autorite_pretendue: "claimed authority",
  sortie_imposee: "imposed response format",
  caracteres_invisibles: "invisible characters",
};

/** « dans 3 jours », « demain », « aujourd'hui », « dépassée de 2 jours ». */
export const texteJoursRestants = (n: number): string => texteJoursRestantsLangue(n, "fr");

/** Même texte dans la langue demandée (fonction à part : `texteJoursRestants` est passée à `.map`). */
export function texteJoursRestantsLangue(n: number, langue: Langue): string {
  if (langue === "en") {
    if (n === 0) return "today";
    if (n === 1) return "tomorrow";
    if (n > 1) return `in ${n} days`;
    if (n === -1) return "overdue by 1 day";
    return `overdue by ${-n} days`;
  }
  if (n === 0) return "aujourd'hui";
  if (n === 1) return "demain";
  if (n > 1) return `dans ${n} jours`;
  if (n === -1) return "dépassée d'un jour";
  return `dépassée de ${-n} jours`;
}

/** Texte d'une alerte (fiche ou cabinet). */
export function texteAlerte(
  a: {
    type: AlerteFiche["type"];
    joursRestants: number;
    etapeLibelle?: string | null;
  },
  langue: Langue = "fr",
): string {
  const en = langue === "en";
  const jours = texteJoursRestantsLangue(a.joursRestants, langue);
  if (a.type === "date_limite") return en ? `Deadline ${jours}` : `Date limite ${jours}`;
  const etape = a.etapeLibelle ?? (en ? "Step" : "Étape");
  if (a.type === "etape_du_jour") {
    return en ? `${etape}: due today` : `${etape} : prévue aujourd'hui`;
  }
  return en ? `${etape}: late (${jours})` : `${etape} : en retard (${jours})`;
}

export function tonaliteAlerte(joursRestants: number): TonaliteStatut {
  if (joursRestants <= 1) return "danger";
  return "attention";
}
