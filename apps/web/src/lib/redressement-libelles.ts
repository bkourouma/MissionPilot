/** Redressement : textes fixes, libellés et tonalités (SPEC-3a §10.3 et §10.6). */
import {
  RED_CATEGORIE_FLUX_LIBELLES,
  RED_CATEGORIE_CREANCIER_LIBELLES,
  RED_CRITERE_ALERTE_LIBELLES,
  RED_DOMAINE_LIBELLES,
  RED_FAMILLE_LEVIER_LIBELLES,
  RED_LEVIER_LIBELLES,
  RED_NIVEAU_ALERTE_LIBELLES,
  RED_POSTE_LIBELLES,
  RED_REPONSE_URGENCE_LIBELLES,
  RED_SECTEUR_LIBELLES,
  RED_SECTEURS,
  RED_SENS_FLUX_LIBELLES,
  RED_STATUT_ACCORD_LIBELLES,
  RED_STATUT_ACTION_LIBELLES,
  RED_STATUT_DOSSIER_LIBELLES,
  RED_STATUT_SEUILS_LIBELLES,
  RED_STATUT_VERSION_PLAN_LIBELLES,
  RED_STATUTS_DOSSIER,
  RED_TYPE_EVENEMENT_ACTION_LIBELLES,
  RED_TYPE_EVENEMENT_NEGOCIATION_LIBELLES,
  RED_VOLET_LIBELLES,
  RED_VOYANT_LIBELLES,
  RED_CATEGORIES_DECAISSEMENT,
  RED_CATEGORIES_ENCAISSEMENT,
  type RedCategorieCreancier,
  type RedCritereAlerte,
  type RedNiveauAlerte,
  type RedSecteur,
  type RedSensFlux,
  type RedStatutAccord,
  type RedStatutAction,
  type RedStatutDossier,
  type RedVoyant,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";

// --- Textes fixes (SPEC-3a §10.3 et §10.6 : à reprendre à l'identique) ----------------------------

export const MENTION_SCORE =
  "Indicatif. Ce score est une aide à la décision du consultant ; il ne constitue ni une procédure d'alerte au sens du droit OHADA ni un avis juridique.";
export const AVERTISSEMENT_SEUILS_DEFAUT =
  "Seuils par défaut du moteur (provisoires) : à remplacer par ceux de vos experts.";
export const TEXTE_TENSION =
  "Une semaine de tension est une semaine où le solde projeté passe sous le seuil que vous avez fixé. Ce n'est pas une qualification juridique de la situation de l'entreprise.";
export const BANDEAU_CONFIDENTIALITE =
  "Les conditions négociées sont confidentielles : elles ne sont pas reprises dans le journal d'audit.";
export const TEXTE_LEVIERS =
  "Ordre de grandeur calculé par le moteur à partir du dernier état accepté. Ce n'est pas une recommandation : les effets ne se cumulent pas mécaniquement.";
export const TEXTE_ANALYSES_INDICATIVES =
  "Les comptes du client ne sont pas certifiés ou leur fiabilité est faible : les analyses sont indicatives.";
export const AVERTISSEMENT_CORRESPONDANCE =
  "Références indicatives, à confirmer par un expert-comptable ; les postes sans référence sont à renseigner à la main.";
export const TEXTE_URGENCE_INTRO =
  "Questionnaire d'urgence : 15 questions, environ 15 minutes, à remplir avec le dirigeant. Répondre « Oui » signale un point plus grave.";
export const TEXTE_PUBLICATION_SEUILS =
  "La publication revient à un expert métier ou à un associé autre que l'auteur de la version.";
export const TEXTE_VALIDATION_PLAN =
  "La validation revient à un autre membre que l'auteur de la version, ou à un associé.";
export const TEXTE_SEUILS_AUCUNE_VERSION =
  "Aucune version publiée : les valeurs par défaut du moteur s'appliquent (provisoires).";
export const TEXTE_PLAN_MODIFIE = "Le plan a changé depuis la version validée.";
/** Le besoin de financement est une projection : réalisé constaté des semaines écoulées, prévu ensuite. */
export const LIBELLE_BESOIN_FINANCEMENT = "Besoin de financement prévu";
export const TEXTE_BESOIN_FINANCEMENT =
  "Projeté sur la base du réalisé constaté et du prévu : montant qui ramènerait le solde le plus bas de la fenêtre au seuil de tension.";
export const TEXTE_ETATS_ABSENTS =
  "Aucun état financier accepté pour ce client. Importez un état dans le dossier client et faites-le accepter.";

// --- Libellés ---------------------------------------------------------------------------------------

export const libelleSecteur = (s: RedSecteur) => RED_SECTEUR_LIBELLES[s] ?? s;
export const libelleStatutDossier = (s: RedStatutDossier) => RED_STATUT_DOSSIER_LIBELLES[s] ?? s;
export const libelleVoyant = (v: RedVoyant) => RED_VOYANT_LIBELLES[v] ?? v;
export const libelleNiveauAlerte = (n: RedNiveauAlerte) => RED_NIVEAU_ALERTE_LIBELLES[n] ?? n;
export const libelleDomaine = (d: keyof typeof RED_DOMAINE_LIBELLES) =>
  RED_DOMAINE_LIBELLES[d] ?? d;
export const libelleReponse = (r: keyof typeof RED_REPONSE_URGENCE_LIBELLES) =>
  RED_REPONSE_URGENCE_LIBELLES[r] ?? r;
export const libelleStatutAction = (s: RedStatutAction) => RED_STATUT_ACTION_LIBELLES[s] ?? s;
export const libelleVolet = (v: keyof typeof RED_VOLET_LIBELLES) => RED_VOLET_LIBELLES[v] ?? v;
export const libelleStatutAccord = (s: RedStatutAccord) => RED_STATUT_ACCORD_LIBELLES[s] ?? s;
export const libelleCategorieCreancier = (c: RedCategorieCreancier) =>
  RED_CATEGORIE_CREANCIER_LIBELLES[c] ?? c;
export const libelleTypeEvenement = (t: keyof typeof RED_TYPE_EVENEMENT_NEGOCIATION_LIBELLES) =>
  RED_TYPE_EVENEMENT_NEGOCIATION_LIBELLES[t] ?? t;
export const libelleTypeEvenementAction = (t: keyof typeof RED_TYPE_EVENEMENT_ACTION_LIBELLES) =>
  RED_TYPE_EVENEMENT_ACTION_LIBELLES[t] ?? t;
export const libelleStatutVersionPlan = (s: keyof typeof RED_STATUT_VERSION_PLAN_LIBELLES) =>
  RED_STATUT_VERSION_PLAN_LIBELLES[s] ?? s;
export const libelleStatutSeuils = (s: keyof typeof RED_STATUT_SEUILS_LIBELLES) =>
  RED_STATUT_SEUILS_LIBELLES[s] ?? s;

/**
 * Statut affiché d'une version de seuils : « Brouillon », « En vigueur » (publiée la plus
 * récente) ou « Remplacée » (publiée, mais une version publiée plus récente existe).
 */
export function libelleEtatVersionSeuils(v: {
  statut: keyof typeof RED_STATUT_SEUILS_LIBELLES;
  remplacee?: boolean;
}): string {
  if (v.statut === "brouillon") return libelleStatutSeuils("brouillon");
  return v.remplacee === true ? "Remplacée" : "En vigueur";
}

export function tonaliteEtatVersionSeuils(v: {
  statut: keyof typeof RED_STATUT_SEUILS_LIBELLES;
  remplacee?: boolean;
}): TonaliteStatut {
  if (v.statut === "brouillon") return "attention";
  return v.remplacee === true ? "neutre" : "succes";
}
export const libelleSensFlux = (s: RedSensFlux) => RED_SENS_FLUX_LIBELLES[s] ?? s;
export const libellePoste = (p: string) => (RED_POSTE_LIBELLES as Record<string, string>)[p] ?? p;
export const libelleLevier = (c: keyof typeof RED_LEVIER_LIBELLES) => RED_LEVIER_LIBELLES[c] ?? c;
export const libelleFamilleLevier = (f: keyof typeof RED_FAMILLE_LEVIER_LIBELLES) =>
  RED_FAMILLE_LEVIER_LIBELLES[f] ?? f;
export const libelleCritere = (c: RedCritereAlerte) => RED_CRITERE_ALERTE_LIBELLES[c] ?? c;

/** Libellé d'une catégorie de flux (le sens est porté par la ligne). */
export const libelleCategorieFlux = (categorie: string) =>
  (RED_CATEGORIE_FLUX_LIBELLES as Record<string, string>)[categorie] ?? categorie;

/** Catégories proposées pour un sens, avec leurs libellés. */
export function optionsCategories(sens: RedSensFlux): { valeur: string; libelle: string }[] {
  const liste: readonly string[] =
    sens === "encaissement" ? RED_CATEGORIES_ENCAISSEMENT : RED_CATEGORIES_DECAISSEMENT;
  return liste.map((c) => ({ valeur: c, libelle: libelleCategorieFlux(c) }));
}

export const RED_SENS_OPTIONS = (Object.keys(RED_SENS_FLUX_LIBELLES) as RedSensFlux[]).map((s) => ({
  valeur: s,
  libelle: RED_SENS_FLUX_LIBELLES[s],
}));

/** Libellé d'un secteur par défaut « Général » pour une valeur inconnue de cette version du web. */
export const OPTIONS_SECTEURS = RED_SECTEURS.map((s) => ({
  valeur: s,
  libelle: RED_SECTEUR_LIBELLES[s],
}));
export const OPTIONS_STATUTS_DOSSIER = RED_STATUTS_DOSSIER.map((s) => ({
  valeur: s,
  libelle: RED_STATUT_DOSSIER_LIBELLES[s],
}));

// --- Tonalités (le texte accompagne toujours la couleur et l'icône) -------------------------------

export function tonaliteVoyant(v: RedVoyant): TonaliteStatut {
  if (v === "vert") return "succes";
  if (v === "orange") return "attention";
  if (v === "rouge") return "danger";
  return "neutre";
}

export function tonaliteNiveauAlerte(n: RedNiveauAlerte): TonaliteStatut {
  if (n === "faible") return "succes";
  if (n === "modere") return "attention";
  if (n === "eleve" || n === "critique") return "danger";
  return "neutre";
}

export function tonaliteStatutDossier(s: RedStatutDossier): TonaliteStatut {
  return s === "plan_valide" || s === "mise_en_oeuvre" ? "succes" : "neutre";
}

export function tonaliteStatutAccord(s: RedStatutAccord): TonaliteStatut {
  if (s === "respecte") return "succes";
  if (s === "en_retard" || s === "rompu") return "danger";
  return "neutre";
}

export function tonaliteStatutAction(s: RedStatutAction): TonaliteStatut {
  if (s === "terminee") return "succes";
  if (s === "bloquee") return "danger";
  if (s === "en_cours") return "attention";
  return "neutre";
}
