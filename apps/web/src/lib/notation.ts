/**
 * Notation d'une mission (service 1, NOT-01 à NOT-07) : types des réponses de l'API, libellés,
 * mise en forme et droits d'affichage. Logique pure, testée dans `notation.test.ts`.
 *
 * RÈGLE : aucun chiffre de notation n'est calculé ici. Scores, classes, couvertures, écarts,
 * ajustements cumulés, forces, faiblesses et comparaisons viennent TELS QUELS de l'API (et de
 * ses moteurs) ; ce module ne fait que les joindre par identifiant et les mettre en forme.
 *
 * Les droits ci-dessous sont un confort d'affichage (bouton visible ou explication) : l'API
 * reste seule juge (permissions, rôle `expert_metier`, séparation des tâches).
 *
 * Aucune réponse de questionnaire n'est conservée dans le navigateur : la page est rendue par
 * le serveur à chaque affichage, sans stockage local ni cache.
 */
import {
  aPermission,
  SECTEURS_GRILLE_GENERIQUE,
  STATUT_VERSION_NOTATION_LIBELLES,
  type Permission,
  type Role,
  type StatutVersionNotation,
  type StrategieNotation,
} from "@missionpilot/shared";
import { ErreurApi, messageErreur } from "./api";
import { VALEUR_ABSENTE } from "./format";
import type { Resultat } from "./saisie";

// --- Types des réponses de l'API ------------------------------------------------------------

export type Classe = "A" | "B" | "C" | "D" | "E";
export type Evolution = "hausse" | "baisse" | "stable" | "non_comparable";

export interface IndicateurResultat {
  indicateur: string;
  question: string;
  statut: "repondu" | "manquant" | "sans_objet";
  points: number | null;
}

/** Dimension du calcul figé (moteur `noterQuestionnaire` / `noterRepondants`). */
export interface DimensionResultat {
  dimension: string;
  libelle: string;
  famille: string;
  notable: boolean;
  score: number | null;
  scoreExact: string | null;
  classe: Classe | null;
  /** Couverture (0-1) du poids des indicateurs applicables. */
  couverture: number;
  indicateurs: IndicateurResultat[];
  /** Poids normalisé (somme 100). */
  poids: number;
  poidsExact: string;
}

export interface ResultatNotation {
  grille: string;
  version: number;
  secteur: string | null;
  strategie: StrategieNotation;
  notable: boolean;
  score: number | null;
  scoreExact: string | null;
  classe: Classe | null;
  /** Part (0-1) du poids des dimensions qui est notable. */
  couverture: number;
  dimensions: DimensionResultat[];
}

/** Dimension après ajustements motivés (moteur `appliquerAjustement`). */
export interface DimensionAjustee {
  dimension: string;
  libelle: string;
  famille: string;
  scoreCalcule: number | null;
  score: number | null;
  classe: Classe | null;
  deltaCumule: number;
}

export interface AjustementNotation {
  rang: number;
  dimension: string;
  delta: number;
  motif: string;
  date: string;
  score_avant: number;
  score_apres: number;
  plafonne: boolean;
  auteur: { id: string; nom: string };
  cree_le: string;
}

export type ActionRevue = "soumission" | "renvoi" | "publication";

export interface EvenementRevue {
  rang: number;
  action: ActionRevue;
  motif: string | null;
  par: { id: string; nom: string };
  le: string;
}

export interface RepondantEcart {
  id: string;
  nom?: string;
  fonction?: string | null;
}

/** Écart entre répondants (NOT-05), détecté par le moteur. */
export interface EcartRepondants {
  question: string;
  libelle: string;
  min: number;
  max: number;
  ecart: number;
  nombre_repondants: number;
  repondants_min: RepondantEcart[];
  repondants_max: RepondantEcart[];
}

/** Réponse de GET /api/notations/:id/version (et des actions qui rendent une version). */
export interface VueVersionNotation {
  id: string;
  notation_id: string;
  numero: number;
  statut: StatutVersionNotation;
  envoi_id: string;
  grille: {
    version_id: string | null;
    generique: boolean;
    code: string;
    version: number;
    titre: string;
  };
  secteur: string | null;
  strategie: StrategieNotation;
  reponses_utilisees: number;
  calcule_par: { id: string; nom: string | null };
  calcule_le: string;
  resultat: ResultatNotation;
  score: {
    notable: boolean;
    score_calcule: number | null;
    score: number | null;
    classe: Classe | null;
    dimensions: DimensionAjustee[];
  };
  ajustements: AjustementNotation[];
  revue: EvenementRevue[];
  ecarts: EcartRepondants[];
}

export interface VersionResume {
  numero: number;
  statut: StatutVersionNotation;
  score: number | null;
  classe: Classe | null;
  calcule_le: string;
  publiee_le: string | null;
}

/** Réponse de GET /api/missions/:id/notation. */
export interface ResumeNotation {
  id: string;
  mission_id: string;
  client_id: string;
  cree_par: string;
  cree_le: string;
  /** Du plus récent au plus ancien. */
  versions: VersionResume[];
}

export interface BarreDimension {
  dimension: string;
  libelle: string;
  score: number | null;
  classe: Classe | null;
}

export interface DimensionClassee {
  dimension: string;
  libelle: string;
  score: number;
}

/** Données du rapport (moteur `donneesRapport`). */
export interface DonneesRapport {
  global: { score: number | null; classe: Classe | null };
  radar: { dimension: string; axe: string; score: number | null }[];
  barres: { famille: string; dimensions: BarreDimension[] }[];
  forces: DimensionClassee[];
  faiblesses: DimensionClassee[];
}

export interface EcartScore {
  avant: number | null;
  apres: number | null;
  ecart: number | null;
  evolution: Evolution;
}

/** Comparaison avec la notation publiée précédente du client (moteur `comparerNotations`). */
export interface ComparaisonNotation {
  precedente: {
    notation_id: string;
    numero: number;
    mission_intitule: string;
    publiee_le: string;
    score: number | null;
    classe: Classe | null;
  };
  global: EcartScore;
  classeAvant: Classe | null;
  classeApres: Classe | null;
  ecartClasses: number | null;
  dimensions: (EcartScore & { dimension: string; libelle: string })[];
}

/** Réponse de GET /api/notations/:id/rapport. */
export interface RapportNotation {
  notation_id: string;
  mission_id: string;
  version: {
    numero: number;
    statut: StatutVersionNotation;
    calcule_le: string;
    publiee_le: string | null;
  };
  donnees: DonneesRapport;
  comparaison: ComparaisonNotation | null;
}

/** Envoi de questionnaire de la mission (GET /api/missions/:id/questionnaires), sans réponse. */
export interface EnvoiQuestionnaire {
  id: string;
  titre: string;
  mode: "individuel" | "collectif" | "par_fonction";
  statut: "brouillon" | "envoye" | "clos";
  repondants: number;
  reponses_soumises: number;
  envoye_le: string | null;
  clos_le: string | null;
}

// --- Permissions (miroir des routes de l'API) -----------------------------------------------

/** Lecture des grilles et des notations : `notation.gerer` OU `notation.publier`. */
export const PERMISSIONS_LECTURE_NOTATION: readonly Permission[] = [
  "notation.gerer",
  "notation.publier",
];

export const peutLireNotation = (roles: readonly Role[]) =>
  PERMISSIONS_LECTURE_NOTATION.some((p) => aPermission(roles, p));

/** Expert métier détenteur de `notation.publier` : seul habilité à renvoyer et publier (NOT-07). */
export const estExpertPublieur = (roles: readonly Role[]) =>
  roles.includes("expert_metier") && aPermission(roles, "notation.publier");

// --- Libellés --------------------------------------------------------------------------------

export type TonaliteNotation = "succes" | "attention" | "danger" | "neutre";

/**
 * Classes A à E (DECISIONS.md, NOT-03) : la lettre, son libellé et sa plage sont TOUJOURS
 * affichés, la couleur ne porte jamais seule le sens. Libellés à valider par les experts.
 */
export const CLASSES: Record<
  Classe,
  { libelle: string; plage: string; tonalite: TonaliteNotation }
> = {
  A: { libelle: "Très avancé", plage: "80 et plus", tonalite: "succes" },
  B: { libelle: "Avancé", plage: "de 65 à moins de 80", tonalite: "succes" },
  C: { libelle: "Intermédiaire", plage: "de 50 à moins de 65", tonalite: "neutre" },
  D: { libelle: "Fragile", plage: "de 35 à moins de 50", tonalite: "attention" },
  E: { libelle: "Critique", plage: "moins de 35", tonalite: "danger" },
};

export const LISTE_CLASSES: readonly Classe[] = ["A", "B", "C", "D", "E"];

export const estClasse = (v: unknown): v is Classe =>
  typeof v === "string" && (LISTE_CLASSES as readonly string[]).includes(v);

/** « Classe B — Avancé » ; « Non notable » sans classe. */
export function libelleClasse(classe: Classe | null | undefined): string {
  if (!estClasse(classe)) return "Non notable";
  return `Classe ${classe} — ${CLASSES[classe].libelle}`;
}

export const tonaliteClasse = (classe: Classe | null | undefined): TonaliteNotation =>
  estClasse(classe) ? CLASSES[classe].tonalite : "neutre";

export const TONALITE_STATUT: Record<StatutVersionNotation, TonaliteNotation> = {
  brouillon: "neutre",
  en_revue: "attention",
  publiee: "succes",
  remplacee: "neutre",
};

export function libelleStatutVersion(statut: string): string {
  return (STATUT_VERSION_NOTATION_LIBELLES as Record<string, string>)[statut] ?? "Statut inconnu";
}

export const tonaliteStatutVersion = (statut: string): TonaliteNotation =>
  (TONALITE_STATUT as Record<string, TonaliteNotation>)[statut] ?? "neutre";

export const STRATEGIES: Record<StrategieNotation, { libelle: string; aide: string }> = {
  ignorer: {
    libelle: "Ignorer les réponses manquantes (recommandé)",
    aide: "Le score se calcule sur les réponses données, renormalisées. Une dimension n'est notable que si la moitié de son poids est répondue.",
  },
  penaliser: {
    libelle: "Pénaliser les réponses manquantes",
    aide: "Une question applicable sans réponse compte pour 0 point.",
  },
};

export const libelleStrategie = (s: string) =>
  (STRATEGIES as Record<string, { libelle: string }>)[s]?.libelle ?? "Stratégie inconnue";

const FAMILLES: Record<string, string> = {
  excellence: "Excellence opérationnelle",
  competitivite: "Compétitivité",
};

/** Libellé d'une famille de dimensions ; le code brut si la grille du cabinet en a ajouté une. */
export const libelleFamille = (code: string) =>
  FAMILLES[code] ?? (code.trim() === "" ? "Sans famille" : code);

export const EVOLUTIONS: Record<Evolution, string> = {
  hausse: "En hausse",
  baisse: "En baisse",
  stable: "Stable",
  non_comparable: "Non comparable",
};

export const libelleEvolution = (e: string) =>
  (EVOLUTIONS as Record<string, string>)[e] ?? EVOLUTIONS.non_comparable;

export const ACTIONS_REVUE: Record<ActionRevue, string> = {
  soumission: "Soumise en revue",
  renvoi: "Renvoyée en brouillon",
  publication: "Publiée",
};

export const libelleActionRevue = (a: string) =>
  (ACTIONS_REVUE as Record<string, string>)[a] ?? "Étape de revue";

const MODES: Record<EnvoiQuestionnaire["mode"], string> = {
  individuel: "individuel",
  collectif: "collectif",
  par_fonction: "par fonction",
};

/** Libellé d'un secteur : celui de la liste fournie, sinon celui de la grille générique. */
export function libelleSecteur(
  code: string | null,
  secteurs: readonly { secteur: string; libelle?: string }[] = [],
): string {
  if (code === null) return "Pondérations par défaut";
  const s = secteurs.find((x) => x.secteur === code);
  if (s?.libelle) return s.libelle;
  return SECTEURS_GRILLE_GENERIQUE.find((x) => x.code === code)?.libelle ?? code;
}

// --- Mise en forme (aucun calcul) ------------------------------------------------------------

const FORMAT_SCORE = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const nombre = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Score de l'API (déjà arrondi à 1 décimale par le moteur) : 72.4 → « 72,4 ». */
export function formaterScore(v: number | null | undefined): string {
  return nombre(v) ? FORMAT_SCORE.format(v) : VALEUR_ABSENTE;
}

/** Écart signé fourni par l'API : 4.5 → « +4,5 », −4.5 → « −4,5 », 0 → « 0,0 ». */
export function formaterEcart(v: number | null | undefined): string {
  if (!nombre(v)) return VALEUR_ABSENTE;
  if (v === 0) return FORMAT_SCORE.format(0);
  const texte = FORMAT_SCORE.format(Math.abs(v));
  return v > 0 ? `+${texte}` : `−${texte}`;
}

/** Couverture (0-1) de l'API : 0.625 → « 62,5 % ». */
export function formaterCouverture(v: number | null | undefined): string {
  if (!nombre(v)) return VALEUR_ABSENTE;
  return new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 1 }).format(v);
}

/** Écart de classes fourni par l'API : 1 → « +1 classe », −2 → « −2 classes ». */
export function formaterEcartClasses(v: number | null | undefined): string {
  if (!nombre(v)) return VALEUR_ABSENTE;
  if (v === 0) return "Même classe";
  const n = Math.abs(v);
  return `${v > 0 ? "+" : "−"}${n} classe${n > 1 ? "s" : ""}`;
}

/** « 1 réponse soumise », « 3 réponses soumises ». */
export function pluriel(n: number, singulier: string, plurielTexte = `${singulier}s`): string {
  return `${n} ${n > 1 ? plurielTexte : singulier}`;
}

// --- Assemblage des données de l'API (jointure par identifiant, sans calcul) ----------------

export interface LigneDimension {
  dimension: string;
  libelle: string;
  famille: string;
  notable: boolean;
  poids: number | null;
  couverture: number | null;
  scoreCalcule: number | null;
  deltaCumule: number;
  score: number | null;
  classe: Classe | null;
}

/** Une ligne par dimension, dans l'ordre de la grille : calcul figé + score ajusté. */
export function lignesDimensions(
  vue: Pick<VueVersionNotation, "resultat" | "score">,
): LigneDimension[] {
  return vue.score.dimensions.map((d) => {
    const r = vue.resultat.dimensions.find((x) => x.dimension === d.dimension);
    return {
      dimension: d.dimension,
      libelle: d.libelle,
      famille: d.famille,
      notable: r?.notable ?? d.scoreCalcule !== null,
      poids: r?.poids ?? null,
      couverture: r?.couverture ?? null,
      scoreCalcule: d.scoreCalcule,
      deltaCumule: d.deltaCumule,
      score: d.score,
      classe: d.classe,
    };
  });
}

/** Dimensions non notables (réponses insuffisantes), dans l'ordre de la grille. */
export const dimensionsNonNotables = (vue: Pick<VueVersionNotation, "resultat" | "score">) =>
  lignesDimensions(vue).filter((l) => !l.notable);

/** Libellé d'une dimension connue de la version, sinon son code. */
export function libelleDimension(
  vue: Pick<VueVersionNotation, "score">,
  dimension: string,
): string {
  return vue.score.dimensions.find((d) => d.dimension === dimension)?.libelle ?? dimension;
}

/** « Nom (fonction) », ou un libellé neutre si le nom n'est plus connu. */
export function nomRepondant(r: RepondantEcart): string {
  const nom = r.nom?.trim() || "Répondant";
  return r.fonction ? `${nom} (${r.fonction})` : nom;
}

// --- Droits d'affichage ----------------------------------------------------------------------

export interface ContexteNotation {
  roles: readonly Role[];
  utilisateurId: string;
  missionCloturee: boolean;
}

/** Raisons pour lesquelles CET utilisateur est auteur de la version (séparation des tâches). */
export function contributionsUtilisateur(
  vue: Pick<VueVersionNotation, "calcule_par" | "ajustements" | "revue">,
  utilisateurId: string,
): string[] {
  const raisons: string[] = [];
  if (vue.calcule_par.id === utilisateurId) raisons.push("vous avez lancé ce calcul");
  if (vue.ajustements.some((a) => a.auteur.id === utilisateurId)) {
    raisons.push("vous avez ajusté une dimension");
  }
  if (vue.revue.some((e) => e.action === "soumission" && e.par.id === utilisateurId)) {
    raisons.push("vous avez soumis cette version en revue");
  }
  return raisons;
}

function enumerer(elements: readonly string[]): string {
  if (elements.length <= 1) return elements.join("");
  return `${elements.slice(0, -1).join(", ")} et ${elements[elements.length - 1]}`;
}

export const MESSAGE_PUBLICATION_EXPERT =
  "La publication revient à un expert métier du cabinet, après relecture (revue obligatoire, NOT-07). Votre rôle ne le permet pas : un expert métier de la mission doit relire et publier cette version.";

export interface DroitsVersion {
  ajuster: boolean;
  soumettre: boolean;
  /** Raison affichée quand la soumission est impossible pour une version en brouillon. */
  blocageSoumission: string | null;
  renvoyer: boolean;
  publier: boolean;
  /** Explication affichée quand le bouton « Publier » n'est pas proposé (version en revue). */
  explicationPublication: string | null;
}

/**
 * Actions proposées sur la version AFFICHÉE. L'API n'agit que sur la DERNIÈRE version : une
 * version plus ancienne est en lecture seule.
 */
export function droitsVersion(
  ctx: ContexteNotation,
  vue: Pick<VueVersionNotation, "statut" | "score" | "calcule_par" | "ajustements" | "revue">,
  derniere: boolean,
): DroitsVersion {
  const gerer = aPermission(ctx.roles, "notation.gerer");
  const expert = estExpertPublieur(ctx.roles);
  const brouillon = derniere && vue.statut === "brouillon";
  const enRevue = derniere && vue.statut === "en_revue";
  const notableUne = vue.score.dimensions.some((d) => d.scoreCalcule !== null);
  const raisons = contributionsUtilisateur(vue, ctx.utilisateurId);
  let explicationPublication: string | null = null;
  if (enRevue && !expert) explicationPublication = MESSAGE_PUBLICATION_EXPERT;
  else if (enRevue && raisons.length > 0) {
    explicationPublication = `Vous ne pouvez pas publier cette version : ${enumerer(raisons)}. Un autre expert métier doit la relire et la publier (séparation des tâches).`;
  }
  return {
    ajuster: gerer && brouillon && !ctx.missionCloturee && notableUne,
    soumettre: gerer && brouillon && vue.score.notable,
    blocageSoumission:
      gerer && brouillon && !vue.score.notable
        ? "Le score global n'est pas notable : complétez les réponses (ou relancez un calcul) avant de soumettre la version en revue."
        : null,
    renvoyer: expert && enRevue,
    publier: expert && enRevue && raisons.length === 0,
    explicationPublication,
  };
}

/** Pourquoi le formulaire d'ajustement n'est pas proposé sur la version affichée. */
export function messageSansAjustement(
  ctx: ContexteNotation,
  statut: StatutVersionNotation,
  derniere: boolean,
): string {
  if (!derniere) return "Version antérieure : elle ne s'ajuste plus.";
  if (statut !== "brouillon") {
    return "Seule une version en brouillon s'ajuste : elle doit être renvoyée en brouillon, ou un nouveau calcul lancé.";
  }
  if (!aPermission(ctx.roles, "notation.gerer")) {
    return "L'ajustement revient au consultant ou au chef de mission.";
  }
  if (ctx.missionCloturee) return "La mission est clôturée : plus aucun ajustement n'est possible.";
  return "Aucune dimension notable à ajuster : complétez les réponses puis relancez un calcul.";
}

/**
 * Raison pour laquelle un nouveau calcul n'est pas possible, ou null. `statutDerniere` est le
 * statut de la dernière version (null : aucun calcul encore).
 */
export function blocageCalcul(
  ctx: ContexteNotation,
  statutDerniere: StatutVersionNotation | null,
): string | null {
  if (!aPermission(ctx.roles, "notation.gerer")) {
    return "Le calcul d'une notation revient au consultant ou au chef de mission.";
  }
  if (ctx.missionCloturee) {
    return "La mission est clôturée : aucun nouveau calcul ni ajustement n'est possible. Les versions existantes restent consultables.";
  }
  if (statutDerniere === "en_revue") {
    return "La dernière version est en revue : un expert métier doit la publier ou la renvoyer en brouillon avant un nouveau calcul.";
  }
  return null;
}

// --- Saisies (validation locale ; l'API et le moteur restent juges) --------------------------

export interface SaisieCalcul {
  envoiId: string;
  grilleVersionId: string;
  secteur: string;
  strategie: string;
}

export interface ChargeCalcul {
  envoi_id: string;
  grille_version_id: string | null;
  secteur: string | null;
  strategie: StrategieNotation;
}

export function validerCalcul(
  s: SaisieCalcul,
  envois: readonly Pick<EnvoiQuestionnaire, "id" | "reponses_soumises">[],
): Resultat<ChargeCalcul, "envoiId" | "strategie"> {
  const erreurs: Partial<Record<"envoiId" | "strategie", string>> = {};
  const envoi = envois.find((e) => e.id === s.envoiId);
  if (!envoi) erreurs.envoiId = "Choisissez le questionnaire dont les réponses seront notées.";
  else if (envoi.reponses_soumises < 1) {
    erreurs.envoiId = "Ce questionnaire n'a encore aucune réponse soumise.";
  }
  if (s.strategie !== "ignorer" && s.strategie !== "penaliser") {
    erreurs.strategie = "Choisissez le traitement des réponses manquantes.";
  }
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      envoi_id: s.envoiId,
      grille_version_id: s.grilleVersionId === "" ? null : s.grilleVersionId,
      secteur: s.secteur === "" ? null : s.secteur,
      strategie: s.strategie as StrategieNotation,
    },
  };
}

export const MOTIF_MAX = 2000;

/**
 * Écart d'ajustement saisi à la française (« -4,5 », « +3 », « −2 ») : nombre, ou null si
 * illisible. Une décimale au plus, non nul, entre −100 et 100 (règles du moteur).
 */
export function lireEcart(v: string): number | null {
  const brut = v.replace(/\s/g, "").replace("−", "-").replace(/^\+/, "").replace(",", ".");
  if (!/^-?\d{1,3}(\.\d)?$/.test(brut)) return null;
  const n = Number(brut);
  return Number.isFinite(n) ? n : null;
}

export interface SaisieAjustement {
  dimension: string;
  delta: string;
  motif: string;
}

export function validerAjustement(
  s: SaisieAjustement,
  dimensionsNotables: readonly string[],
): Resultat<{ dimension: string; delta: number; motif: string }, "dimension" | "delta" | "motif"> {
  const erreurs: Partial<Record<"dimension" | "delta" | "motif", string>> = {};
  if (!dimensionsNotables.includes(s.dimension)) {
    erreurs.dimension = "Choisissez une dimension notable à ajuster.";
  }
  const delta = lireEcart(s.delta);
  if (s.delta.trim() === "") erreurs.delta = "Indiquez l'écart en points (ex. -4,5 ou 3).";
  else if (delta === null) {
    erreurs.delta = "Écart illisible : un nombre avec une décimale au plus (ex. -4,5 ou 3).";
  } else if (delta === 0 || Math.abs(delta) > 100) {
    erreurs.delta = "L'écart doit être non nul et compris entre −100 et 100 points.";
  }
  const motif = s.motif.trim();
  if (motif === "") {
    erreurs.motif =
      "Le motif est obligatoire : citez la note terrain ou l'entretien qui le justifie.";
  } else if (motif.length > MOTIF_MAX) {
    erreurs.motif = `Le motif ne doit pas dépasser ${MOTIF_MAX} caractères.`;
  }
  if (Object.keys(erreurs).length > 0 || delta === null) return { ok: false, erreurs };
  return { ok: true, charge: { dimension: s.dimension, delta, motif } };
}

export function validerMotifRenvoi(motif: string): Resultat<{ motif: string }, "motif"> {
  const m = motif.trim();
  if (m === "") {
    return {
      ok: false,
      erreurs: { motif: "Le motif du renvoi est obligatoire : indiquez ce qui doit être revu." },
    };
  }
  if (m.length > MOTIF_MAX) {
    return {
      ok: false,
      erreurs: { motif: `Le motif ne doit pas dépasser ${MOTIF_MAX} caractères.` },
    };
  }
  return { ok: true, charge: { motif: m } };
}

// --- Erreurs ----------------------------------------------------------------------------------

/** Codes de l'API dont le message (français, explicite) est affiché tel quel. */
const CODES_MESSAGE_API = new Set([
  "SEPARATION_DES_TACHES",
  "EXPERT_METIER_REQUIS",
  "AJUSTEMENT_INVALIDE",
  "DIMENSION_INCONNUE",
  "DIMENSION_NON_NOTABLE",
  "NOTATION_IMMUABLE",
  "NOTATION_ETAT",
  "TRANSITION_REFUSEE",
  "GRILLE_FIGEE",
]);

export const MESSAGE_INTROUVABLE_NOTATION =
  "Cette notation (ou la mission, le questionnaire ou la grille choisis) n'est plus accessible. Actualisez la page.";

/** Message français d'une erreur d'action de notation (400, 403, 404, 409…). */
export function messageNotation(e: unknown): string {
  if (e instanceof ErreurApi) {
    if (CODES_MESSAGE_API.has(e.code)) return e.message;
    if (e.statut === 404) return MESSAGE_INTROUVABLE_NOTATION;
    // Conflits de l'API : messages métier explicites (version en revue, aucune réponse…).
    if (e.statut === 409) return e.message;
  }
  return messageErreur(e);
}

/** Après ce refus, l'état affiché est probablement périmé : rafraîchir la page. */
export const etatNotationChange = (e: unknown) =>
  e instanceof ErreurApi && (e.statut === 404 || e.statut === 409);

// --- Chemins ----------------------------------------------------------------------------------

const segment = (id: string) => encodeURIComponent(id);

/** Numéro de version lu dans l'URL (`?version=3`) ; null si absent ou invalide. */
export function lireNumeroVersion(v: string | string[] | undefined): number | null {
  const brut = Array.isArray(v) ? v[0] : v;
  if (typeof brut !== "string" || !/^[1-9]\d{0,5}$/.test(brut)) return null;
  const n = Number(brut);
  return n <= 100000 ? n : null;
}

/**
 * Version à afficher : celle demandée si elle existe, sinon la plus récente. `introuvable`
 * signale une version demandée qui n'existe pas (lien périmé).
 */
export function versionAffichee(
  versions: readonly Pick<VersionResume, "numero">[],
  demandee: number | null,
): { numero: number | null; introuvable: boolean; derniere: boolean } {
  const plusRecente = versions[0]?.numero ?? null;
  if (demandee !== null && versions.some((v) => v.numero === demandee)) {
    return { numero: demandee, introuvable: false, derniere: demandee === plusRecente };
  }
  return { numero: plusRecente, introuvable: demandee !== null, derniere: true };
}

export const hrefNotation = (missionId: string, numero?: number | null) =>
  `/missions/${segment(missionId)}/notation${numero ? `?version=${numero}` : ""}`;

export const cheminNotationMission = (missionId: string) =>
  `/api/missions/${segment(missionId)}/notation`;

export const cheminVersionNotation = (notationId: string, numero: number) =>
  `/api/notations/${segment(notationId)}/version?version=${numero}`;

export const cheminRapportNotation = (notationId: string, numero: number) =>
  `/api/notations/${segment(notationId)}/rapport?version=${numero}`;

export type ActionNotation = "calculs" | "ajustements" | "soumettre" | "renvoyer" | "publier";

export const cheminActionNotation = (notationId: string, action: ActionNotation) =>
  `/api/notations/${segment(notationId)}/${action}`;

/** Envois de questionnaires de la mission (100 plus récents : plafond de l'API). */
export const cheminEnvoisMission = (missionId: string) =>
  `/api/missions/${segment(missionId)}/questionnaires?limite=100`;

// --- Choix proposés au calcul ----------------------------------------------------------------

export interface OptionNotation {
  valeur: string;
  libelle: string;
  desactivee?: boolean;
}

/** Questionnaires de la mission ; ceux sans réponse soumise sont proposés désactivés. */
export function optionsEnvois(envois: readonly EnvoiQuestionnaire[]): OptionNotation[] {
  return envois.map((e) => {
    const reponses =
      e.reponses_soumises > 0
        ? pluriel(e.reponses_soumises, "réponse soumise", "réponses soumises")
        : "aucune réponse soumise";
    return {
      valeur: e.id,
      libelle: `${e.titre} — ${MODES[e.mode] ?? e.mode}, ${reponses}`,
      desactivee: e.reponses_soumises < 1,
    };
  });
}

export const envoisNotables = (envois: readonly EnvoiQuestionnaire[]) =>
  envois.filter((e) => e.reponses_soumises > 0);

export const NOM_GRILLE_GENERIQUE = "Grille générique MissionPilot";
export const LIBELLE_GRILLE_GENERIQUE = `${NOM_GRILLE_GENERIQUE} (par défaut)`;

/** Grilles utilisables au calcul : la générique, puis celles du cabinet qui ont une version validée. */
export function optionsGrillesCalcul(
  grilles: readonly { titre: string; code: string; version_validee_id: string | null }[],
): OptionNotation[] {
  return [
    { valeur: "", libelle: LIBELLE_GRILLE_GENERIQUE },
    ...grilles
      .filter((g) => g.version_validee_id !== null)
      .map((g) => ({ valeur: g.version_validee_id as string, libelle: `${g.titre} (${g.code})` })),
  ];
}

export function optionsSecteurs(
  secteurs: readonly { secteur: string; libelle?: string }[],
): OptionNotation[] {
  return [
    { valeur: "", libelle: "Pondérations par défaut de la grille" },
    ...secteurs.map((s) => ({ valeur: s.secteur, libelle: s.libelle ?? s.secteur })),
  ];
}

/** Secteurs de la grille générique (forme des surcharges de grille). */
export const SECTEURS_GENERIQUES: readonly { secteur: string; libelle: string }[] =
  SECTEURS_GRILLE_GENERIQUE.map((s) => ({ secteur: s.code, libelle: s.libelle }));

/** Annonce lue après un calcul réussi (chiffres de la réponse de l'API). */
export function annonceCalcul(vue: Pick<VueVersionNotation, "numero" | "score">): string {
  const score = vue.score.notable
    ? `score global ${formaterScore(vue.score.score)} sur 100, ${libelleClasse(vue.score.classe)}`
    : "score global non notable (réponses insuffisantes)";
  return `Calcul terminé : version ${vue.numero} en brouillon, ${score}.`;
}
