/** Qualité : libellés, tonalités et messages d'erreur (module extrait de `qualite.ts`). */
import type { CodeViolation, Parcours, Violation } from "./qualite-types";
import {
  CLASSE_RISQUE_LIBELLES,
  DECISION_ACCEPTATION_LIBELLES,
  ETAPE_GARDE_LIBELLES,
  KIND_ELEMENT_LIBELLES,
  NIVEAU_RISQUE_LIBELLES,
  STATUT_SUIVI_LIBELLES,
  STATUT_VERIFICATION_LIBELLES,
  TYPE_LIVRABLE_LIBELLES,
  type ClasseRisque,
  type DecisionAcceptation,
  type EtapeGardeQualite,
  type KindElementRevue,
  type NiveauRisqueClient,
  type StatutSuivi,
  type StatutVerification,
  type TypeLivrable,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import { ErreurApi, messageErreur } from "./api";

export const libelleClasse = (c: ClasseRisque) => `${c} · ${CLASSE_RISQUE_LIBELLES[c]}`;
export const libelleStatutSuivi = (s: StatutSuivi) => STATUT_SUIVI_LIBELLES[s];
export const libelleType = (t: TypeLivrable) => TYPE_LIVRABLE_LIBELLES[t];
export const libelleEtape = (e: EtapeGardeQualite) => ETAPE_GARDE_LIBELLES[e];
export const libelleKind = (k: KindElementRevue) => KIND_ELEMENT_LIBELLES[k];
export const libelleDecision = (d: DecisionAcceptation) => DECISION_ACCEPTATION_LIBELLES[d];
export const libelleNiveauRisque = (n: NiveauRisqueClient) => NIVEAU_RISQUE_LIBELLES[n];

export function libelleVerification(s: StatutVerification | "en_attente"): string {
  return s === "en_attente" ? "À vérifier" : STATUT_VERIFICATION_LIBELLES[s];
}

export function tonaliteStatutSuivi(s: StatutSuivi): TonaliteStatut {
  return s === "signe" || s === "valide" ? "succes" : s === "en_revue" ? "attention" : "neutre";
}

export function tonaliteClasse(c: ClasseRisque): TonaliteStatut {
  return c === "R3" ? "danger" : c === "R2" ? "attention" : "neutre";
}

export function tonaliteVerification(s: StatutVerification | "en_attente"): TonaliteStatut {
  if (s === "conforme" || s === "atteste") return "succes";
  if (s === "non_conforme") return "danger";
  return "attention";
}

export function tonaliteNiveauRisque(n: NiveauRisqueClient): TonaliteStatut {
  return n === "eleve" ? "danger" : n === "moyen" ? "attention" : "succes";
}

const LIBELLES_VIOLATION: Record<CodeViolation, string> = {
  AUTEUR_ATTENDU: "La validation de l'auteur revient à l'auteur du contenu.",
  CUMUL_INTERDIT: "Une même personne ne peut pas cumuler ces deux rôles.",
  QUATRE_YEUX: "Quatre yeux : le second expert doit être distinct de l'auteur et du valideur.",
  ETAPE_EN_DOUBLE: "Cette étape a déjà été franchie.",
  ACTEUR_NON_HABILITE: "Vous n'êtes pas habilité à tenir ce rôle sur cette mission.",
};

export const libelleViolation = (v: Violation) =>
  LIBELLES_VIOLATION[v.code] ?? "Garde non respectée.";

export const NATURES_CONFLIT: Record<string, string> = {
  meme_groupe: "Même groupe",
  investisseur_cible: "Investisseur et société cible",
  concurrent: "Concurrent déclaré",
};
export const libelleNatureConflit = (n: string) => NATURES_CONFLIT[n] ?? n;

/** « 3 sur 5 » : progression du parcours de revue (les nombres viennent de l'API). */
export function texteParcours(p: Parcours): string {
  if (p.obligatoires === 0) return "Aucun élément obligatoire à parcourir";
  return `${p.vus} sur ${p.obligatoires} parcourus`;
}

/** Durée en secondes → « 1 h 05 min », « 12 min 30 s », « 45 s ». Mise en forme seulement. */
export function formaterDuree(secondes: number): string {
  const s = Math.max(0, Math.trunc(secondes));
  if (s < 60) return `${s} s`;
  const minutes = Math.trunc(s / 60);
  if (minutes < 60) {
    const reste = s % 60;
    return reste === 0 ? `${minutes} min` : `${minutes} min ${String(reste).padStart(2, "0")} s`;
  }
  return `${Math.trunc(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}

/** Empreinte abrégée pour l'affichage (la valeur complète reste en `title`). */
export function empreinteCourte(e: string): string {
  return e.length > 16 ? `${e.slice(0, 8)}…${e.slice(-8)}` : e;
}

/** NPS « -33.3 » de l'API → affichage français « −33,3 » ; absence → « — ». */
export function formaterNps(nps: string | null): string {
  if (nps === null) return "—";
  return nps.replace("-", "−").replace(".", ",");
}

// --- Erreurs ---------------------------------------------------------------------------------

/** Codes de l'API dont le message (français, explicite) est affiché tel quel. */
const CODES_MESSAGE_API = new Set([
  "GARDE_VIOLEE",
  "PARCOURS_INCOMPLET",
  "DEFINITION_NON_SATISFAITE",
  "SUIVI_NON_EN_REVUE",
  "SUIVI_NON_VALIDE",
  "SUIVI_EXISTANT",
  "CLASSE_SOUS_MINIMALE",
  "CLASSE_ABAISSEE",
  "SIGNATURE_NON_APPLICABLE",
  "MOTIF_CONFLIT_REQUIS",
  "CLOTURE_NON_ATTEINTE",
  "RELATION_EN_DOUBLE",
  "SESSION_OUVERTE",
]);

export const MESSAGE_INTROUVABLE_QUALITE =
  "Ce livrable ou cette mission n'est plus accessible. Actualisez la page.";

export function messageQualite(e: unknown): string {
  if (e instanceof ErreurApi) {
    if (CODES_MESSAGE_API.has(e.code)) return e.message;
    if (e.statut === 404) return MESSAGE_INTROUVABLE_QUALITE;
    if (e.statut === 409) return e.message;
  }
  return messageErreur(e);
}

/** Après ce refus, l'état affiché est probablement périmé : rafraîchir la page. */
export const etatQualiteChange = (e: unknown) =>
  e instanceof ErreurApi && (e.statut === 404 || e.statut === 409);
