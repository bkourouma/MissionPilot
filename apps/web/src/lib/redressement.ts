/**
 * Redressement (service #5, lot 3a : RED-01, 02, 05, 06, 07, 10, 11, 12, 14) : chemins d'API,
 * liens, droits d'affichage, libellés, mise en forme et messages. Logique pure, testée dans
 * `redressement.test.ts`.
 *
 * Tous les chiffres (ratios, voyants, score, soldes, écarts, point mort, situations des créanciers,
 * avancement du plan, impacts des leviers) sont ceux de l'API, qui les tire de
 * `packages/engines/src/redressement` : ce module les MET EN FORME et ne les recalcule jamais
 * (ni ratio, ni solde, ni écart, ni imputation d'un paiement). Les transitions « autorisées »
 * ne sont qu'une suggestion d'affichage : l'API juge.
 *
 * Aucun texte ne qualifie juridiquement la situation du client : un voyant ou un score est un
 * constat de saisie, jamais un statut de droit (SPEC-3a, §10.6).
 */
import {
  aPermission,
  RED_CATEGORIE_DECAISSEMENT_LIBELLES,
  RED_CATEGORIE_ENCAISSEMENT_LIBELLES,
  RED_CATEGORIE_FLUX_LIBELLES,
  RED_CATEGORIE_CREANCIER_LIBELLES,
  RED_CRITERE_ALERTE_LIBELLES,
  RED_DOMAINE_LIBELLES,
  RED_FAMILLE_LEVIER_LIBELLES,
  RED_LEVIER_LIBELLES,
  RED_NIVEAU_ALERTE_LIBELLES,
  RED_POSTE_LIBELLES,
  RED_RAISON_RATIO_LIBELLES,
  RED_RATIO_LIBELLES,
  RED_REPONSE_URGENCE_LIBELLES,
  RED_SECTEUR_LIBELLES,
  RED_SECTEURS,
  RED_SENS_FLUX_LIBELLES,
  RED_SOURCE_SEUILS_LIBELLES,
  RED_STATUT_ACCORD_LIBELLES,
  RED_STATUT_ACTION_LIBELLES,
  RED_STATUT_DOSSIER_LIBELLES,
  RED_STATUT_RATIO_LIBELLES,
  RED_STATUT_SEUILS_LIBELLES,
  RED_STATUT_VERSION_PLAN_LIBELLES,
  RED_STATUTS_ACTION,
  RED_STATUTS_DOSSIER,
  RED_TYPE_EVENEMENT_ACTION_LIBELLES,
  RED_TYPE_EVENEMENT_NEGOCIATION_LIBELLES,
  RED_VOLET_LIBELLES,
  RED_VOYANT_LIBELLES,
  RED_CATEGORIES_DECAISSEMENT,
  RED_CATEGORIES_ENCAISSEMENT,
  type RedCategorieCreancier,
  type RedCleRatio,
  type RedCritereAlerte,
  type RedDossierResume,
  type RedDossierVue,
  type RedEcartPlanVue,
  type RedNiveauAlerte,
  type RedRaisonRatio,
  type RedRatioVue,
  type RedSecteur,
  type RedSensFlux,
  type RedSourceSeuils,
  type RedStatutAccord,
  type RedStatutAction,
  type RedStatutDossier,
  type RedVoyant,
  type Role,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import { ErreurApi, messageErreur, CODE_ORIGINE_REFUSEE, CODE_TFA_A_CONFIGURER } from "./api";
import { formaterDate, formaterNombre, VALEUR_ABSENTE } from "./format";
import type { MissionDetaillee } from "./missions";

// --- Chemins d'API (un par route de SPEC-3a §9.3) -----------------------------------------------

const enc = encodeURIComponent;

export const CHEMIN_REFERENTIEL_RED = "/api/redressement/referentiel";
export const CHEMIN_SEUILS_RED = "/api/redressement/seuils";

export interface FiltresPortefeuille {
  statut?: RedStatutDossier;
  secteur?: RedSecteur;
  q?: string;
  curseur?: string;
}

function requete(parametres: Record<string, string | undefined>): string {
  const r = new URLSearchParams();
  for (const [cle, valeur] of Object.entries(parametres)) {
    if (valeur !== undefined && valeur !== "") r.set(cle, valeur);
  }
  const texte = r.toString();
  return texte === "" ? "" : `?${texte}`;
}

/** Route 2 : portefeuille (la `limite` est celle par défaut de l'API, 30). */
export function cheminDossiersRed(filtres: FiltresPortefeuille = {}): string {
  return `/api/redressement/dossiers${requete({
    statut: filtres.statut,
    secteur: filtres.secteur,
    q: filtres.q,
    curseur: filtres.curseur,
  })}`;
}

/** Routes 3 et 4 : ouvrir (POST) et lire (GET) le dossier d'une mission. */
export const cheminDossierMission = (missionId: string) =>
  `/api/missions/${enc(missionId)}/redressement`;
/** Routes 5 et 6. */
export const cheminDossierRed = (id: string) => `/api/redressement/dossiers/${enc(id)}`;
/** Route 7. */
export const cheminStatutDossier = (id: string) => `${cheminDossierRed(id)}/statut`;
/** Routes 8 et 9. */
export const cheminCorrespondances = (id: string) => `${cheminDossierRed(id)}/correspondances`;
/** Route 10. */
export const cheminRatios = (id: string) => `${cheminDossierRed(id)}/ratios`;
/** Routes 11 et 12 (`limite` : 50 au plus, `RED_LIMITE_HISTORIQUE_MAX`). */
export const cheminUrgences = (id: string, curseur?: string | null) =>
  `${cheminDossierRed(id)}/urgences${requete({ curseur: curseur ?? undefined })}`;
/** Route 13 (le secteur est facultatif). */
export const cheminSeuilsSecteur = (secteur?: RedSecteur) =>
  `${CHEMIN_SEUILS_RED}${requete({ secteur })}`;
/** Route 15. */
export const cheminPublicationSeuils = (versionId: string) =>
  `${CHEMIN_SEUILS_RED}/${enc(versionId)}/publication`;
/** Routes 16 et 17. */
export const cheminScores = (id: string, curseur?: string | null) =>
  `${cheminDossierRed(id)}/scores${requete({ curseur: curseur ?? undefined })}`;
/** Route 18. */
export const cheminTresorerie = (id: string) => `${cheminDossierRed(id)}/tresorerie`;
/** Route 19. */
export const cheminVersionsTresorerie = (id: string) => `${cheminTresorerie(id)}/versions`;
/** Route 20. */
export const cheminRealises = (id: string) => `${cheminTresorerie(id)}/realises`;
/** Route 21. */
export const cheminEcheancesAccords = (id: string) => `${cheminTresorerie(id)}/echeances-accords`;
/** Route 22. */
export const cheminPointMort = (id: string) => `${cheminDossierRed(id)}/point-mort`;
/** Routes 23 et 24 : `actifs` vaut `true` (défaut), `false` ou `tous`. */
export const cheminCreanciers = (id: string, actifs: "true" | "false" | "tous" = "true") =>
  `${cheminDossierRed(id)}/creanciers${requete({ actifs: actifs === "true" ? undefined : actifs })}`;
/** Routes 25 et 26. */
export const cheminCreancier = (id: string) => `/api/redressement/creanciers/${enc(id)}`;
/** Route 27. */
export const cheminCreances = (id: string) => `${cheminCreancier(id)}/creances`;
/** Route 28. */
export const cheminEvenements = (id: string) => `${cheminCreancier(id)}/evenements`;
/** Routes 29. */
export const cheminPlan = (id: string) => `${cheminDossierRed(id)}/plan`;
/** Route 30. */
export const cheminActionsDossier = (id: string) => `${cheminDossierRed(id)}/actions`;
/** Routes 31 et 34. */
export const cheminAction = (id: string) => `/api/redressement/actions/${enc(id)}`;
/** Route 32. */
export const cheminDeplacementAction = (id: string) => `${cheminAction(id)}/deplacement`;
/** Route 33. */
export const cheminCommentairesAction = (id: string) => `${cheminAction(id)}/commentaires`;
/** Route 35. */
export const cheminVersionsPlan = (id: string) => `${cheminPlan(id)}/versions`;
/** Route 36. */
export const cheminValidationPlan = (versionId: string) =>
  `/api/redressement/plan/versions/${enc(versionId)}/validation`;
/** Route 37. */
export const cheminSimulationLevier = (id: string) => `${cheminDossierRed(id)}/leviers/simulation`;

// --- Liens des pages ------------------------------------------------------------------------------

export const HREF_PORTEFEUILLE_RED = "/redressement";
export const HREF_SEUILS_RED = "/redressement/seuils";

export type SectionRedressement =
  "ratios" | "urgence" | "alerte" | "tresorerie" | "creanciers" | "plan" | "leviers";

/** Synthèse du dossier (sans `section`) ou l'une de ses sections. */
export function hrefRedressement(missionId: string, section?: SectionRedressement): string {
  const base = `/missions/${enc(missionId)}/redressement`;
  return section ? `${base}/${section}` : base;
}

export const hrefCreancierRed = (missionId: string, creancierId: string) =>
  `${hrefRedressement(missionId, "creanciers")}/${enc(creancierId)}`;

/** Lien « Créer une action avec ce levier » (le formulaire du plan préremplit le levier). */
export const hrefPlanAvecLevier = (missionId: string, code: string) =>
  `${hrefRedressement(missionId, "plan")}${requete({ levier: code })}`;

export function hrefPortefeuille(filtres: FiltresPortefeuille = {}): string {
  return `${HREF_PORTEFEUILLE_RED}${requete({
    statut: filtres.statut,
    secteur: filtres.secteur,
    q: filtres.q,
    curseur: filtres.curseur,
  })}`;
}

export const hrefSeuilsSecteur = (secteur: RedSecteur) =>
  `${HREF_SEUILS_RED}${requete({ secteur })}`;

/** Lien vers les finances du client (états financiers du dossier client). */
export const hrefFinancesClient = (clientId: string) => `/dossiers/${enc(clientId)}/finances`;

/** Sections du dossier, dans l'ordre des onglets. */
export function sousPagesRedressement(
  missionId: string,
): { id: string; libelle: string; href: string }[] {
  return [
    { id: "synthese", libelle: "Synthèse", href: hrefRedressement(missionId) },
    { id: "ratios", libelle: "Ratios", href: hrefRedressement(missionId, "ratios") },
    { id: "urgence", libelle: "Urgence", href: hrefRedressement(missionId, "urgence") },
    { id: "alerte", libelle: "Alerte précoce", href: hrefRedressement(missionId, "alerte") },
    { id: "tresorerie", libelle: "Trésorerie", href: hrefRedressement(missionId, "tresorerie") },
    { id: "creanciers", libelle: "Créanciers", href: hrefRedressement(missionId, "creanciers") },
    { id: "plan", libelle: "Plan", href: hrefRedressement(missionId, "plan") },
    { id: "leviers", libelle: "Leviers", href: hrefRedressement(missionId, "leviers") },
  ];
}

// --- Filtres du portefeuille (paramètres d'URL) --------------------------------------------------

const un = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Filtres lus dans l'URL : une valeur hors liste est ignorée (l'API refuserait la requête). */
export function lireFiltresPortefeuille(
  p: Record<string, string | string[] | undefined>,
): FiltresPortefeuille {
  const statut = un(p.statut);
  const secteur = un(p.secteur);
  const q = un(p.q).trim().slice(0, 100);
  const curseur = un(p.curseur);
  return {
    statut: (RED_STATUTS_DOSSIER as readonly string[]).includes(statut)
      ? (statut as RedStatutDossier)
      : undefined,
    secteur: (RED_SECTEURS as readonly string[]).includes(secteur)
      ? (secteur as RedSecteur)
      : undefined,
    q: q === "" ? undefined : q,
    curseur: curseur === "" || curseur.length > 500 ? undefined : curseur,
  };
}

/** Secteur lu dans l'URL de la page des seuils (« Général » par défaut). */
export function lireSecteur(v: string | string[] | undefined): RedSecteur {
  const brut = un(v);
  return (RED_SECTEURS as readonly string[]).includes(brut) ? (brut as RedSecteur) : "general";
}

// --- Droits d'affichage (confort : l'API reste seule juge) ----------------------------------------

export interface DroitsRedressement {
  lire: boolean;
  /** Ouvrir le dossier d'une mission : directeur, chef ou « modifier toutes les missions ». */
  ouvrir: boolean;
  ecrire: boolean;
  valider: boolean;
  parametrer: boolean;
  assignerTache: boolean;
}

type MissionDroits = Pick<MissionDetaillee, "statut" | "directeur_id" | "chef_id" | "equipe">;

/**
 * Miroir de SPEC-3a §9.1 : `ouvrir` = `redressement.ecrire`, mission modifiable (modifier toutes
 * les missions, directeur ou chef) non clôturée ; `ecrire` = `redressement.ecrire`, mission
 * modifiable OU membre de l'équipe, mission non clôturée, dossier non clos ; `valider`,
 * `parametrer` et `assignerTache` = la permission seule (la séparation des tâches est jugée par
 * l'API).
 */
export function droitsRedressement(
  roles: readonly Role[],
  utilisateurId: string,
  mission: MissionDroits,
  dossier?: Pick<RedDossierResume, "statut"> | null,
): DroitsRedressement {
  const a = (p: Parameters<typeof aPermission>[1]) => aPermission(roles, p);
  const ouverte = mission.statut !== "cloturee";
  const responsable =
    a("mission.modifier_toutes") ||
    (mission.directeur_id !== null && mission.directeur_id === utilisateurId) ||
    (mission.chef_id !== null && mission.chef_id === utilisateurId);
  const equipe = mission.equipe.some((e) => e.utilisateur_id === utilisateurId);
  const ecritureOuverte = a("redressement.ecrire") && ouverte;
  return {
    lire: a("redressement.lire"),
    ouvrir: ecritureOuverte && responsable,
    ecrire: ecritureOuverte && (responsable || equipe) && dossier?.statut !== "clos",
    valider: a("redressement.valider"),
    parametrer: a("redressement.parametrer"),
    assignerTache: a("tache.assigner"),
  };
}

/** Raison affichée quand l'écriture n'est pas proposée (jamais de bouton désactivé sans raison). */
export function raisonSansEcriture(
  mission: Pick<MissionDetaillee, "statut">,
  dossier: Pick<RedDossierResume, "statut"> | null,
  roles: readonly Role[],
): string {
  if (mission.statut === "cloturee") {
    return "La mission est clôturée : le dossier de redressement est en lecture seule.";
  }
  if (dossier?.statut === "clos") return "Le dossier est clos : il est en lecture seule.";
  if (!aPermission(roles, "redressement.ecrire")) {
    return "Votre rôle permet de consulter le dossier de redressement, pas de le modifier.";
  }
  return "La saisie est réservée au directeur, au chef de mission et aux membres de l'équipe.";
}

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

// --- Ratios -----------------------------------------------------------------------------------------

/** Forme d'affichage de la valeur d'un ratio ou d'un critère (la valeur vient de l'API). */
export type FormeValeur = "ratio" | "pourcentage" | "jours" | "nombre" | "oui_non";

export const FORME_RATIO: Record<RedCleRatio, FormeValeur> = {
  liquidite_generale: "ratio",
  liquidite_reduite: "ratio",
  liquidite_immediate: "ratio",
  autonomie_financiere: "pourcentage",
  solvabilite_generale: "ratio",
  endettement: "ratio",
  marge_brute: "pourcentage",
  marge_nette: "pourcentage",
  couverture_charges_financieres: "ratio",
  bfr_jours: "jours",
};

export const FORME_CRITERE: Record<RedCritereAlerte, FormeValeur> = {
  liquidite_generale: "ratio",
  liquidite_immediate: "ratio",
  autonomie_financiere: "pourcentage",
  endettement: "ratio",
  couverture_charges_financieres: "ratio",
  marge_nette: "pourcentage",
  bfr_jours: "jours",
  croissance_ca: "pourcentage",
  variation_marge_brute: "pourcentage",
  rejets_bancaires_12m: "nombre",
  retards_fournisseurs_90j: "nombre",
  arrieres_fiscaux_sociaux: "oui_non",
};

/** Formule courte de chaque ratio (aide à la lecture : le calcul est celui du moteur). */
export const FORMULES_RATIO: Record<RedCleRatio, string> = {
  liquidite_generale: "(Stocks + créances + trésorerie) ÷ dettes à court terme",
  liquidite_reduite: "(Créances + trésorerie) ÷ dettes à court terme",
  liquidite_immediate: "Trésorerie ÷ dettes à court terme",
  autonomie_financiere: "Capitaux propres ÷ total du passif",
  solvabilite_generale: "Total de l'actif ÷ dettes (passif − capitaux propres)",
  endettement: "Dettes financières ÷ capitaux propres",
  marge_brute: "(Chiffre d'affaires − coût des ventes) ÷ chiffre d'affaires",
  marge_nette: "Résultat net ÷ chiffre d'affaires",
  couverture_charges_financieres: "Résultat d'exploitation ÷ charges financières",
  bfr_jours: "(Stocks + créances clients − dettes fournisseurs) ÷ chiffre d'affaires × 360 jours",
};

const DEUX_DECIMALES = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const POURCENTAGE = new Intl.NumberFormat("fr-FR", {
  style: "percent",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Points de base (10 000 = 1) → « 1,36 » ou « 18,75 % » selon la forme ; `null` → « — ». */
export function formaterPointsDeBase(
  valeur: number | null | undefined,
  forme: "ratio" | "pourcentage",
): string {
  if (typeof valeur !== "number" || !Number.isFinite(valeur)) return VALEUR_ABSENTE;
  return forme === "pourcentage"
    ? POURCENTAGE.format(valeur / 10_000)
    : DEUX_DECIMALES.format(valeur / 10_000);
}

function formaterSelonForme(forme: FormeValeur, valeur: number | null | undefined): string {
  if (typeof valeur !== "number" || !Number.isFinite(valeur)) return VALEUR_ABSENTE;
  if (forme === "ratio" || forme === "pourcentage") return formaterPointsDeBase(valeur, forme);
  if (forme === "jours")
    return `${formaterNombre(valeur, 0)} ${Math.abs(valeur) > 1 ? "jours" : "jour"}`;
  if (forme === "oui_non") return valeur > 0 ? "Oui" : "Non";
  return formaterNombre(valeur, 0);
}

/**
 * Valeur d'un ratio : liquidités, solvabilité, couverture et endettement en rapport (13636 →
 * « 1,36 ») ; autonomie et marges en pourcentage (1875 → « 18,75 % ») ; BFR en jours (54 →
 * « 54 jours »).
 */
export function formaterValeurRatio(cle: RedCleRatio, valeur: number | null | undefined): string {
  return formaterSelonForme(FORME_RATIO[cle] ?? "nombre", valeur);
}

/** Valeur d'un critère de l'alerte précoce (même mise en forme que le ratio correspondant). */
export function formaterValeurCritere(
  critere: RedCritereAlerte,
  valeur: number | null | undefined,
): string {
  return formaterSelonForme(FORME_CRITERE[critere] ?? "nombre", valeur);
}

/** Seuil d'un critère : même mise en forme que la valeur, sauf « oui / non » (valeur technique). */
export function formaterSeuil(
  critere: RedCritereAlerte,
  valeur: number | null | undefined,
): string {
  if (FORME_CRITERE[critere] === "oui_non") return formaterNombre(valeur, 0);
  return formaterValeurCritere(critere, valeur);
}

const enMinuscule = (t: string) => (t === "" ? t : t.charAt(0).toLowerCase() + t.slice(1));

/** « Postes à renseigner : Stocks, Créances clients » ; les autres raisons gardent leur libellé. */
export function libelleRaisonRatio(
  raison: RedRaisonRatio | null,
  manquants: readonly string[] = [],
): string {
  if (raison === null) return "";
  const libelle = RED_RAISON_RATIO_LIBELLES[raison] ?? raison;
  if (raison === "postes_manquants" && manquants.length > 0) {
    return `${libelle} : ${manquants.map(libellePoste).join(", ")}`;
  }
  return libelle;
}

/**
 * Texte d'une cellule du tableau des ratios : la valeur formatée, ou le statut avec sa raison
 * (« Non calculable : postes à renseigner (Stocks, …) », « Non significatif : capitaux propres
 * négatifs ou nuls »).
 */
export function libelleStatutRatio(cle: RedCleRatio, ratio: RedRatioVue): string {
  if (ratio.statut === "calcule") return formaterValeurRatio(cle, ratio.valeur);
  const statut = RED_STATUT_RATIO_LIBELLES[ratio.statut] ?? ratio.statut;
  if (ratio.statut === "non_significatif" && ratio.raison === "denominateur_non_positif") {
    return `${statut} : capitaux propres négatifs ou nuls`;
  }
  if (ratio.raison === "postes_manquants") {
    const noms = ratio.manquants.map(libellePoste).join(", ");
    return `${statut} : postes à renseigner${noms ? ` (${noms})` : ""}`;
  }
  if (ratio.raison === null) return statut;
  return `${statut} : ${enMinuscule(libelleRaisonRatio(ratio.raison))}`;
}

/** Motif d'un critère de l'alerte précoce (« — » quand le critère est évalué normalement). */
export function motifCritere(
  motif: "signal_critique" | "sans_objet" | "non_calculable" | "non_renseigne" | null,
): string {
  if (motif === "signal_critique") return "Signal critique";
  if (motif === "sans_objet") return "Sans objet";
  if (motif === "non_calculable") return "Non calculable";
  if (motif === "non_renseigne") return "Non renseigné";
  return VALEUR_ABSENTE;
}

/** Tendances : « +12,50 % » / « -3,00 % » (points de base de l'API) ; `null` → « — ». */
export function formaterTendance(pb: number | null | undefined): string {
  if (typeof pb !== "number" || !Number.isFinite(pb)) return VALEUR_ABSENTE;
  const texte = formaterPointsDeBase(pb, "pourcentage");
  return pb > 0 ? `+${texte}` : texte;
}

// --- Alerte précoce -------------------------------------------------------------------------------

/** « Seuils du cabinet, secteur Général, version 2 » ou « Seuils par défaut du moteur (provisoires) ». */
export function libelleSourceSeuils(
  source: RedSourceSeuils,
  secteur: RedSecteur | null,
  version: number | null,
): string {
  if (source === "defaut_moteur") return "Seuils par défaut du moteur (provisoires)";
  const base = RED_SOURCE_SEUILS_LIBELLES[source];
  const sect = secteur ? `, secteur ${libelleSecteur(secteur)}` : "";
  const v = version !== null ? `, version ${version}` : "";
  return `${base}${sect}${v}`;
}

/** Score sur 100 ou « Données insuffisantes ». */
export function libelleScore(score: number | null, niveau: RedNiveauAlerte): string {
  if (score === null || niveau === "insuffisant") return "Données insuffisantes";
  return `${formaterNombre(score, 0)} sur 100`;
}

/** Unité affichée à côté des seuils d'un critère (aide de l'éditeur). */
export function uniteCritere(critere: RedCritereAlerte): string {
  const forme = FORME_CRITERE[critere];
  if (forme === "ratio") return "rapport (1,00 = 100 %)";
  if (forme === "pourcentage") return "pourcentage";
  if (forme === "jours") return "jours";
  if (forme === "oui_non") return "0 : un arriéré déclaré suffit (valeur technique)";
  return "nombre d'incidents";
}

/** Sens de lecture d'un critère, en français (affiché dans le tableau des seuils). */
export function libelleSensCritere(sens: "bas_pire" | "haut_pire"): string {
  return sens === "bas_pire"
    ? "Plus la valeur est basse, plus c'est préoccupant"
    : "Plus la valeur est haute, plus c'est préoccupant";
}

// --- Synthèse du dossier ------------------------------------------------------------------------

/** Libellé de la carte Trésorerie de la synthèse. */
export function libellePremiereTension(t: RedDossierVue["tresorerie"]): string {
  if (t === null) return "Aucune prévision";
  if (t.premiere_semaine_tension === null) return "Aucune semaine de tension sur 13 semaines";
  return `Première semaine de tension : semaine ${t.premiere_semaine_tension}`;
}

/** « 33 % » : avancement en points de base de l'API ; `null` → « Sans objet ». */
export function libelleAvancement(pb: number | null | undefined): string {
  if (typeof pb !== "number" || !Number.isFinite(pb)) return "Sans objet";
  return `${formaterNombre(pb / 100, 0)} %`;
}

/** Largeur (0 à 100) d'une barre d'avancement ; la valeur est celle de l'API, bornée pour l'affichage. */
export function largeurBarre(pb: number | null | undefined): number {
  if (typeof pb !== "number" || !Number.isFinite(pb)) return 0;
  return Math.min(100, Math.max(0, Math.round(pb / 100)));
}

/** « Écart avec la version validée : 1 ajoutée(s), 0 retirée(s), 2 modifiée(s) ». */
export function libelleEcartPlan(e: RedEcartPlanVue): string {
  return `Écart avec la version validée : ${e.ajoutees.length} ajoutée(s), ${e.retirees.length} retirée(s), ${e.modifiees.length} modifiée(s)`;
}

// --- Trésorerie -----------------------------------------------------------------------------------

/** « 2 nov. 2026 au 8 nov. 2026 » (dates de début et de fin d'une semaine de la fenêtre). */
export function formaterSemaine(debut: string, fin: string): string {
  return `${formaterDate(debut)} au ${formaterDate(fin)}`;
}

/** Abréviation d'une semaine : « S4 ». */
export const abregerSemaine = (n: number) => `S${n}`;

// --- Plan et kanban -------------------------------------------------------------------------------

/**
 * Miroir d'AFFICHAGE de la matrice d'actions du moteur (`transitionActionAdmise`) : propose les
 * statuts de la liste « Déplacer vers… ». L'API refuse toute transition non admise.
 */
export const TRANSITIONS_SUGGEREES: Readonly<Record<RedStatutAction, readonly RedStatutAction[]>> =
  {
    a_faire: ["en_cours", "bloquee", "terminee", "abandonnee"],
    en_cours: ["bloquee", "terminee", "abandonnee"],
    bloquee: ["en_cours", "abandonnee"],
    terminee: [],
    abandonnee: [],
  };

export function statutsSuggeres(statut: RedStatutAction): { valeur: string; libelle: string }[] {
  return (TRANSITIONS_SUGGEREES[statut] ?? []).map((s) => ({
    valeur: s,
    libelle: RED_STATUT_ACTION_LIBELLES[s],
  }));
}

/** Un motif est demandé pour « Bloquée » et « Abandonnée ». */
export const exigeMotifAction = (vers: RedStatutAction) =>
  vers === "bloquee" || vers === "abandonnee";
/** Une date de fin est demandée pour « Terminée ». */
export const exigeDateFinAction = (vers: RedStatutAction) => vers === "terminee";

export interface CarteRang {
  id: string;
  rang: number;
}

/** Plafond du rang accepté par l'API (schéma partagé : 0 à 100 000). */
const RANG_MAX = 100_000;

/**
 * Mises à jour de rang à envoyer pour déplacer une action d'un cran dans sa colonne, ou `null`
 * au bord de la colonne. Le rang est une CLÉ DE TRI (l'API ordonne par rang, puis échéance, puis
 * numéro), pas une position : après l'échange, les rangs sont rendus strictement croissants en
 * conservant ceux qui le sont déjà, ce qui lève aussi les égalités (rang 0 par défaut). Seules
 * les cartes dont le rang change sont renvoyées.
 */
export function majsRangApresDeplacement(
  colonne: readonly CarteRang[],
  id: string,
  sens: "monter" | "descendre",
): CarteRang[] | null {
  const i = colonne.findIndex((c) => c.id === id);
  if (i < 0) return null;
  const j = sens === "monter" ? i - 1 : i + 1;
  if (j < 0 || j >= colonne.length) return null;
  const ordre = [...colonne];
  const [a, b] = [ordre[i], ordre[j]];
  if (!a || !b) return null;
  ordre[i] = b;
  ordre[j] = a;
  const majs: CarteRang[] = [];
  let dernier = -1;
  for (const carte of ordre) {
    const rang = carte.rang > dernier ? carte.rang : dernier + 1;
    if (rang > RANG_MAX) return null;
    if (rang !== carte.rang) majs.push({ id: carte.id, rang });
    dernier = rang;
  }
  return majs;
}

export const STATUTS_ACTION_OPTIONS = RED_STATUTS_ACTION.map((s) => ({
  valeur: s,
  libelle: RED_STATUT_ACTION_LIBELLES[s],
}));

// --- Créanciers ----------------------------------------------------------------------------------

/** Part garantie ou concentration (points de base de l'API) : « 12,50 % » ; `null` → « — ». */
export function formaterPart(pb: number | null | undefined): string {
  return formaterPointsDeBase(pb, "pourcentage");
}

// --- Liste tronquée ---------------------------------------------------------------------------------

/** Avertissement quand une liste chargée page par page a été coupée par le garde-fou. */
export function avertissementTronque(tronquee: boolean): string | null {
  return tronquee
    ? "La liste est trop longue pour être affichée en entier : affinez les filtres ou ouvrez un élément précis."
    : null;
}

// --- Messages d'erreur ------------------------------------------------------------------------------

/** « Il manque des postes dans la correspondance : Stocks, Créances clients. » */
export function messageBaseIncomplete(manquants: readonly string[]): string {
  const liste = manquants.map(libellePoste).join(", ");
  return liste === ""
    ? "Il manque des postes dans la correspondance."
    : `Il manque des postes dans la correspondance : ${liste}.`;
}

function manquantsDe(details: unknown): string[] {
  if (typeof details !== "object" || details === null) return [];
  const m = (details as { manquants?: unknown }).manquants;
  return Array.isArray(m) ? m.filter((x): x is string => typeof x === "string") : [];
}

/**
 * Message affichable (français). Un refus de l'API (400 métier, 403, 404, 409, 429) s'affiche tel
 * quel : ses messages sont en français et ne recopient ni montant ni nom (SPEC-3a §9.4).
 */
export function messageRedressement(e: unknown): string {
  if (e instanceof ErreurApi) {
    if (e.code === "RED_BASE_INCOMPLETE") return messageBaseIncomplete(manquantsDe(e.details));
    if (e.code === CODE_TFA_A_CONFIGURER || e.code === CODE_ORIGINE_REFUSEE) {
      return messageErreur(e);
    }
    const generique = e.code === "REQUETE_INVALIDE" && e.message === "Données invalides.";
    if (!generique && e.statut >= 400 && e.statut < 500) return e.message;
  }
  return messageErreur(e);
}

/** Vrai pour les refus qui laissent penser que l'écran est périmé (rafraîchir les données). */
export const etatRedressementChange = (e: unknown) =>
  e instanceof ErreurApi && (e.statut === 404 || e.statut === 409);

// --- Ensemble des libellés exportés (test : aucune qualification juridique) -----------------------

/** Mots qu'aucun écran n'emploie (SPEC-3a §10.6). */
export const MOTS_INTERDITS = [
  "cessation des paiements",
  "faillite",
  "défaillance",
  "état de crise",
  "en difficulté",
] as const;

/** Tous les textes que ce module et les libellés partagés mettent à l'écran. */
export function tousLesLibelles(): string[] {
  const cartes: Record<string, string>[] = [
    RED_SECTEUR_LIBELLES,
    RED_STATUT_DOSSIER_LIBELLES,
    RED_POSTE_LIBELLES,
    RED_RATIO_LIBELLES,
    RED_STATUT_RATIO_LIBELLES,
    RED_RAISON_RATIO_LIBELLES,
    RED_DOMAINE_LIBELLES,
    RED_REPONSE_URGENCE_LIBELLES,
    RED_VOYANT_LIBELLES,
    RED_CRITERE_ALERTE_LIBELLES,
    RED_NIVEAU_ALERTE_LIBELLES,
    RED_STATUT_SEUILS_LIBELLES,
    RED_SOURCE_SEUILS_LIBELLES,
    RED_CATEGORIE_ENCAISSEMENT_LIBELLES,
    RED_CATEGORIE_DECAISSEMENT_LIBELLES,
    RED_CATEGORIE_CREANCIER_LIBELLES,
    RED_TYPE_EVENEMENT_NEGOCIATION_LIBELLES,
    RED_STATUT_ACCORD_LIBELLES,
    RED_VOLET_LIBELLES,
    RED_STATUT_ACTION_LIBELLES,
    RED_TYPE_EVENEMENT_ACTION_LIBELLES,
    RED_STATUT_VERSION_PLAN_LIBELLES,
    RED_LEVIER_LIBELLES,
    RED_FAMILLE_LEVIER_LIBELLES,
    RED_SENS_FLUX_LIBELLES,
    FORMULES_RATIO,
  ];
  return [
    ...cartes.flatMap((c) => Object.values(c)),
    MENTION_SCORE,
    AVERTISSEMENT_SEUILS_DEFAUT,
    TEXTE_TENSION,
    BANDEAU_CONFIDENTIALITE,
    TEXTE_LEVIERS,
    TEXTE_ANALYSES_INDICATIVES,
    AVERTISSEMENT_CORRESPONDANCE,
    TEXTE_URGENCE_INTRO,
    TEXTE_PUBLICATION_SEUILS,
    TEXTE_VALIDATION_PLAN,
    TEXTE_SEUILS_AUCUNE_VERSION,
    TEXTE_PLAN_MODIFIE,
    TEXTE_ETATS_ABSENTS,
  ];
}
