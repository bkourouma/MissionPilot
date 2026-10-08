/**
 * Banque d'items standard étalonnée et questionnaire adaptatif CONTRÔLÉ (NOT-09, PRD
 * complémentaire §11.1 et §4.5).
 *
 * Un item de la banque évalue UNE pratique d'une dimension sur une échelle de niveaux décrits
 * par des comportements observables (ancrages, STD-09), avec une formulation validée par public
 * (dirigeant, manager, équipe, externe, ou « tous » à défaut). Un item ne sert qu'une fois
 * VALIDÉ par un expert métier (contrôle en base, migration 0400) : cette couche ne reçoit que
 * des items validés et ne les modifie jamais.
 *
 * Questionnaire adaptatif contrôlé : la sélection (par ce moteur, ou proposée par l'IA puis
 * contrôlée par `controlerProposition`) choisit des items et une formulation DANS la banque,
 * selon des règles déterministes ; aucune question n'est inventée ni réécrite librement :
 * « reformuler » = retenir la formulation validée du public visé.
 *
 * Règles de sélection (`selectionnerItems`), mêmes entrées ⇒ même sortie :
 * 1. items candidats : dimension demandée (toutes par défaut), non exclus, dont la pratique
 *    n'est pas déjà connue (réponses déjà obtenues), avec une formulation pour le public
 *    (sinon la formulation « tous ») ;
 * 2. ordre : priorité croissante (1 = cœur de la dimension), poids décroissant, code ;
 * 3. une seule question par pratique (pas de redondance) ;
 * 4. tour par tour entre dimensions (chaque dimension reçoit son meilleur item avant qu'une
 *    autre en reçoive un second), au plus `maxParDimension` par dimension ;
 * 5. un item qui ferait dépasser la durée maximale est écarté (raison tracée).
 */
import { validerDefinition } from "../questionnaires/definition";
import {
  FORMAT_IDENTIFIANT,
  POINTS_LIKERT_MAX,
  POINTS_LIKERT_MIN,
  type DefinitionQuestionnaire,
  type QuestionLikert,
} from "../questionnaires/types";
import { ErreurNotationAugmentee, type AnomalieNotationAugmentee } from "./augmentee-erreurs";

export const PUBLICS_ITEM = ["tous", "dirigeant", "manager", "equipe", "externe"] as const;
export type PublicItem = (typeof PUBLICS_ITEM)[number];

export const PRIORITE_ITEM_MAX = 9;
export const DUREE_ITEM_MIN_SECONDES = 5;
export const DUREE_ITEM_MAX_SECONDES = 600;
/** Longueurs maximales (le questionnaire construit n'est jamais tronqué en silence : refus). */
export const FORMULATION_LONGUEUR_MAX = 500;
export const ANCRAGE_LONGUEUR_MAX = 1000;
/** Aide d'une question = ancrages réunis (« 1 : … ; 2 : … ») : 1000 caractères au plus. */
export const AIDE_LONGUEUR_MAX = 1000;

export interface AncrageNiveau {
  readonly niveau: number;
  /** Comportement observable qui caractérise le niveau. */
  readonly comportement: string;
  /** Exemples par contexte (« niveau 3 en pilotage dans une PME agro-industrielle »). */
  readonly exemples?: readonly { readonly contexte: string; readonly texte: string }[];
}

export interface FormulationItem {
  readonly public: PublicItem;
  readonly texte: string;
}

/**
 * Statistiques d'étalonnage observées (calibration, NOT-13) : facultatives, INFORMATIVES (ni la
 * sélection ni le calcul ne s'en servent) ; validées (`ETALONNAGE_INVALIDE`) pour ne pas
 * conserver de valeurs absurdes (moyenne et écart-type sont des niveaux de l'échelle).
 */
export interface EtalonnageItem {
  readonly echantillon: number;
  readonly moyenne: number;
  readonly ecartType: number;
}

export interface ItemBanque {
  readonly code: string;
  readonly dimension: string;
  readonly pratique: string;
  readonly intitule: string;
  readonly echelle: { readonly niveaux: number; readonly libelles: readonly string[] };
  readonly ancrages: readonly AncrageNiveau[];
  readonly formulations: readonly FormulationItem[];
  readonly poids: number;
  readonly priorite: number;
  readonly dureeSecondes: number;
  readonly etalonnage?: EtalonnageItem;
}

type Signaler = (code: string, chemin: string, message: string) => void;

const estEntierDans = (v: number, min: number, max: number) =>
  Number.isInteger(v) && v >= min && v <= max;

function validerEchelle(item: ItemBanque, signaler: Signaler): void {
  const { niveaux, libelles } = item.echelle;
  if (!estEntierDans(niveaux, POINTS_LIKERT_MIN, POINTS_LIKERT_MAX)) {
    signaler("ECHELLE_INVALIDE", "echelle.niveaux", `Échelle de ${niveaux} niveaux refusée.`);
    return;
  }
  if (libelles.length !== niveaux) {
    signaler("ECHELLE_INVALIDE", "echelle.libelles", "Un libellé par niveau est attendu.");
  }
  const vus = new Set<number>();
  item.ancrages.forEach((a, i) => {
    if (!estEntierDans(a.niveau, 1, niveaux) || vus.has(a.niveau)) {
      signaler("ANCRAGE_INVALIDE", `ancrages[${i}]`, "Niveau d'ancrage hors échelle ou en double.");
    }
    if (a.comportement.trim() === "") {
      signaler("ANCRAGE_INVALIDE", `ancrages[${i}]`, "Comportement observable vide.");
    } else if (a.comportement.length > ANCRAGE_LONGUEUR_MAX) {
      signaler(
        "ANCRAGE_INVALIDE",
        `ancrages[${i}]`,
        `Comportement de plus de ${ANCRAGE_LONGUEUR_MAX} caractères.`,
      );
    }
    vus.add(a.niveau);
  });
  if (Array.from({ length: niveaux }, (_, i) => i + 1).some((n) => !vus.has(n))) {
    signaler(
      "ANCRAGE_MANQUANT",
      "ancrages",
      "Chaque niveau de l'échelle doit être décrit par un comportement observable.",
    );
  }
  if (aideDepuisAncrages(item.ancrages).length > AIDE_LONGUEUR_MAX) {
    signaler(
      "ANCRAGE_INVALIDE",
      "ancrages",
      `Ancrages trop longs : ${AIDE_LONGUEUR_MAX} caractères au plus une fois réunis (aide de la question).`,
    );
  }
}

/** Texte d'aide d'une question : les ancrages par niveau croissant, « niveau : comportement ». */
function aideDepuisAncrages(ancrages: readonly AncrageNiveau[]): string {
  return [...ancrages]
    .sort((a, b) => a.niveau - b.niveau)
    .map((a) => `${a.niveau} : ${a.comportement}`)
    .join(" ; ");
}

function validerFormulations(item: ItemBanque, signaler: Signaler): void {
  if (item.formulations.length === 0) {
    signaler("FORMULATION_MANQUANTE", "formulations", "Au moins une formulation est attendue.");
  }
  const publics = new Set<string>();
  item.formulations.forEach((f, i) => {
    if (!(PUBLICS_ITEM as readonly string[]).includes(f.public) || publics.has(f.public)) {
      signaler("FORMULATION_INVALIDE", `formulations[${i}]`, "Public inconnu ou en double.");
    }
    if (f.texte.trim() === "") {
      signaler("FORMULATION_INVALIDE", `formulations[${i}]`, "Formulation vide.");
    } else if (f.texte.length > FORMULATION_LONGUEUR_MAX) {
      signaler(
        "FORMULATION_INVALIDE",
        `formulations[${i}]`,
        `Formulation de plus de ${FORMULATION_LONGUEUR_MAX} caractères.`,
      );
    }
    publics.add(f.public);
  });
}

function validerEtalonnage(item: ItemBanque, signaler: Signaler): void {
  const e = item.etalonnage;
  if (e === undefined) return;
  const niveaux = item.echelle.niveaux;
  const dansEchelle = (v: number) => Number.isFinite(v) && v >= 0 && v <= niveaux;
  if (!estEntierDans(e.echantillon, 0, 1_000_000)) {
    signaler(
      "ETALONNAGE_INVALIDE",
      "etalonnage.echantillon",
      "Échantillon entier positif attendu.",
    );
  }
  if (!dansEchelle(e.moyenne) || !dansEchelle(e.ecartType)) {
    signaler(
      "ETALONNAGE_INVALIDE",
      "etalonnage",
      "Moyenne et écart-type sont des niveaux de l'échelle (de 0 au nombre de niveaux).",
    );
  }
}

/** Anomalies d'un item de la banque (vide : item valide). */
export function validerItemBanque(item: ItemBanque): AnomalieNotationAugmentee[] {
  const anomalies: AnomalieNotationAugmentee[] = [];
  const signaler: Signaler = (code, chemin, message) => anomalies.push({ code, chemin, message });
  for (const champ of ["code", "dimension", "pratique"] as const) {
    if (!FORMAT_IDENTIFIANT.test(item[champ])) {
      signaler("IDENTIFIANT_INVALIDE", champ, `Identifiant invalide : « ${item[champ]} ».`);
    }
  }
  if (item.intitule.trim() === "") signaler("INTITULE_VIDE", "intitule", "Intitulé vide.");
  validerEchelle(item, signaler);
  validerFormulations(item, signaler);
  if (!Number.isFinite(item.poids) || item.poids <= 0 || item.poids > 100) {
    signaler("POIDS_INVALIDE", "poids", "Le poids est compris entre 0 (exclu) et 100.");
  }
  if (!estEntierDans(item.priorite, 1, PRIORITE_ITEM_MAX)) {
    signaler("PRIORITE_INVALIDE", "priorite", `Priorité entière de 1 à ${PRIORITE_ITEM_MAX}.`);
  }
  if (!estEntierDans(item.dureeSecondes, DUREE_ITEM_MIN_SECONDES, DUREE_ITEM_MAX_SECONDES)) {
    signaler(
      "DUREE_INVALIDE",
      "dureeSecondes",
      `Durée de réponse de ${DUREE_ITEM_MIN_SECONDES} à ${DUREE_ITEM_MAX_SECONDES} secondes.`,
    );
  }
  validerEtalonnage(item, signaler);
  return anomalies;
}

/** Lève `ITEM_INVALIDE` (anomalies en détails) si l'item n'est pas valide. */
export function exigerItemValide(item: ItemBanque): void {
  const anomalies = validerItemBanque(item);
  if (anomalies.length > 0) {
    throw new ErreurNotationAugmentee("ITEM_INVALIDE", "Item de banque invalide.", anomalies);
  }
}

export interface ReglesSelection {
  readonly public: PublicItem;
  /** Dimensions à couvrir (défaut : toutes celles de la banque). */
  readonly dimensions?: readonly string[];
  readonly maxParDimension: number;
  /** Budget de temps de réponse (défaut : aucun). */
  readonly dureeMaxSecondes?: number;
  /** Items à ne pas poser. */
  readonly exclure?: readonly string[];
  /** Pratiques déjà renseignées (réponses antérieures, entretien) : non reposées. */
  readonly pratiquesConnues?: readonly string[];
}

export interface ItemSelectionne {
  readonly code: string;
  readonly dimension: string;
  readonly pratique: string;
  readonly formulation: FormulationItem;
  readonly dureeSecondes: number;
}

export type RaisonEcart =
  | "exclu"
  | "pratique_connue"
  | "sans_formulation"
  | "pratique_deja_couverte"
  | "plafond_dimension"
  | "duree_depassee"
  | "dimension_non_demandee";

export interface SelectionAdaptative {
  readonly items: readonly ItemSelectionne[];
  readonly ecartes: readonly { readonly code: string; readonly raison: RaisonEcart }[];
  readonly dureeTotaleSecondes: number;
  readonly couverture: readonly {
    readonly dimension: string;
    readonly items: number;
    readonly disponibles: number;
  }[];
}

/** Durée totale de réponse d'une sélection (secondes). */
export function dureeSelection(items: readonly ItemSelectionne[]): number {
  return items.reduce((s, i) => s + i.dureeSecondes, 0);
}

/** Formulation validée retenue pour un public : la sienne, sinon « tous », sinon aucune. */
export function formulationPour(item: ItemBanque, cible: PublicItem): FormulationItem | null {
  return (
    item.formulations.find((f) => f.public === cible) ??
    item.formulations.find((f) => f.public === "tous") ??
    null
  );
}

function verifierRegles(regles: ReglesSelection): void {
  if (!(PUBLICS_ITEM as readonly string[]).includes(regles.public)) {
    throw new ErreurNotationAugmentee("OPTIONS_INVALIDES", "Public inconnu.");
  }
  if (!estEntierDans(regles.maxParDimension, 1, 50)) {
    throw new ErreurNotationAugmentee("OPTIONS_INVALIDES", "Plafond par dimension de 1 à 50.");
  }
  const duree = regles.dureeMaxSecondes;
  if (duree !== undefined && !estEntierDans(duree, DUREE_ITEM_MIN_SECONDES, 86_400)) {
    throw new ErreurNotationAugmentee("OPTIONS_INVALIDES", "Durée maximale invalide.");
  }
}

function verifierBanque(banque: readonly ItemBanque[]): void {
  const codes = new Set<string>();
  banque.forEach((item, i) => {
    const anomalies = validerItemBanque(item);
    if (anomalies.length > 0 || codes.has(item.code)) {
      throw new ErreurNotationAugmentee(
        "ITEM_INVALIDE",
        `Item de banque invalide ou en double : « ${item.code} ».`,
        anomalies.map((a) => ({ ...a, chemin: `banque[${i}].${a.chemin}` })),
      );
    }
    codes.add(item.code);
  });
}

const ordreItems = (a: ItemBanque, b: ItemBanque) =>
  a.priorite - b.priorite || b.poids - a.poids || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0);

/** Sélection adaptative déterministe d'items validés de la banque (règles en tête du fichier). */
export function selectionnerItems(
  banque: readonly ItemBanque[],
  regles: ReglesSelection,
): SelectionAdaptative {
  verifierRegles(regles);
  verifierBanque(banque);
  const exclus = new Set(regles.exclure ?? []);
  const connues = new Set(regles.pratiquesConnues ?? []);
  const demandees = regles.dimensions ? new Set(regles.dimensions) : null;
  const ecartes: { code: string; raison: RaisonEcart }[] = [];
  const parDimension = new Map<string, ItemBanque[]>();
  for (const item of [...banque].sort(ordreItems)) {
    let raison: RaisonEcart | null = null;
    if (demandees && !demandees.has(item.dimension)) raison = "dimension_non_demandee";
    else if (exclus.has(item.code)) raison = "exclu";
    else if (connues.has(item.pratique)) raison = "pratique_connue";
    else if (!formulationPour(item, regles.public)) raison = "sans_formulation";
    if (raison) {
      ecartes.push({ code: item.code, raison });
      continue;
    }
    parDimension.set(item.dimension, [...(parDimension.get(item.dimension) ?? []), item]);
  }
  const dimensions = demandees
    ? [...demandees].filter((d) => parDimension.has(d))
    : [...parDimension.keys()].sort();
  const files = new Map(dimensions.map((d) => [d, [...(parDimension.get(d) ?? [])]]));
  const items: ItemSelectionne[] = [];
  const pratiques = new Set<string>();
  const comptes = new Map<string, number>();
  let duree = 0;
  let ajout = true;
  while (ajout) {
    ajout = false;
    for (const d of dimensions) {
      const file = files.get(d) as ItemBanque[];
      while (file.length > 0) {
        const item = file.shift() as ItemBanque;
        if (pratiques.has(item.pratique)) {
          ecartes.push({ code: item.code, raison: "pratique_deja_couverte" });
          continue;
        }
        if ((comptes.get(d) ?? 0) >= regles.maxParDimension) {
          ecartes.push({ code: item.code, raison: "plafond_dimension" });
          continue;
        }
        if (
          regles.dureeMaxSecondes !== undefined &&
          duree + item.dureeSecondes > regles.dureeMaxSecondes
        ) {
          ecartes.push({ code: item.code, raison: "duree_depassee" });
          continue;
        }
        items.push({
          code: item.code,
          dimension: item.dimension,
          pratique: item.pratique,
          formulation: formulationPour(item, regles.public) as FormulationItem,
          dureeSecondes: item.dureeSecondes,
        });
        pratiques.add(item.pratique);
        comptes.set(d, (comptes.get(d) ?? 0) + 1);
        duree += item.dureeSecondes;
        ajout = true;
        break;
      }
    }
  }
  return {
    items,
    ecartes: ecartes.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0)),
    dureeTotaleSecondes: duree,
    couverture: dimensions.map((d) => ({
      dimension: d,
      items: comptes.get(d) ?? 0,
      disponibles: (parDimension.get(d) ?? []).length,
    })),
  };
}

export interface PropositionItem {
  readonly code: string;
  /** Public dont la formulation validée est retenue. */
  readonly public: PublicItem;
}

/**
 * Contrôle une sélection PROPOSÉE (par l'IA ou un consultant) : chaque item existe dans la banque
 * validée, la formulation retenue est l'une de ses formulations validées (celle du public visé ou
 * « tous »), aucun doublon d'item ni de pratique, items non exclus et pratiques non connues
 * (`regles.exclure`, `regles.pratiquesConnues`, comme `selectionnerItems`), dimensions demandées,
 * plafond par dimension et durée respectés. Rend la sélection contrôlée, sinon lève `SELECTION_INVALIDE` avec les anomalies.
 */
export function controlerProposition(
  banque: readonly ItemBanque[],
  proposition: readonly PropositionItem[],
  regles: ReglesSelection,
): ItemSelectionne[] {
  verifierRegles(regles);
  verifierBanque(banque);
  const parCode = new Map(banque.map((i) => [i.code, i]));
  const exclus = new Set(regles.exclure ?? []);
  const connues = new Set(regles.pratiquesConnues ?? []);
  const anomalies: AnomalieNotationAugmentee[] = [];
  const signaler: Signaler = (code, chemin, message) => anomalies.push({ code, chemin, message });
  const codes = new Set<string>();
  const pratiques = new Set<string>();
  const comptes = new Map<string, number>();
  const items: ItemSelectionne[] = [];
  let duree = 0;
  if (proposition.length === 0) signaler("SELECTION_VIDE", "items", "Aucun item proposé.");
  proposition.forEach((p, i) => {
    const chemin = `items[${i}]`;
    const item = parCode.get(p.code);
    if (!item) return signaler("ITEM_HORS_BANQUE", chemin, `Item hors banque : « ${p.code} ».`);
    if (codes.has(p.code)) return signaler("ITEM_EN_DOUBLE", chemin, "Item proposé deux fois.");
    codes.add(p.code);
    if (regles.dimensions && !regles.dimensions.includes(item.dimension)) {
      signaler("DIMENSION_NON_DEMANDEE", chemin, "Dimension hors du périmètre demandé.");
    }
    if (pratiques.has(item.pratique))
      signaler("PRATIQUE_EN_DOUBLE", chemin, "Pratique redondante.");
    pratiques.add(item.pratique);
    // Mêmes règles de sélection que `selectionnerItems` : un item exclu ou dont la pratique est
    // déjà connue (réponses antérieures) ne se repose pas, qui que soit l'auteur de la proposition.
    if (exclus.has(item.code)) signaler("ITEM_EXCLU", chemin, "Item exclu par les règles.");
    if (connues.has(item.pratique)) {
      signaler("PRATIQUE_CONNUE", chemin, "Pratique déjà renseignée : elle ne se repose pas.");
    }
    const formulation = item.formulations.find((f) => f.public === p.public);
    if (!formulation || (p.public !== regles.public && p.public !== "tous")) {
      signaler("FORMULATION_HORS_BANQUE", chemin, "Formulation non validée pour ce public.");
    }
    comptes.set(item.dimension, (comptes.get(item.dimension) ?? 0) + 1);
    duree += item.dureeSecondes;
    if (formulation) {
      items.push({
        code: item.code,
        dimension: item.dimension,
        pratique: item.pratique,
        formulation,
        dureeSecondes: item.dureeSecondes,
      });
    }
  });
  for (const [dimension, n] of comptes) {
    if (n > regles.maxParDimension) {
      signaler("PLAFOND_DIMENSION", dimension, `Plus de ${regles.maxParDimension} items.`);
    }
  }
  if (regles.dureeMaxSecondes !== undefined && duree > regles.dureeMaxSecondes) {
    signaler("DUREE_DEPASSEE", "items", "Durée de réponse maximale dépassée.");
  }
  if (anomalies.length > 0) {
    throw new ErreurNotationAugmentee("SELECTION_INVALIDE", "Sélection refusée.", anomalies);
  }
  return items;
}

/**
 * Définition de questionnaire construite depuis une sélection : une section par dimension (ordre
 * de première apparition), une question de Likert par item (identifiant = code de l'item,
 * libellé = formulation validée, échelle et ancrages de l'item en aide). Contrôlée par le moteur
 * de questionnaires (`validerDefinition`).
 */
export function definitionDepuisSelection(
  banque: readonly ItemBanque[],
  selection: readonly ItemSelectionne[],
  meta: {
    readonly id: string;
    readonly titre: string;
    readonly libellesDimensions?: Readonly<Record<string, string>>;
  },
): DefinitionQuestionnaire {
  const parCode = new Map(banque.map((i) => [i.code, i]));
  const sections = new Map<string, QuestionLikert[]>();
  for (const s of selection) {
    const item = parCode.get(s.code);
    if (!item) {
      throw new ErreurNotationAugmentee("SELECTION_INVALIDE", `Item hors banque : « ${s.code} ».`);
    }
    // Aucune troncature : une formulation ou des ancrages trop longs sont refusés (item invalide
    // à l'écriture, `validerItemBanque`) ou, ici, par `validerDefinition` ci-dessous.
    if (s.formulation.texte.length > FORMULATION_LONGUEUR_MAX) {
      throw new ErreurNotationAugmentee(
        "SELECTION_INVALIDE",
        `Formulation trop longue pour l'item « ${s.code} ».`,
        [{ code: "FORMULATION_INVALIDE", chemin: s.code, message: "Formulation trop longue." }],
      );
    }
    const ancrages = aideDepuisAncrages(item.ancrages);
    if (ancrages.length > AIDE_LONGUEUR_MAX) {
      throw new ErreurNotationAugmentee(
        "SELECTION_INVALIDE",
        `Ancrages trop longs pour l'item « ${s.code} ».`,
        [{ code: "ANCRAGE_INVALIDE", chemin: s.code, message: "Ancrages trop longs." }],
      );
    }
    const question: QuestionLikert = {
      id: item.code,
      type: "likert",
      libelle: s.formulation.texte,
      aide: ancrages,
      obligatoire: true,
      points: item.echelle.niveaux,
      libelles: item.echelle.libelles,
    };
    sections.set(item.dimension, [...(sections.get(item.dimension) ?? []), question]);
  }
  const definition: DefinitionQuestionnaire = {
    id: meta.id,
    version: 1,
    titre: meta.titre,
    sections: [...sections.entries()].map(([dimension, questions]) => ({
      id: dimension,
      titre: meta.libellesDimensions?.[dimension] ?? dimension,
      questions,
    })),
  };
  const controle = validerDefinition(definition);
  if (!controle.valide) {
    throw new ErreurNotationAugmentee(
      "SELECTION_INVALIDE",
      "La définition construite depuis la banque est invalide.",
      controle.erreurs,
    );
  }
  return definition;
}
