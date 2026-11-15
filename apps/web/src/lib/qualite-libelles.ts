/** Qualité : libellés, tonalités et messages d'erreur (module extrait de `qualite.ts`). */
import type { CodeViolation, Parcours, Violation } from "./qualite-types";
import {
  creerTraduire,
  FACTEURS_RISQUE_CLIENT,
  type Langue,
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

const TYPE_LIVRABLE_LIBELLES_EN: Record<TypeLivrable, string> = {
  rapport: "Report",
  notation: "Published rating",
  plan: "Strategic plan",
  questionnaire: "Questionnaire",
  etat: "Financial statement",
  autre: "Other deliverable",
};
const STATUT_SUIVI_LIBELLES_EN: Record<StatutSuivi, string> = {
  brouillon: "Draft",
  en_revue: "In review",
  valide: "Approved",
  signe: "Signed",
};
const ETAPE_GARDE_LIBELLES_EN: Record<EtapeGardeQualite, string> = {
  validation_auteur: "Author approval",
  validation_consultant: "Consultant approval",
  relecture_chef_mission: "Engagement manager review",
  revue_second_expert: "Second expert review (four eyes)",
  signature_directeur_mission: "Engagement director signature",
};
const KIND_ELEMENT_LIBELLES_EN: Record<KindElementRevue, string> = {
  assertion_fragile: "Weak assertion",
  chiffre: "Figure",
  recommandation: "Recommendation",
};
const DECISION_ACCEPTATION_LIBELLES_EN: Record<DecisionAcceptation, string> = {
  en_attente: "Pending",
  acceptee: "Accepted",
  acceptee_sous_conditions: "Accepted with conditions",
  refusee: "Declined",
};
const NIVEAU_RISQUE_LIBELLES_EN: Record<NiveauRisqueClient, string> = {
  faible: "Low",
  moyen: "Medium",
  eleve: "High",
};
const STATUT_VERIFICATION_LIBELLES_EN: Record<StatutVerification, string> = {
  conforme: "Compliant",
  non_conforme: "Non-compliant",
  non_evaluable: "To attest",
  atteste: "Attested",
};
const CLASSE_RISQUE_LIBELLES_EN: Record<ClasseRisque, string> = {
  R0: "Internal operations",
  R1: "Internal analysis",
  R2: "Client deliverable",
  R3: "Binding",
};

export const libelleClasse = (c: ClasseRisque, langue: Langue = "fr") =>
  `${c} · ${langue === "en" ? CLASSE_RISQUE_LIBELLES_EN[c] : CLASSE_RISQUE_LIBELLES[c]}`;
export const libelleStatutSuivi = (s: StatutSuivi, langue: Langue = "fr") =>
  langue === "en" ? STATUT_SUIVI_LIBELLES_EN[s] : STATUT_SUIVI_LIBELLES[s];
export const libelleType = (t: TypeLivrable, langue: Langue = "fr") =>
  langue === "en" ? TYPE_LIVRABLE_LIBELLES_EN[t] : TYPE_LIVRABLE_LIBELLES[t];
export const libelleEtape = (e: EtapeGardeQualite, langue: Langue = "fr") =>
  langue === "en" ? ETAPE_GARDE_LIBELLES_EN[e] : ETAPE_GARDE_LIBELLES[e];
export const libelleKind = (k: KindElementRevue, langue: Langue = "fr") =>
  langue === "en" ? KIND_ELEMENT_LIBELLES_EN[k] : KIND_ELEMENT_LIBELLES[k];
export const libelleDecision = (d: DecisionAcceptation, langue: Langue = "fr") =>
  langue === "en" ? DECISION_ACCEPTATION_LIBELLES_EN[d] : DECISION_ACCEPTATION_LIBELLES[d];
export const libelleNiveauRisque = (n: NiveauRisqueClient, langue: Langue = "fr") =>
  langue === "en" ? NIVEAU_RISQUE_LIBELLES_EN[n] : NIVEAU_RISQUE_LIBELLES[n];

const FACTEURS_RISQUE_EN: Record<string, string> = {
  pays_a_risque: "Country or area at high risk",
  personne_exposee: "Politically exposed executive or shareholder",
  litige_en_cours: "Significant ongoing litigation",
  client_en_difficulte: "Client in financial difficulty",
  secteur_reglemente: "Heavily regulated sector",
  gouvernance_opaque: "Opaque governance or shareholding",
  information_incomplete: "Incomplete client information",
  dependance_honoraires: "Firm's dependence on this client",
};

/** Libellé d'un facteur de risque du client (repli : le code lui-même). */
export function libelleFacteurRisque(code: string, langue: Langue = "fr"): string {
  if (langue === "en") return FACTEURS_RISQUE_EN[code] ?? code;
  return FACTEURS_RISQUE_CLIENT.find((x) => x.code === code)?.libelle ?? code;
}

export function libelleVerification(
  s: StatutVerification | "en_attente",
  langue: Langue = "fr",
): string {
  if (s === "en_attente") return creerTraduire(langue)("À vérifier", "To verify");
  return langue === "en" ? STATUT_VERIFICATION_LIBELLES_EN[s] : STATUT_VERIFICATION_LIBELLES[s];
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

const LIBELLES_VIOLATION_EN: Record<CodeViolation, string> = {
  AUTEUR_ATTENDU: "The author's approval belongs to the content author.",
  CUMUL_INTERDIT: "The same person cannot hold both of these roles.",
  QUATRE_YEUX: "Four eyes: the second expert must be different from the author and the approver.",
  ETAPE_EN_DOUBLE: "This step has already been completed.",
  ACTEUR_NON_HABILITE: "You are not authorized to hold this role on this engagement.",
};

const LIBELLES_VIOLATION: Record<CodeViolation, string> = {
  AUTEUR_ATTENDU: "La validation de l'auteur revient à l'auteur du contenu.",
  CUMUL_INTERDIT: "Une même personne ne peut pas cumuler ces deux rôles.",
  QUATRE_YEUX: "Quatre yeux : le second expert doit être distinct de l'auteur et du valideur.",
  ETAPE_EN_DOUBLE: "Cette étape a déjà été franchie.",
  ACTEUR_NON_HABILITE: "Vous n'êtes pas habilité à tenir ce rôle sur cette mission.",
};

export const libelleViolation = (v: Violation, langue: Langue = "fr") =>
  (langue === "en" ? LIBELLES_VIOLATION_EN[v.code] : LIBELLES_VIOLATION[v.code]) ??
  creerTraduire(langue)("Garde non respectée.", "Safeguard not met.");

export const NATURES_CONFLIT: Record<string, string> = {
  meme_groupe: "Même groupe",
  investisseur_cible: "Investisseur et société cible",
  concurrent: "Concurrent déclaré",
};
const NATURES_CONFLIT_EN: Record<string, string> = {
  meme_groupe: "Same group",
  investisseur_cible: "Investor and target company",
  concurrent: "Declared competitor",
};
export const libelleNatureConflit = (n: string, langue: Langue = "fr") =>
  (langue === "en" ? NATURES_CONFLIT_EN[n] : NATURES_CONFLIT[n]) ?? n;

/** « 3 sur 5 » : progression du parcours de revue (les nombres viennent de l'API). */
export function texteParcours(p: Parcours, langue: Langue = "fr"): string {
  const t = creerTraduire(langue);
  if (p.obligatoires === 0)
    return t("Aucun élément obligatoire à parcourir", "No mandatory item to review");
  return t(`${p.vus} sur ${p.obligatoires} parcourus`, `${p.vus} of ${p.obligatoires} reviewed`);
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
export function formaterNps(nps: string | null, langue: Langue = "fr"): string {
  if (nps === null) return "—";
  const signe = nps.replace("-", "−");
  return langue === "en" ? signe : signe.replace(".", ",");
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
export const MESSAGE_INTROUVABLE_QUALITE_EN =
  "This deliverable or engagement is no longer accessible. Refresh the page.";

export function messageQualite(e: unknown, langue: Langue = "fr"): string {
  if (e instanceof ErreurApi) {
    if (CODES_MESSAGE_API.has(e.code)) return e.message;
    if (e.statut === 404) {
      return langue === "en" ? MESSAGE_INTROUVABLE_QUALITE_EN : MESSAGE_INTROUVABLE_QUALITE;
    }
    if (e.statut === 409) return e.message;
  }
  return messageErreur(e);
}

/** Après ce refus, l'état affiché est probablement périmé : rafraîchir la page. */
export const etatQualiteChange = (e: unknown) =>
  e instanceof ErreurApi && (e.statut === 404 || e.statut === 409);
