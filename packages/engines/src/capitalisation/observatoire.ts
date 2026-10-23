/**
 * Observatoire inter-cabinets (CAP-04, PRD complémentaire §12 et §21 décision n° 1) : moteur pur.
 *
 * Les agrégats viennent d'une fonction SQL `SECURITY DEFINER` (`obs_agregats`, migration 0472)
 * qui ne renvoie QUE des cases déjà conformes aux seuils d'anonymat ; ce moteur les reprend et,
 * en défense en profondeur :
 * - RE-vérifie les seuils (au moins `OBSERVATOIRE_ENTREPRISES_MIN` entreprises issues d'au moins
 *   `OBSERVATOIRE_CABINETS_MIN` cabinets) : une case sous seuil est rendue « effectif
 *   insuffisant », sans valeur ni effectif ;
 * - rend la GRILLE COMPLÈTE (tous les secteurs × toutes les tailles) : une case vide et une case
 *   sous seuil sont indiscernables (l'existence d'une contribution ne se lit pas) ;
 * - calcule les marges (par secteur, par taille, ensemble) À PARTIR DES SEULES CASES PUBLIÉES :
 *   aucune différence « marge − cases publiées » ne reconstitue une case masquée (attaque par
 *   différence entre cases) ; c'est la variante « marges sur cases publiées » de l'exigence, qui
 *   dispense de la suppression complémentaire (aucune marge ne contient de case masquée) ;
 * - arrondit tout ce qu'il rend (atténuation de la différence TEMPORELLE, avec le gel des
 *   agrégats par mois civil côté SQL) : moyenne, médiane et quartiles au point entier, effectif
 *   arrondi à la tranche de 5 inférieure, répartition en pourcentages arrondis à 5 ; quartiles
 *   et répartition seulement à partir de `OBSERVATOIRE_EFFECTIF_DETAILLE` entreprises.
 *
 * Médiane et quartiles sont APPROCHÉS depuis l'histogramme par tranches de 10 points
 * (interpolation linéaire dans la tranche) : la fonction SQL ne rend jamais de valeur
 * individuelle. Aucun identifiant (cabinet, client, utilisateur) n'entre ni ne sort d'ici.
 */

export const OBSERVATOIRE_ENTREPRISES_MIN = 5;
export const OBSERVATOIRE_CABINETS_MIN = 3;
/** Effectif à partir duquel quartiles et répartition sont rendus. */
export const OBSERVATOIRE_EFFECTIF_DETAILLE = 10;
/** Nombre de tranches de l'histogramme (10 points chacune, la dernière inclut 100). */
export const OBSERVATOIRE_TRANCHES = 10;
/** Pas d'arrondi de l'effectif publié (tranche inférieure). */
export const OBSERVATOIRE_PAS_EFFECTIF = 5;
/** Pas d'arrondi des pourcentages de la répartition. */
export const OBSERVATOIRE_PAS_POURCENTAGE = 5;

export const OBSERVATOIRE_INDICATEURS = ["notation_score_global"] as const;
export type ObservatoireIndicateur = (typeof OBSERVATOIRE_INDICATEURS)[number];

/** Nomenclature FERMÉE des secteurs (peu de secteurs : plus de cases publiables). */
export const OBSERVATOIRE_SECTEURS = [
  "agriculture",
  "industrie",
  "btp",
  "commerce",
  "services",
  "numerique",
  "finance",
  "autres",
] as const;
export type ObservatoireSecteur = (typeof OBSERVATOIRE_SECTEURS)[number];

export const OBSERVATOIRE_TAILLES = ["tpe", "pme", "eti", "grande_entreprise"] as const;
export type ObservatoireTaille = (typeof OBSERVATOIRE_TAILLES)[number];

export type CodeErreurObservatoire =
  "CASE_INVALIDE" | "HISTOGRAMME_INVALIDE" | "SOMME_INVALIDE" | "VALEUR_INVALIDE";

export class ErreurObservatoire extends Error {
  readonly code: CodeErreurObservatoire;

  constructor(code: CodeErreurObservatoire, message: string) {
    super(message);
    this.name = "ErreurObservatoire";
    this.code = code;
  }
}

/* ----- Normalisation des contributions ----- */

/** Mots-clés (sans accents, minuscules) → secteur ; premier secteur trouvé, sinon « autres ». */
const MOTS_CLES_SECTEURS: readonly (readonly [ObservatoireSecteur, readonly string[]])[] = [
  ["numerique", ["numerique", "informatique", "logiciel", "telecom", "digital", "technologie"]],
  ["finance", ["banque", "bancaire", "assurance", "finance", "microfinance"]],
  ["btp", ["btp", "batiment", "construction", "travaux publics", "genie civil", "immobilier"]],
  [
    "agriculture",
    ["agri", "agro", "elevage", "peche", "cacao", "cafe", "coton", "anacarde", "hevea", "palmier"],
  ],
  [
    "industrie",
    ["industrie", "industriel", "manufactur", "mines", "minier", "energie", "petrole", "chimie"],
  ],
  ["commerce", ["commerce", "distribution", "negoce", "import", "export", "vente"]],
  [
    "services",
    ["service", "conseil", "transport", "logistique", "sante", "education", "tourisme", "hotel"],
  ],
];

function sansAccents(texte: string): string {
  return texte
    .replace(/œ/gi, "oe")
    .replace(/æ/gi, "ae")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** Secteur libre d'un client → code de la nomenclature fermée (jamais de texte libre partagé). */
export function observatoireNormaliserSecteur(
  secteur: string | null | undefined,
): ObservatoireSecteur {
  if (secteur === null || secteur === undefined) return "autres";
  const texte = sansAccents(secteur)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (texte === "") return "autres";
  for (const code of OBSERVATOIRE_SECTEURS) if (texte === code) return code;
  for (const [code, mots] of MOTS_CLES_SECTEURS) {
    if (mots.some((m) => texte.includes(m))) return code;
  }
  return "autres";
}

export function observatoireEstTaille(taille: unknown): taille is ObservatoireTaille {
  return typeof taille === "string" && (OBSERVATOIRE_TAILLES as readonly string[]).includes(taille);
}

/** Tranche (0 à 9) d'une valeur 0-100 : [0,10), [10,20)… [90,100]. */
export function observatoireTranche(valeur: number): number {
  if (!Number.isFinite(valeur) || valeur < 0 || valeur > 100) {
    throw new ErreurObservatoire(
      "VALEUR_INVALIDE",
      "Une valeur de l'observatoire est comprise entre 0 et 100.",
    );
  }
  return Math.min(Math.floor(valeur / 10), OBSERVATOIRE_TRANCHES - 1);
}

export interface ObservatoireEntreeContribution {
  secteur: string | null;
  taille: string | null;
  /** Score global (0-100) de la dernière notation publiée ; null si non notable. */
  valeur: number | null;
}

export interface ObservatoireContribution {
  secteur: ObservatoireSecteur;
  taille: ObservatoireTaille;
  /** Arrondie au dixième (colonne numeric(4,1)). */
  valeur: number;
}

export interface ObservatoirePreparation {
  contributions: ObservatoireContribution[];
  /** Écartées faute de taille renseignée (case inclassable). */
  sans_taille: number;
  /** Écartées faute de score notable. */
  sans_valeur: number;
}

/**
 * Contributions d'un cabinet depuis ses propres données : secteur normalisé, taille, valeur au
 * dixième. Aucun nom ni identifiant n'entre ici, aucun n'en sort.
 */
export function observatoirePreparerContributions(
  entrees: readonly ObservatoireEntreeContribution[],
): ObservatoirePreparation {
  const contributions: ObservatoireContribution[] = [];
  let sansTaille = 0;
  let sansValeur = 0;
  for (const e of entrees) {
    if (e.valeur === null || !Number.isFinite(e.valeur)) {
      sansValeur += 1;
      continue;
    }
    if (!observatoireEstTaille(e.taille)) {
      sansTaille += 1;
      continue;
    }
    observatoireTranche(e.valeur);
    contributions.push({
      secteur: observatoireNormaliserSecteur(e.secteur),
      taille: e.taille,
      valeur: Math.round(e.valeur * 10) / 10,
    });
  }
  return { contributions, sans_taille: sansTaille, sans_valeur: sansValeur };
}

/* ----- Agrégation ----- */

/** Case telle que la rend la fonction SQL (déjà au-dessus des seuils, en principe). */
export interface ObservatoireCaseBrute {
  secteur: string;
  taille: string;
  effectif_entreprises: number;
  effectif_cabinets: number;
  /** Effectifs HORS du cabinet appelant : ce sont eux qui franchissent les seuils (dominance). */
  effectif_entreprises_autres: number;
  effectif_cabinets_autres: number;
  /** Somme des valeurs (texte numeric de PostgreSQL ou nombre). */
  somme: number | string;
  histogramme: readonly number[];
}

export interface ObservatoireStatistiques {
  /** Effectif arrondi à la tranche de 5 inférieure (« au moins »). */
  effectif_minimum: number;
  moyenne: number;
  mediane: number;
  /** Null sous `OBSERVATOIRE_EFFECTIF_DETAILLE`. */
  q1: number | null;
  q3: number | null;
  /** Pourcentage par tranche de 10 points, arrondi à 5 ; null sous l'effectif détaillé. */
  repartition: number[] | null;
}

export type ObservatoireCase =
  | ({
      secteur: ObservatoireSecteur;
      taille: ObservatoireTaille;
      statut: "publiee";
    } & ObservatoireStatistiques)
  | { secteur: ObservatoireSecteur; taille: ObservatoireTaille; statut: "effectif_insuffisant" };

export interface ObservatoireMarge extends ObservatoireStatistiques {
  /** Nombre de cases publiées agrégées dans la marge. */
  cases_publiees: number;
}

export interface ObservatoireResultat {
  cases: ObservatoireCase[];
  marges: {
    par_secteur: ({ secteur: ObservatoireSecteur } & ObservatoireMarge)[];
    par_taille: ({ taille: ObservatoireTaille } & ObservatoireMarge)[];
    ensemble: ObservatoireMarge | null;
  };
}

interface CaseValide {
  secteur: ObservatoireSecteur;
  taille: ObservatoireTaille;
  n: number;
  cabinets: number;
  nAutres: number;
  cabinetsAutres: number;
  /** Somme en dixièmes de point (entier exact). */
  somme10: number;
  histogramme: number[];
}

const estEntierPositif = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0;

function valider(c: ObservatoireCaseBrute): CaseValide {
  if (
    !(OBSERVATOIRE_SECTEURS as readonly string[]).includes(c.secteur) ||
    !observatoireEstTaille(c.taille) ||
    !estEntierPositif(c.effectif_entreprises) ||
    !estEntierPositif(c.effectif_cabinets) ||
    c.effectif_entreprises === 0 ||
    c.effectif_cabinets > c.effectif_entreprises ||
    !estEntierPositif(c.effectif_entreprises_autres) ||
    !estEntierPositif(c.effectif_cabinets_autres) ||
    c.effectif_entreprises_autres > c.effectif_entreprises ||
    c.effectif_cabinets_autres > c.effectif_cabinets ||
    c.effectif_cabinets_autres > c.effectif_entreprises_autres
  ) {
    throw new ErreurObservatoire("CASE_INVALIDE", "Case de l'observatoire invalide.");
  }
  const h = c.histogramme;
  if (
    !Array.isArray(h) ||
    h.length !== OBSERVATOIRE_TRANCHES ||
    !h.every(estEntierPositif) ||
    h.reduce((a, b) => a + b, 0) !== c.effectif_entreprises
  ) {
    throw new ErreurObservatoire("HISTOGRAMME_INVALIDE", "Histogramme de l'observatoire invalide.");
  }
  const somme = typeof c.somme === "string" ? Number(c.somme) : c.somme;
  const somme10 = Math.round(somme * 10);
  if (
    !Number.isFinite(somme) ||
    Math.abs(somme * 10 - somme10) > 1e-6 ||
    somme10 < 0 ||
    somme10 > 1000 * c.effectif_entreprises
  ) {
    throw new ErreurObservatoire("SOMME_INVALIDE", "Somme de l'observatoire invalide.");
  }
  return {
    secteur: c.secteur as ObservatoireSecteur,
    taille: c.taille,
    n: c.effectif_entreprises,
    cabinets: c.effectif_cabinets,
    nAutres: c.effectif_entreprises_autres,
    cabinetsAutres: c.effectif_cabinets_autres,
    somme10,
    histogramme: [...h],
  };
}

/**
 * La case franchit-elle les deux seuils d'anonymat ? Les effectifs passés sont ceux HORS du
 * cabinet appelant (règle de dominance : au moins 5 entreprises issues d'au moins 3 AUTRES cabinets).
 */
export function observatoireCasePubliable(
  effectifEntreprises: number,
  effectifCabinets: number,
): boolean {
  return (
    effectifEntreprises >= OBSERVATOIRE_ENTREPRISES_MIN &&
    effectifCabinets >= OBSERVATOIRE_CABINETS_MIN
  );
}

/** Arrondi au plus proche (demi vers le haut) de num/den, entiers positifs, den > 0. */
function arrondiFraction(num: number, den: number): number {
  return Math.floor((2 * num + den) / (2 * den));
}

/** Quantile p (0 < p < 1) approché depuis l'histogramme, interpolation linéaire, arrondi. */
export function observatoireQuantileApproche(histogramme: readonly number[], p: number): number {
  const n = histogramme.reduce((a, b) => a + b, 0);
  if (n <= 0 || !(p > 0 && p < 1)) {
    throw new ErreurObservatoire(
      "HISTOGRAMME_INVALIDE",
      "Quantile impossible sur cet histogramme.",
    );
  }
  const cible = p * n;
  let cumul = 0;
  let valeur = 100;
  for (let i = 0; i < histogramme.length; i += 1) {
    const effectif = histogramme[i] as number;
    if (effectif > 0 && cumul + effectif >= cible) {
      valeur = i * 10 + ((cible - cumul) / effectif) * 10;
      break;
    }
    cumul += effectif;
  }
  return Math.min(100, Math.max(0, Math.round(valeur)));
}

function statistiques(
  n: number,
  somme10: number,
  histogramme: readonly number[],
): ObservatoireStatistiques {
  const detaille = n >= OBSERVATOIRE_EFFECTIF_DETAILLE;
  const pas = OBSERVATOIRE_PAS_POURCENTAGE;
  return {
    effectif_minimum: Math.floor(n / OBSERVATOIRE_PAS_EFFECTIF) * OBSERVATOIRE_PAS_EFFECTIF,
    moyenne: arrondiFraction(somme10, 10 * n),
    mediane: observatoireQuantileApproche(histogramme, 0.5),
    q1: detaille ? observatoireQuantileApproche(histogramme, 0.25) : null,
    q3: detaille ? observatoireQuantileApproche(histogramme, 0.75) : null,
    repartition: detaille
      ? histogramme.map((c) => arrondiFraction(c * (100 / pas), n) * pas)
      : null,
  };
}

function marge(cases: readonly CaseValide[]): ObservatoireMarge | null {
  if (cases.length === 0) return null;
  const n = cases.reduce((a, c) => a + c.n, 0);
  const somme10 = cases.reduce((a, c) => a + c.somme10, 0);
  const histogramme = Array.from({ length: OBSERVATOIRE_TRANCHES }, (_, i) =>
    cases.reduce((a, c) => a + (c.histogramme[i] as number), 0),
  );
  return { cases_publiees: cases.length, ...statistiques(n, somme10, histogramme) };
}

/**
 * Agrégats publiables de l'observatoire depuis les cases de la fonction SQL : seuils re-vérifiés,
 * grille complète, marges sur les seules cases publiées, arrondis.
 */
export function observatoireAgreger(
  brutes: readonly ObservatoireCaseBrute[],
): ObservatoireResultat {
  const parCle = new Map<string, CaseValide>();
  for (const brute of brutes) {
    const c = valider(brute);
    const cle = `${c.secteur}|${c.taille}`;
    if (parCle.has(cle)) {
      throw new ErreurObservatoire("CASE_INVALIDE", "Case de l'observatoire en double.");
    }
    parCle.set(cle, c);
  }
  const publiees: CaseValide[] = [];
  const cases: ObservatoireCase[] = [];
  for (const secteur of OBSERVATOIRE_SECTEURS) {
    for (const taille of OBSERVATOIRE_TAILLES) {
      const c = parCle.get(`${secteur}|${taille}`);
      if (c && observatoireCasePubliable(c.nAutres, c.cabinetsAutres)) {
        publiees.push(c);
        cases.push({
          secteur,
          taille,
          statut: "publiee",
          ...statistiques(c.n, c.somme10, c.histogramme),
        });
      } else {
        cases.push({ secteur, taille, statut: "effectif_insuffisant" });
      }
    }
  }
  const parSecteur: ObservatoireResultat["marges"]["par_secteur"] = [];
  for (const secteur of OBSERVATOIRE_SECTEURS) {
    const m = marge(publiees.filter((c) => c.secteur === secteur));
    if (m) parSecteur.push({ secteur, ...m });
  }
  const parTaille: ObservatoireResultat["marges"]["par_taille"] = [];
  for (const taille of OBSERVATOIRE_TAILLES) {
    const m = marge(publiees.filter((c) => c.taille === taille));
    if (m) parTaille.push({ taille, ...m });
  }
  return {
    cases,
    marges: { par_secteur: parSecteur, par_taille: parTaille, ensemble: marge(publiees) },
  };
}
