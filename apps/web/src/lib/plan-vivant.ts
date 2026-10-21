/**
 * Plan vivant (PLA-18) : types des réponses de l'API, saisie et contrôle des réalisés, libellés,
 * lignes des tableaux d'écarts, phrase d'explication de l'écart d'EBE, chemins et messages. Logique
 * pure, testée dans `plan-vivant.test.ts`.
 *
 * RÈGLE : aucun chiffre métier n'est calculé ici. Écarts, écarts relatifs, marqueur « significatif »,
 * re-prévision annuelle, effet volume et effet de marge viennent TELS QUELS de l'API (moteur
 * `reprevoirExercice`) ; ce module choisit des champs, les met en forme et convertit les montants
 * saisis (unités usuelles) en unités mineures entières. Le plan validé n'est jamais modifié.
 */
import {
  COMMENTAIRE_REALISE_MAX,
  EXERCICE_PLAN_VIVANT,
  METHODE_REPREVISION_PLAN_LIBELLES,
  METHODES_REPREVISION_PLAN,
  SEUIL_REPREVISION_PLAN,
  type MethodeReprevisionPlan,
} from "@missionpilot/shared";
import { ErreurApi, messageErreur } from "./api";
import { formaterMontantMineur, formaterPourcentage, VALEUR_ABSENTE, type Devise } from "./format";
import { cheminPlan, hrefPlan } from "./plan-strategique";
import { lireNombre } from "./saisie";

export { METHODES_REPREVISION_PLAN, type MethodeReprevisionPlan };

// --- Réponses de l'API -------------------------------------------------------------------------

export interface RealiseVersion {
  id: string;
  exercice: number;
  trimestre: number;
  version: number;
  chiffre_affaires: number;
  ebe: number;
  resultat_net: number | null;
  tresorerie_fin: number | null;
  commentaire: string | null;
  cree_par: string;
  auteur_nom: string;
  cree_le: string;
}

export interface GroupeRealise {
  exercice: number;
  trimestre: number;
  courant: RealiseVersion;
  /** De la version la plus récente à la plus ancienne. */
  versions: RealiseVersion[];
}

export interface ReponseRealises {
  realises: GroupeRealise[];
}

export interface EcartMesure {
  prevu: number;
  reel: number | null;
  ecart: number | null;
  ecartRelatifPointsDeBase: number | null;
  significatif: boolean;
}

export interface EcartsTrimestre {
  trimestre: number;
  chiffreAffaires: EcartMesure;
  excedentBrutExploitation: EcartMesure;
  resultatNet: EcartMesure;
  tresorerieFin: EcartMesure;
}

export interface EcartsCumules {
  trimestre: number;
  chiffreAffaires: EcartMesure;
  excedentBrutExploitation: EcartMesure;
  resultatNet: EcartMesure;
}

export interface EcartsAnnuels {
  chiffreAffaires: EcartMesure;
  excedentBrutExploitation: EcartMesure;
  resultatNet: EcartMesure;
  tresorerieCloture: EcartMesure;
}

export interface ReprevisionAnnuelle {
  chiffreAffaires: number;
  excedentBrutExploitation: number;
  resultatNet: number | null;
  tresorerieCloture: number | null;
}

export interface ExplicationEcartEbe {
  chiffreAffairesPrevu: number;
  chiffreAffairesReel: number;
  ebePrevu: number;
  ebeReel: number;
  ecartEbe: number;
  effetVolume: number;
  effetMarge: number;
  tauxMargePrevuPointsDeBase: number;
  tauxMargeReelPointsDeBase: number | null;
}

export interface FaitReprevision {
  code: string;
  libelle: string;
  montant: number;
}

export interface ResultatReprevision {
  moteur: string;
  methode: MethodeReprevisionPlan;
  seuilEcartPourMille: number;
  repartition: number[];
  trimestresRealises: number;
  facteurPourMille: number;
  prevuAnnuel: {
    chiffreAffaires: number;
    excedentBrutExploitation: number;
    resultatNet: number;
    tresorerieCloture: number;
  };
  reprevision: ReprevisionAnnuelle;
  ecartsTrimestres: EcartsTrimestre[];
  ecartsCumules: EcartsCumules[];
  ecartsAnnuels: EcartsAnnuels;
  explicationEbe: ExplicationEcartEbe | null;
  faits: FaitReprevision[];
}

export interface EntreeFigee {
  trimestre: number;
  version: number;
  chiffreAffaires: number;
  excedentBrutExploitation: number;
  resultatNet: number | null;
  tresorerieFin: number | null;
}

export interface Reprevision {
  id: string;
  plan_id: string;
  modele_version_id: string;
  modele_version: number;
  exercice: number;
  version: number;
  dernier_trimestre: number;
  methode: MethodeReprevisionPlan;
  repartition: number[];
  seuil_pour_mille: number;
  moteur: string;
  cree_par: string;
  auteur_nom: string;
  cree_le: string;
  entrees: EntreeFigee[];
  resultat: ResultatReprevision;
}

export interface ResumeReprevision {
  id: string;
  modele_version: number;
  exercice: number;
  version: number;
  dernier_trimestre: number;
  methode: MethodeReprevisionPlan;
  seuil_pour_mille: number;
  auteur_nom: string;
  cree_le: string;
  reprevision: ReprevisionAnnuelle;
  ecarts_annuels: EcartsAnnuels;
}

export interface PageReprevisions {
  elements: ResumeReprevision[];
  curseur_suivant: string | null;
}

/** Version du modèle proposée au choix : seules les versions validées servent à re-prévoir. */
export interface VersionRetenue {
  version: number;
  validee: boolean;
}

// --- Libellés ---------------------------------------------------------------------------------

export const MENTION_PLAN_VIVANT =
  "Le plan validé n'est jamais modifié : la re-prévision compare l'exercice prévu aux réalisés " +
  "saisis et en tire une projection annuelle. Écarts, décomposition et projection sont calculés " +
  "par le moteur du cabinet ; l'IA peut seulement les commenter, sous la validation d'un consultant.";

export const MENTION_PROJECTION_SIMPLIFIEE =
  "Projection simplifiée : la trésorerie de clôture re-prévue reprend la trésorerie prévue, corrigée " +
  "de l'écart constaté en fin de dernier trimestre et de l'écart d'EBE du reste de l'exercice. Elle " +
  "ne remplace pas un recalcul du modèle financier.";

export const LIBELLE_METHODE = METHODE_REPREVISION_PLAN_LIBELLES;

/** Explication d'une phrase de chaque méthode, affichée sous le choix. */
export const EXPLICATION_METHODE: Record<MethodeReprevisionPlan, string> = {
  reste_du_plan:
    "Le réalisé est conservé et le reste de l'exercice reprend le prévu du plan, sans correction.",
  tendance:
    "Le reste de l'exercice est ajusté du rapport entre le chiffre d'affaires réalisé et le prévu (entre 50 % et 150 %).",
};

export const LIBELLE_TRIMESTRE = (t: number) => `Trimestre ${t}`;
export const MESSAGE_AUCUN_REALISE = "Aucun réalisé n'est encore saisi pour cet exercice.";
export const MESSAGE_AUCUNE_VERSION_VALIDEE =
  "Aucune version validée du modèle financier : faites valider une version dans l'onglet Modèle financier pour pouvoir re-prévoir.";

export const LIBELLE_SIGNIFICATIF = "Significatif";
export const LIBELLE_NON_SIGNIFICATIF = "Dans le seuil";
export const LIBELLE_NON_SAISI = "Non saisi";

/** Mesures d'un tableau d'écarts, dans l'ordre d'affichage. */
export const LIBELLE_MESURES = {
  chiffreAffaires: "Chiffre d'affaires",
  excedentBrutExploitation: "Excédent brut d'exploitation (EBE)",
  resultatNet: "Résultat net",
  tresorerieFin: "Trésorerie de fin de trimestre",
  tresorerieCloture: "Trésorerie de clôture (projection simplifiée)",
} as const;

// --- Mise en forme ----------------------------------------------------------------------------

/** Montant en unités mineures entières → texte avec devise ; null → « Non saisi ». */
export function montantOuNonSaisi(v: number | null | undefined, devise: Devise): string {
  return v === null || v === undefined ? LIBELLE_NON_SAISI : formaterMontantMineur(v, devise);
}

/** Écart signé : « +1 500 FCFA », « −2 000 FCFA » (le signe est écrit, jamais porté par la couleur seule). */
export function formaterEcart(v: number | null | undefined, devise: Devise): string {
  if (v === null || v === undefined) return VALEUR_ABSENTE;
  const texte = formaterMontantMineur(Math.abs(v), devise);
  return v > 0 ? `+${texte}` : v < 0 ? `−${texte}` : texte;
}

/** Points de base (1/10 000) fournis par le moteur → « +12,73 % » ; absent → « — ». */
export function formaterEcartRelatif(pointsDeBase: number | null | undefined): string {
  if (pointsDeBase === null || pointsDeBase === undefined) return VALEUR_ABSENTE;
  const texte = formaterPourcentage(Math.abs(pointsDeBase) / 10_000, 2);
  return pointsDeBase > 0 ? `+${texte}` : pointsDeBase < 0 ? `−${texte}` : texte;
}

/** Seuil du moteur (pour mille) → « 10 % ». */
export const formaterSeuil = (pourMille: number) => formaterPourcentage(pourMille / 1000, 1);

export function libelleMethode(m: string): string {
  return (LIBELLE_METHODE as Record<string, string>)[m] ?? m;
}

export function libelleVersionRetenue(v: VersionRetenue): string {
  return `Version ${v.version}${v.validee ? " (validée)" : " (non validée)"}`;
}

/** Versions validées seulement (le moteur et la base refusent les autres), de la plus récente à la plus ancienne. */
export function versionsValidees(versions: readonly VersionRetenue[]): VersionRetenue[] {
  return versions.filter((v) => v.validee);
}

/** Version de départ : la plus récente des validées (liste de la plus récente à la plus ancienne). */
export function versionParDefaut(versions: readonly VersionRetenue[]): number | null {
  return versionsValidees(versions)[0]?.version ?? null;
}

/** Exercices de l'horizon d'une version du modèle : du premier exercice sur `horizon` années. */
export function exercicesHorizon(premierExercice: number, horizon: number): number[] {
  return Array.from({ length: Math.max(0, horizon) }, (_, i) => premierExercice + i);
}

// --- Tableaux d'écarts ------------------------------------------------------------------------

export interface LigneEcart {
  cle: string;
  mesure: string;
  prevu: string;
  reel: string;
  ecart: string;
  ecartRelatif: string;
  significatif: boolean;
  /** Texte de la colonne « Seuil » : le marqueur ne repose jamais sur la couleur seule. */
  marqueur: string;
}

function ligneDe(
  cle: string,
  mesure: string,
  m: EcartMesure,
  devise: Devise,
  reelLibelle?: (v: number | null) => string,
): LigneEcart {
  return {
    cle,
    mesure,
    prevu: formaterMontantMineur(m.prevu, devise),
    reel: reelLibelle ? reelLibelle(m.reel) : montantOuNonSaisi(m.reel, devise),
    ecart: formaterEcart(m.ecart, devise),
    ecartRelatif: formaterEcartRelatif(m.ecartRelatifPointsDeBase),
    significatif: m.significatif,
    marqueur:
      m.reel === null
        ? LIBELLE_NON_SAISI
        : m.significatif
          ? LIBELLE_SIGNIFICATIF
          : LIBELLE_NON_SIGNIFICATIF,
  };
}

export function lignesTrimestre(e: EcartsTrimestre, devise: Devise): LigneEcart[] {
  const c = `t${e.trimestre}`;
  return [
    ligneDe(`${c}-ca`, LIBELLE_MESURES.chiffreAffaires, e.chiffreAffaires, devise),
    ligneDe(
      `${c}-ebe`,
      LIBELLE_MESURES.excedentBrutExploitation,
      e.excedentBrutExploitation,
      devise,
    ),
    ligneDe(`${c}-rn`, LIBELLE_MESURES.resultatNet, e.resultatNet, devise),
    ligneDe(`${c}-tr`, LIBELLE_MESURES.tresorerieFin, e.tresorerieFin, devise),
  ];
}

export function lignesCumul(e: EcartsCumules, devise: Devise): LigneEcart[] {
  const c = `cumul${e.trimestre}`;
  return [
    ligneDe(`${c}-ca`, LIBELLE_MESURES.chiffreAffaires, e.chiffreAffaires, devise),
    ligneDe(
      `${c}-ebe`,
      LIBELLE_MESURES.excedentBrutExploitation,
      e.excedentBrutExploitation,
      devise,
    ),
    ligneDe(`${c}-rn`, LIBELLE_MESURES.resultatNet, e.resultatNet, devise),
  ];
}

export function lignesAnnuelles(e: EcartsAnnuels, devise: Devise): LigneEcart[] {
  return [
    ligneDe("an-ca", LIBELLE_MESURES.chiffreAffaires, e.chiffreAffaires, devise),
    ligneDe("an-ebe", LIBELLE_MESURES.excedentBrutExploitation, e.excedentBrutExploitation, devise),
    ligneDe("an-rn", LIBELLE_MESURES.resultatNet, e.resultatNet, devise),
    ligneDe("an-tr", LIBELLE_MESURES.tresorerieCloture, e.tresorerieCloture, devise),
  ];
}

/** Titre du tableau cumulé : « Cumul à fin du trimestre 2 ». */
export const titreCumul = (trimestre: number) =>
  `Cumul depuis le début de l'exercice, à fin du trimestre ${trimestre}`;

/** Nombre de lignes significatives d'une série d'écarts (pour le résumé annoncé). */
export function compterSignificatifs(lignes: readonly Pick<LigneEcart, "significatif">[]): number {
  return lignes.filter((l) => l.significatif).length;
}

// --- Explication de l'écart d'EBE -------------------------------------------------------------

/**
 * Phrase rédigée à partir des FAITS du moteur (effet volume, effet de marge, taux de marge), sans
 * aucun calcul : elle ne fait que nommer le sens des montants signés fournis.
 */
export function phraseEcartEbe(
  e: ExplicationEcartEbe | null,
  trimestres: number,
  devise: Devise,
): string {
  if (!e) {
    return "La décomposition de l'écart d'EBE n'est pas disponible : le chiffre d'affaires prévu est nul.";
  }
  const m = (v: number) => formaterMontantMineur(Math.abs(v), devise);
  const sens = (v: number, plus: string, moins: string) => (v > 0 ? plus : v < 0 ? moins : "égal");
  const periode =
    trimestres <= 1 ? "le premier trimestre" : `les ${trimestres} premiers trimestres`;
  const phrases = [
    e.ecartEbe === 0
      ? `Sur ${periode}, l'EBE réalisé (${m(e.ebeReel)}) est égal à l'EBE prévu.`
      : `Sur ${periode}, l'EBE réalisé (${m(e.ebeReel)}) est ${sens(e.ecartEbe, "supérieur", "inférieur")} de ${m(e.ecartEbe)} à l'EBE prévu (${m(e.ebePrevu)}).`,
    e.effetVolume === 0
      ? "L'effet volume est nul."
      : `L'effet volume est ${sens(e.effetVolume, "favorable", "défavorable")} de ${m(e.effetVolume)} : le chiffre d'affaires réalisé (${m(e.chiffreAffairesReel)}) est ${e.chiffreAffairesReel >= e.chiffreAffairesPrevu ? "supérieur" : "inférieur"} au prévu (${m(e.chiffreAffairesPrevu)}).`,
    e.effetMarge === 0
      ? "L'effet de marge est nul."
      : `L'effet de marge est ${sens(e.effetMarge, "favorable", "défavorable")} de ${m(e.effetMarge)} : le taux de marge d'EBE est de ${formaterPourcentage(
          (e.tauxMargeReelPointsDeBase ?? 0) / 10_000,
          2,
        )} contre ${formaterPourcentage(e.tauxMargePrevuPointsDeBase / 10_000, 2)} prévu.`,
  ];
  return phrases.join(" ");
}

// --- Saisie d'un réalisé ----------------------------------------------------------------------

export interface SaisieRealise {
  chiffre_affaires: string;
  ebe: string;
  resultat_net: string;
  tresorerie_fin: string;
  commentaire: string;
}

export type ChampRealise = keyof SaisieRealise;

export interface CorpsRealise {
  chiffre_affaires: number;
  ebe: number;
  resultat_net: number | null;
  tresorerie_fin: number | null;
  commentaire: string | null;
}

const FACTEUR_MINEUR: Record<Devise, number> = { XOF: 1, XAF: 1, EUR: 100, USD: 100 };

/**
 * Montant saisi (unités usuelles, signe admis) → entier en unités mineures. `null` si vide ;
 * `Number.NaN` si illisible, trop précis pour la devise ou hors des entiers sûrs.
 */
export function lireMontantSigne(v: string, devise: Devise): number | null {
  const n = lireNombre(v);
  if (n === null) return null;
  if (Number.isNaN(n)) return Number.NaN;
  const facteur = FACTEUR_MINEUR[devise];
  const mineur = Math.round(n * facteur);
  if (Math.abs(n * facteur - mineur) > 1e-6 || !Number.isSafeInteger(mineur)) return Number.NaN;
  // -0 → 0 : un zéro négatif ne part pas à l'API.
  return mineur === 0 ? 0 : mineur;
}

/** Aide à la saisie d'un montant de la devise du plan. */
export const aideSaisieMontant = (devise: Devise) =>
  FACTEUR_MINEUR[devise] === 1
    ? "Montant entier, sans décimale (ex. 150 000)."
    : "Deux décimales au plus (ex. 1 500,50).";

/** Montant de l'API → texte modifiable à la française (« 150000 », « -1500,5 »). */
export function realiseVersSaisie(mineur: number | null | undefined, devise: Devise): string {
  if (mineur === null || mineur === undefined) return "";
  return String(mineur / FACTEUR_MINEUR[devise]).replace(".", ",");
}

export function saisieDepuisRealise(r: RealiseVersion | null, devise: Devise): SaisieRealise {
  return {
    chiffre_affaires: realiseVersSaisie(r?.chiffre_affaires, devise),
    ebe: realiseVersSaisie(r?.ebe, devise),
    resultat_net: realiseVersSaisie(r?.resultat_net, devise),
    tresorerie_fin: realiseVersSaisie(r?.tresorerie_fin, devise),
    commentaire: r?.commentaire ?? "",
  };
}

const MESSAGE_MONTANT = (devise: Devise) =>
  FACTEUR_MINEUR[devise] === 1
    ? "Montant entier, sans décimale (ex. 150 000)."
    : "Montant avec deux décimales au plus (ex. 1 500,50).";

/** Contrôle d'un réalisé (mêmes règles que l'API) ; `corps` est nul s'il reste une erreur. */
export function validerRealise(
  s: SaisieRealise,
  devise: Devise,
): { erreurs: Partial<Record<ChampRealise, string>>; corps: CorpsRealise | null } {
  const erreurs: Partial<Record<ChampRealise, string>> = {};
  const ca = lireMontantSigne(s.chiffre_affaires, devise);
  if (ca === null) erreurs.chiffre_affaires = "Le chiffre d'affaires réalisé est obligatoire.";
  else if (Number.isNaN(ca)) erreurs.chiffre_affaires = MESSAGE_MONTANT(devise);
  else if (ca < 0) erreurs.chiffre_affaires = "Le chiffre d'affaires ne peut pas être négatif.";
  const ebe = lireMontantSigne(s.ebe, devise);
  if (ebe === null) erreurs.ebe = "L'EBE réalisé est obligatoire (négatif si perte).";
  else if (Number.isNaN(ebe)) erreurs.ebe = MESSAGE_MONTANT(devise);
  const rn = lireMontantSigne(s.resultat_net, devise);
  if (rn !== null && Number.isNaN(rn)) erreurs.resultat_net = MESSAGE_MONTANT(devise);
  const tr = lireMontantSigne(s.tresorerie_fin, devise);
  if (tr !== null && Number.isNaN(tr)) erreurs.tresorerie_fin = MESSAGE_MONTANT(devise);
  const commentaire = s.commentaire.trim();
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(commentaire)) {
    erreurs.commentaire = "Le commentaire contient un caractère de contrôle.";
  } else if (commentaire.length > COMMENTAIRE_REALISE_MAX) {
    erreurs.commentaire = `Le commentaire compte au plus ${COMMENTAIRE_REALISE_MAX} caractères.`;
  }
  if (Object.keys(erreurs).length > 0 || ca === null || ebe === null) {
    return { erreurs, corps: null };
  }
  return {
    erreurs,
    corps: {
      chiffre_affaires: ca,
      ebe,
      resultat_net: rn,
      tresorerie_fin: tr,
      commentaire: commentaire === "" ? null : commentaire,
    },
  };
}

/** Trimestres proposés à la saisie : ceux déjà saisis, plus le suivant (dans l'ordre, sans trou). */
export function trimestresSaisissables(saisis: readonly number[]): number[] {
  const dernier = saisis.reduce((m, t) => Math.max(m, t), 0);
  return Array.from({ length: Math.min(4, dernier + 1) }, (_, i) => i + 1);
}

// --- Lancement d'une re-prévision -------------------------------------------------------------

export interface SaisieReprevision {
  version: string;
  methode: string;
  /** Seuil de « significatif » en pourcentage (ex. « 10 » ou « 7,5 »). */
  seuil: string;
}

export interface CorpsReprevision {
  version: number;
  exercice: number;
  methode: MethodeReprevisionPlan;
  seuil: number;
}

/** Seuil par défaut, en pourcentage. */
export const SEUIL_DEFAUT_POURCENT = String(SEUIL_REPREVISION_PLAN.defaut / 10);

export function validerReprevision(
  s: SaisieReprevision,
  exercice: number,
): { erreurs: Partial<Record<keyof SaisieReprevision, string>>; corps: CorpsReprevision | null } {
  const erreurs: Partial<Record<keyof SaisieReprevision, string>> = {};
  const version = lireNombre(s.version);
  if (version === null || !Number.isInteger(version) || version < 1) {
    erreurs.version = "Choisissez une version validée du modèle financier.";
  }
  if (!(METHODES_REPREVISION_PLAN as readonly string[]).includes(s.methode)) {
    erreurs.methode = "Choisissez une méthode de re-prévision.";
  }
  const pourcent = lireNombre(s.seuil);
  const pourMille = pourcent === null || Number.isNaN(pourcent) ? NaN : Math.round(pourcent * 10);
  if (
    pourcent === null ||
    Number.isNaN(pourcent) ||
    Math.abs(pourcent * 10 - pourMille) > 1e-6 ||
    pourMille < SEUIL_REPREVISION_PLAN.min ||
    pourMille > SEUIL_REPREVISION_PLAN.max
  ) {
    erreurs.seuil = "Seuil de 0,1 % à 100 %, avec une décimale au plus.";
  }
  if (
    !Number.isInteger(exercice) ||
    exercice < EXERCICE_PLAN_VIVANT.min ||
    exercice > EXERCICE_PLAN_VIVANT.max
  ) {
    erreurs.version = erreurs.version ?? "Choisissez un exercice.";
  }
  if (Object.keys(erreurs).length > 0 || version === null) return { erreurs, corps: null };
  return {
    erreurs,
    corps: {
      version,
      exercice,
      methode: s.methode as MethodeReprevisionPlan,
      seuil: pourMille,
    },
  };
}

// --- Chemins ----------------------------------------------------------------------------------

const seg = (id: string) => encodeURIComponent(id);

export const cheminRealises = (planId: string, exercice?: number | null) =>
  `${cheminPlan(planId)}/realises${exercice ? `?exercice=${exercice}` : ""}`;
export const cheminRealise = (planId: string, exercice: number, trimestre: number) =>
  `${cheminPlan(planId)}/realises/${exercice}/${trimestre}`;
export const cheminReprevisions = (planId: string) => `${cheminPlan(planId)}/reprevisions`;
export function cheminListeReprevisions(
  planId: string,
  limite: number,
  curseur: string | null,
  exercice?: number | null,
) {
  const q = new URLSearchParams({ limite: String(limite) });
  if (curseur) q.set("curseur", curseur);
  if (exercice) q.set("exercice", String(exercice));
  return `${cheminReprevisions(planId)}?${q.toString()}`;
}
export const cheminReprevision = (planId: string, revId: string) =>
  `${cheminReprevisions(planId)}/${seg(revId)}`;
export const cheminExplication = (planId: string, revId: string) =>
  `${cheminReprevision(planId, revId)}/explication`;

export function hrefPlanVivant(
  missionId: string,
  planId: string,
  q: {
    exercice?: number | null;
    reprevision?: string | null;
    curseur?: string | null;
  } = {},
): string {
  const p = new URLSearchParams();
  if (q.exercice) p.set("exercice", String(q.exercice));
  if (q.reprevision) p.set("reprevision", q.reprevision);
  if (q.curseur) p.set("curseur", q.curseur);
  const s = p.toString();
  return `${hrefPlan(missionId, planId)}/plan-vivant${s ? `?${s}` : ""}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Identifiant de re-prévision lu dans l'URL, ou `null` s'il est absent ou mal formé. */
export function lireIdReprevision(v: string | string[] | undefined): string | null {
  const x = Array.isArray(v) ? v[0] : v;
  return x && UUID.test(x) ? x : null;
}

/** Exercice lu dans l'URL, ou `null` s'il est absent, mal formé ou hors bornes. */
export function lireExercice(v: string | string[] | undefined): number | null {
  const x = Array.isArray(v) ? v[0] : v;
  if (!x || !/^\d{4}$/.test(x)) return null;
  const n = Number(x);
  return n >= EXERCICE_PLAN_VIVANT.min && n <= EXERCICE_PLAN_VIVANT.max ? n : null;
}

// --- Messages ---------------------------------------------------------------------------------

/** Message français d'un refus de l'API (jamais de montant dans le message). */
export function messagePlanVivant(e: unknown): string {
  if (e instanceof ErreurApi) {
    switch (e.code) {
      case "REALISE_TRIMESTRE_NON_CONSECUTIF":
        return "Les trimestres se saisissent dans l'ordre, sans trou : saisissez d'abord le trimestre précédent.";
      case "REALISES_PLAFOND":
        return "Le nombre maximal de versions de réalisés est atteint pour ce trimestre.";
      case "REALISE_VERSION_CONFLIT":
      case "REPREVISION_VERSION_CONFLIT":
        return "Une autre personne vient d'enregistrer : rechargez la page puis recommencez.";
      case "MODELE_NON_VALIDE":
        return "La re-prévision se calcule sur une version validée du modèle financier.";
      case "REPREVISION_EXERCICE_HORS_HORIZON":
        return "Cet exercice ne fait pas partie de l'horizon de la version du modèle choisie.";
      case "REPREVISION_INVALIDE":
        return e.message;
      case "REPREVISIONS_PLAFOND":
        return "Cet exercice a atteint le nombre maximal de re-prévisions enregistrées.";
      case "CONFLIT":
        return "La mission est clôturée : le plan reste consultable mais ne se modifie plus.";
      default:
        break;
    }
    if (e.statut === 403) return "Cette action est réservée aux rédacteurs du plan.";
    if (e.statut === 404) {
      return "Ce plan, cette version du modèle ou cette re-prévision est introuvable ou ne vous est plus accessible.";
    }
  }
  return messageErreur(e);
}
