import { normaliserTerme, pourCentPlancher } from "./commun";

/**
 * Exigences d'un dossier d'appel d'offres et matrice de conformité (AO-03).
 *
 * `decouperExigences` est le REPLI DÉTERMINISTE de l'extraction : sans IA (désactivée, sans
 * clé, plafond atteint, sortie inexploitable), le dossier est découpé en lignes puis en
 * phrases, et seules les phrases portant une marque d'exigence (« doit », « obligatoire »,
 * « fournir », « au moins »…) sont retenues, classées par mots-clés et dédoublonnées. Le
 * résultat est un BROUILLON à valider par un humain, comme une proposition de l'IA.
 *
 * `syntheseConformite` compte la matrice par statut et dit si l'offre est prête au dépôt : toutes
 * les exigences obligatoires sont conformes ou sans objet (matrice non vide).
 */

export const CATEGORIES_EXIGENCE = [
  "administrative",
  "technique",
  "financiere",
  "references",
  "personnel",
  "autre",
] as const;
export type CategorieExigence = (typeof CATEGORIES_EXIGENCE)[number];

export const STATUTS_CONFORMITE = [
  "a_traiter",
  "en_cours",
  "conforme",
  "partiel",
  "non_conforme",
  "sans_objet",
] as const;
export type StatutConformite = (typeof STATUTS_CONFORMITE)[number];

/** Statuts qui satisfont une exigence obligatoire au dépôt. */
export const STATUTS_SATISFAISANTS: readonly StatutConformite[] = ["conforme", "sans_objet"];

export const EXIGENCES_EXTRACTION_MAX = 200;
export const EXIGENCE_LIBELLE_MAX = 1_000;
export const EXIGENCE_LIBELLE_MIN = 15;
export const EXIGENCE_REFERENCE_MAX = 60;

export interface ExigenceProposee {
  libelle: string;
  categorie: CategorieExigence;
  obligatoire: boolean;
  reference: string | null;
}

const MARQUE_EXIGENCE =
  /\b(doit|doivent|devra|devront|exige|exigee?s?|exiges|obligatoire|obligatoires|obligatoirement|requis|requise?s?|imperativement|fournir|fournira|joindre|produire|au moins|au minimum|minimum de|il est demande|sous peine|a peine de)\b/;
const MARQUE_OBLIGATION =
  /\b(doit|doivent|devra|devront|exige|exigee?s?|exiges|obligatoire|obligatoires|obligatoirement|requis|requise?s?|imperativement|sous peine|a peine de)\b/;
const MARQUE_FACULTATIF = /\b(souhaitable|de preference|facultati(f|ve|fs|ves)|eventuellement)\b/;

/** Ordre de test : la première catégorie dont un mot-clé apparaît l'emporte. */
const MOTS_CATEGORIE: readonly [CategorieExigence, RegExp][] = [
  [
    "personnel",
    /\b(expert|experts|chef de mission|cv|curriculum|diplome|diplomes|annees d experience|ans d experience|personnel|equipe|consultant principal)\b/,
  ],
  [
    "references",
    /\b(reference|references|attestations? de bonne execution|missions? similaires?|marches? similaires?|experience du (cabinet|candidat|soumissionnaire))\b/,
  ],
  [
    "financiere",
    /\b(prix|offre financiere|montant|devis|cout|couts|budget|honoraires|tva|bordereau|chiffre d affaires|per diem)\b/,
  ],
  [
    "administrative",
    /\b(registre|rccm|attestation fiscale|attestations? de regularite|cnps|securite sociale|caution|garantie|declaration|signature|signee?s?|formulaire|original|originaux|copie|copies|validite|pouvoir|procuration|statuts|lettre de soumission)\b/,
  ],
  [
    "technique",
    /\b(methodologie|methode|approche|plan de travail|chronogramme|calendrier|livrable|livrables|termes de reference|offre technique|rapport|rapports|demarche)\b/,
  ],
];

/** Numérotation de tête : « 3.2 », « 3.2.1 », « IC 14.1 », « Article 12 », « a) ». */
const NUMEROTATION =
  /^\s*((?:article|art\.?|section|clause|ic|cg|cps|ddp)\s*\d+(?:[.-]\d+)*|\d+(?:\.\d+)+\.?|\d+[.)]|[a-z][.)])\s*[:.)-]?\s+/i;
const PUCE = /^\s*[-*•·◦▪–—]+\s*/u;

const nettoyer = (s: string) => s.replace(/\s+/g, " ").trim();

function categorieDe(normalise: string): CategorieExigence {
  for (const [categorie, motif] of MOTS_CATEGORIE) if (motif.test(normalise)) return categorie;
  return "autre";
}

/** Phrases d'une ligne : coupure après « . », « ; » ou « ! » suivis d'un espace et d'une capitale. */
function phrases(ligne: string): string[] {
  return ligne
    .split(/(?<=[.;!?])\s+(?=[A-ZÀ-ÖØ-Þ0-9«"(])/u)
    .map(nettoyer)
    .filter((p) => p !== "");
}

/** Découpe déterministe d'un dossier en exigences proposées. */
export function decouperExigences(
  texte: string,
  max: number = EXIGENCES_EXTRACTION_MAX,
): { exigences: ExigenceProposee[]; tronque: boolean } {
  const exigences: ExigenceProposee[] = [];
  const vues = new Set<string>();
  let section: string | null = null;
  let tronque = false;
  const lignes = texte.replace(/\r\n?/g, "\n").split("\n");
  for (const brute of lignes) {
    let ligne = brute.replace(PUCE, "");
    const numero = NUMEROTATION.exec(ligne);
    let reference: string | null = section;
    if (numero) {
      reference = nettoyer(numero[1] as string)
        .replace(/[.)]$/, "")
        .slice(0, EXIGENCE_REFERENCE_MAX);
      ligne = ligne.slice(numero[0].length);
    }
    const candidates = phrases(ligne);
    const exigeantes = candidates.filter((p) => MARQUE_EXIGENCE.test(normaliserTerme(p)));
    // Numérotation de section (« 3.2 », « IC 14.1 », « Article 5 ») ou ligne numérotée courte
    // sans exigence (un titre) : référence des lignes suivantes non numérotées.
    if (
      numero &&
      (/\d[.-]\d|^[a-z]{2,}/i.test(reference ?? "") ||
        (exigeantes.length === 0 && ligne.length <= 120))
    ) {
      section = reference;
    }
    for (const p of exigeantes) {
      const libelle = p.slice(0, EXIGENCE_LIBELLE_MAX);
      const normalise = normaliserTerme(libelle);
      if (libelle.length < EXIGENCE_LIBELLE_MIN || vues.has(normalise)) continue;
      if (exigences.length >= max) {
        tronque = true;
        break;
      }
      vues.add(normalise);
      exigences.push({
        libelle,
        categorie: categorieDe(normalise),
        obligatoire: MARQUE_OBLIGATION.test(normalise) && !MARQUE_FACULTATIF.test(normalise),
        reference,
      });
    }
    if (tronque) break;
  }
  return { exigences, tronque };
}

/** Catégorie déclarée (par l'IA ou une saisie) ramenée à la liste fermée, sinon « autre ». */
export function categorieExigence(brut: string): CategorieExigence {
  const n = normaliserTerme(brut).replace(/ /g, "_");
  const directe = (CATEGORIES_EXIGENCE as readonly string[]).find(
    (c) => c === n || (n.length >= 4 && c.startsWith(n.slice(0, 4))),
  );
  if (directe) return directe as CategorieExigence;
  return categorieDe(normaliserTerme(brut));
}

export interface LigneConformite {
  statut: StatutConformite;
  obligatoire: boolean;
}

export interface SyntheseConformite {
  total: number;
  parStatut: Record<StatutConformite, number>;
  obligatoires: number;
  obligatoiresSatisfaites: number;
  /** Exigences obligatoires qui empêchent le dépôt. */
  bloquantes: number;
  /** Part (pour-cent entier, plancher) des exigences applicables jugées conformes. */
  tauxConformite: number | null;
  pretAuDepot: boolean;
}

/** Synthèse de la matrice de conformité. */
export function syntheseConformite(lignes: readonly LigneConformite[]): SyntheseConformite {
  const parStatut = Object.fromEntries(STATUTS_CONFORMITE.map((s) => [s, 0])) as Record<
    StatutConformite,
    number
  >;
  let obligatoires = 0;
  let satisfaites = 0;
  for (const l of lignes) {
    parStatut[l.statut] += 1;
    if (l.obligatoire) {
      obligatoires += 1;
      if (STATUTS_SATISFAISANTS.includes(l.statut)) satisfaites += 1;
    }
  }
  const applicables = lignes.length - parStatut.sans_objet;
  return {
    total: lignes.length,
    parStatut,
    obligatoires,
    obligatoiresSatisfaites: satisfaites,
    bloquantes: obligatoires - satisfaites,
    tauxConformite: applicables === 0 ? null : pourCentPlancher(parStatut.conforme, applicables),
    pretAuDepot: lignes.length > 0 && satisfaites === obligatoires,
  };
}
