/**
 * Cascade stratégique en graphe (PLA-12) : vision → axes → objectifs →
 * initiatives → projets → jalons, et KPI rattachés aux objectifs. Fonction
 * pure : aucune base, aucune horloge (la date de référence est un paramètre).
 *
 * Règles :
 * - Parents admis par type (`PARENTS_ADMIS`) : un nœud dont le parent est
 *   absent de la liste, ou d'un type non admis, est ORPHELIN (signalé, placé
 *   à la racine) ; il l'est aussi, quel que soit son type (un axe ou une
 *   vision compris), dès qu'il PORTE un `parentId` qui ne mène à aucun parent
 *   admis. Un nœud sans `parentId` n'est orphelin que si son type n'est pas
 *   une racine admise (vision, axe). La hiérarchie des types est stricte :
 *   aucun cycle possible.
 * - Un nœud INACTIF (initiative abandonnée, KPI désactivé, projet abandonné…)
 *   est montré mais ne « couvre » pas son parent et n'est l'objet d'aucun trou,
 *   pas même NOEUD_ORPHELIN (son drapeau `orphelin` reste faux).
 * - Chaque nœud actif a un porteur ; sinon trou `SANS_PORTEUR`, d'autant plus
 *   grave que le nœud est opérationnel (initiative, projet : bloquant).
 * - Trous de structure : vision absente, axe sans objectif, objectif sans KPI
 *   (bloquant) ou sans initiative, initiative hors objectif ou sans projet,
 *   projet sans jalon, jalon prévu dont l'échéance est passée.
 * - Taux de couverture en pourcentage entier (demi vers le haut).
 */
import { analyserDateISO, type DateISO } from "../commun/dates";
import { ErreurPlan } from "./erreurs";

export const TYPES_NOEUD_CASCADE = [
  "vision",
  "axe",
  "objectif",
  "initiative",
  "projet",
  "jalon",
  "kpi",
] as const;
export type TypeNoeudCascade = (typeof TYPES_NOEUD_CASCADE)[number];

/** Types de parent admis pour chaque type de nœud (vide : racine). */
export const PARENTS_ADMIS: Readonly<Record<TypeNoeudCascade, readonly TypeNoeudCascade[]>> = {
  vision: [],
  axe: ["vision"],
  objectif: ["axe"],
  initiative: ["axe", "objectif"],
  projet: ["initiative"],
  jalon: ["projet"],
  kpi: ["objectif"],
};

/** Types qui peuvent être à la racine sans être orphelins (axe : plan sans vision). */
const RACINES_ADMISES: readonly TypeNoeudCascade[] = ["vision", "axe"];

export type CodeTrouCascade =
  | "VISION_ABSENTE"
  | "SANS_PORTEUR"
  | "AXE_SANS_OBJECTIF"
  | "OBJECTIF_SANS_KPI"
  | "OBJECTIF_SANS_INITIATIVE"
  | "INITIATIVE_HORS_OBJECTIF"
  | "INITIATIVE_SANS_PROJET"
  | "PROJET_SANS_JALON"
  | "JALON_EN_RETARD"
  | "NOEUD_ORPHELIN";

export type GraviteTrou = "bloquant" | "important" | "information";

/** Gravité du trou « sans porteur » selon le type du nœud. */
const GRAVITE_SANS_PORTEUR: Readonly<Record<TypeNoeudCascade, GraviteTrou>> = {
  vision: "information",
  axe: "information",
  objectif: "important",
  initiative: "bloquant",
  projet: "bloquant",
  jalon: "important",
  kpi: "important",
};

const GRAVITES: Readonly<Record<Exclude<CodeTrouCascade, "SANS_PORTEUR">, GraviteTrou>> = {
  VISION_ABSENTE: "important",
  AXE_SANS_OBJECTIF: "important",
  OBJECTIF_SANS_KPI: "bloquant",
  OBJECTIF_SANS_INITIATIVE: "important",
  INITIATIVE_HORS_OBJECTIF: "information",
  INITIATIVE_SANS_PROJET: "information",
  PROJET_SANS_JALON: "important",
  JALON_EN_RETARD: "important",
  NOEUD_ORPHELIN: "important",
};

export interface NoeudCascade {
  readonly id: string;
  readonly type: TypeNoeudCascade;
  readonly parentId: string | null;
  readonly titre: string;
  readonly porteurId: string | null;
  /** Faux : nœud abandonné ou désactivé (montré, sans effet sur la couverture). */
  readonly actif?: boolean;
  /** Jalon : échéance AAAA-MM-JJ. */
  readonly echeance?: DateISO | null;
  /** Jalon : « prevu », « atteint » ou « manque » (seul « prevu » peut être en retard). */
  readonly statut?: string | null;
}

export interface TrouCascade {
  readonly code: CodeTrouCascade;
  readonly gravite: GraviteTrou;
  /** Nœud concerné (null : trou du plan entier, comme la vision absente). */
  readonly noeudId: string | null;
  readonly type: TypeNoeudCascade | null;
}

export interface NoeudAnalyse {
  readonly id: string;
  readonly type: TypeNoeudCascade;
  readonly parentId: string | null;
  readonly titre: string;
  readonly porteurId: string | null;
  readonly actif: boolean;
  readonly profondeur: number;
  readonly enfants: readonly string[];
  readonly orphelin: boolean;
  readonly trous: readonly CodeTrouCascade[];
}

export interface AnalyseCascade {
  /** Nœuds en parcours en profondeur depuis les racines (ordre d'entrée conservé). */
  readonly noeuds: readonly NoeudAnalyse[];
  readonly racines: readonly string[];
  readonly trous: readonly TrouCascade[];
  readonly compteurs: Readonly<Record<TypeNoeudCascade, number>>;
  readonly couverture: {
    readonly noeudsActifs: number;
    readonly noeudsAvecPorteur: number;
    /** Pourcentage entier de nœuds actifs dotés d'un porteur (100 sans nœud). */
    readonly tauxPorteurs: number;
    readonly objectifs: number;
    readonly objectifsAvecKpi: number;
    /** Pourcentage entier d'objectifs actifs dotés d'au moins un KPI actif (100 sans objectif). */
    readonly tauxKpi: number;
  };
  readonly synthese: Readonly<Record<GraviteTrou, number>>;
}

/** Pourcentage entier `100 × a / b`, demi vers le haut ; 100 si b = 0. */
export function pourcentageEntier(a: number, b: number): number {
  if (b === 0) return 100;
  return Math.floor((200 * a + b) / (2 * b));
}

function controlerNoeuds(noeuds: readonly NoeudCascade[], reference: DateISO): void {
  if (!analyserDateISO(reference).valide) {
    throw new ErreurPlan("DATE_INVALIDE", "Date de référence invalide.", "reference");
  }
  const vus = new Set<string>();
  noeuds.forEach((n, i) => {
    if (!TYPES_NOEUD_CASCADE.includes(n.type)) {
      throw new ErreurPlan("CASCADE_INVALIDE", "Type de nœud inconnu.", `noeuds[${i}].type`);
    }
    if (vus.has(n.id)) {
      throw new ErreurPlan("CASCADE_INVALIDE", "Nœud en double.", `noeuds[${i}].id`);
    }
    vus.add(n.id);
    if (n.echeance && !analyserDateISO(n.echeance).valide) {
      throw new ErreurPlan("DATE_INVALIDE", "Échéance invalide.", `noeuds[${i}].echeance`);
    }
  });
}

/** Parent effectif : présent et d'un type admis, sinon null (nœud orphelin s'il n'est pas racine). */
function parentEffectif(n: NoeudCascade, parId: ReadonlyMap<string, NoeudCascade>): string | null {
  if (n.parentId === null) return null;
  const p = parId.get(n.parentId);
  return p && PARENTS_ADMIS[n.type].includes(p.type) ? p.id : null;
}

/** Trous de structure d'un nœud actif d'après ses enfants actifs et son parent effectif. */
function trousDeStructure(
  n: NoeudCascade,
  enfantsActifs: readonly NoeudCascade[],
  parent: NoeudCascade | null,
  reference: DateISO,
): CodeTrouCascade[] {
  const a = (t: TypeNoeudCascade) => enfantsActifs.some((e) => e.type === t);
  const trous: CodeTrouCascade[] = [];
  if (n.type === "axe" && !a("objectif")) trous.push("AXE_SANS_OBJECTIF");
  if (n.type === "objectif") {
    if (!a("kpi")) trous.push("OBJECTIF_SANS_KPI");
    if (!a("initiative")) trous.push("OBJECTIF_SANS_INITIATIVE");
  }
  if (n.type === "initiative") {
    if (parent?.type === "axe") trous.push("INITIATIVE_HORS_OBJECTIF");
    if (!a("projet")) trous.push("INITIATIVE_SANS_PROJET");
  }
  if (n.type === "projet" && !a("jalon")) trous.push("PROJET_SANS_JALON");
  if (n.type === "jalon" && n.statut === "prevu" && n.echeance && n.echeance < reference) {
    trous.push("JALON_EN_RETARD");
  }
  return trous;
}

const graviteDe = (code: CodeTrouCascade, type: TypeNoeudCascade): GraviteTrou =>
  code === "SANS_PORTEUR" ? GRAVITE_SANS_PORTEUR[type] : GRAVITES[code];

/**
 * Analyse la cascade : arbre (racines, profondeur, enfants), trous signalés par nœud et pour le
 * plan, compteurs par type et taux de couverture (porteurs, KPI des objectifs).
 */
export function analyserCascade(
  noeuds: readonly NoeudCascade[],
  reference: DateISO,
): AnalyseCascade {
  controlerNoeuds(noeuds, reference);
  const parId = new Map(noeuds.map((n) => [n.id, n]));
  const parents = new Map(noeuds.map((n) => [n.id, parentEffectif(n, parId)]));
  const enfants = new Map<string, NoeudCascade[]>(noeuds.map((n) => [n.id, []]));
  for (const n of noeuds) {
    const p = parents.get(n.id);
    if (p) enfants.get(p)?.push(n);
  }
  const actif = (n: NoeudCascade) => n.actif !== false;
  const trous: TrouCascade[] = [];
  const trousParNoeud = new Map<string, CodeTrouCascade[]>();
  if (!noeuds.some((n) => n.type === "vision" && actif(n))) {
    trous.push({ code: "VISION_ABSENTE", gravite: "important", noeudId: null, type: null });
  }
  for (const n of noeuds) {
    const codes: CodeTrouCascade[] = [];
    const p = parents.get(n.id) ?? null;
    if (actif(n)) {
      // Racine admise sans `parentId` : jamais orphelin ; avec un `parentId` sans parent admis : orphelin.
      const orphelin = p === null && (n.parentId !== null || !RACINES_ADMISES.includes(n.type));
      if (orphelin) codes.push("NOEUD_ORPHELIN");
      if (!n.porteurId) codes.push("SANS_PORTEUR");
      const enfantsActifs = (enfants.get(n.id) ?? []).filter(actif);
      codes.push(
        ...trousDeStructure(n, enfantsActifs, p ? (parId.get(p) ?? null) : null, reference),
      );
    }
    trousParNoeud.set(n.id, codes);
    for (const code of codes) {
      trous.push({ code, gravite: graviteDe(code, n.type), noeudId: n.id, type: n.type });
    }
  }
  const racines = noeuds.filter((n) => !parents.get(n.id)).map((n) => n.id);
  const ordonnes: NoeudAnalyse[] = [];
  const visiter = (id: string, profondeur: number) => {
    const n = parId.get(id) as NoeudCascade;
    const fils = (enfants.get(id) ?? []).map((e) => e.id);
    ordonnes.push({
      id: n.id,
      type: n.type,
      parentId: parents.get(id) ?? null,
      titre: n.titre,
      porteurId: n.porteurId,
      actif: actif(n),
      profondeur,
      enfants: fils,
      orphelin: (trousParNoeud.get(id) ?? []).includes("NOEUD_ORPHELIN"),
      trous: trousParNoeud.get(id) ?? [],
    });
    for (const f of fils) visiter(f, profondeur + 1);
  };
  for (const r of racines) visiter(r, 0);
  return {
    noeuds: ordonnes,
    racines,
    trous,
    compteurs: compter(noeuds),
    couverture: couverture(noeuds, enfants),
    synthese: {
      bloquant: trous.filter((t) => t.gravite === "bloquant").length,
      important: trous.filter((t) => t.gravite === "important").length,
      information: trous.filter((t) => t.gravite === "information").length,
    },
  };
}

function compter(noeuds: readonly NoeudCascade[]): Record<TypeNoeudCascade, number> {
  const c = Object.fromEntries(TYPES_NOEUD_CASCADE.map((t) => [t, 0])) as Record<
    TypeNoeudCascade,
    number
  >;
  for (const n of noeuds) c[n.type] += 1;
  return c;
}

function couverture(
  noeuds: readonly NoeudCascade[],
  enfants: ReadonlyMap<string, readonly NoeudCascade[]>,
): AnalyseCascade["couverture"] {
  const actifs = noeuds.filter((n) => n.actif !== false);
  const avecPorteur = actifs.filter((n) => n.porteurId).length;
  const objectifs = actifs.filter((n) => n.type === "objectif");
  const avecKpi = objectifs.filter((o) =>
    (enfants.get(o.id) ?? []).some((e) => e.type === "kpi" && e.actif !== false),
  ).length;
  return {
    noeudsActifs: actifs.length,
    noeudsAvecPorteur: avecPorteur,
    tauxPorteurs: pourcentageEntier(avecPorteur, actifs.length),
    objectifs: objectifs.length,
    objectifsAvecKpi: avecKpi,
    tauxKpi: pourcentageEntier(avecKpi, objectifs.length),
  };
}
