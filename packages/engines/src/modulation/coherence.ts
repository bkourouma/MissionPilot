/**
 * Contrôle de cohérence d'une version de méthode (STD-11) : références entre
 * étapes, briques, éléments, rubriques, règles et cas types ; qualité des
 * rubriques ; contradictions et règles sans portée dans le jeu de règles.
 * Fonction pure et déterministe : mêmes entrées ⇒ même sortie, quel que soit
 * l'ordre des entrées ; aucune IA, aucune base, aucune horloge.
 */
import { cleEffet, comparerCodes, valeurEffet } from "./effets";
import type { ConditionModulation, EffetModulation, RegleModulation } from "./types";

export type CodeAnomalieCoherence =
  | "REFERENCE_CASSEE"
  | "RUBRIQUE_SANS_ANCRAGE"
  | "RUBRIQUE_ANCRAGES_IDENTIQUES"
  | "RUBRIQUE_SANS_EXEMPLE"
  | "RUBRIQUE_NON_RATTACHEE"
  | "REGLES_CONTRADICTOIRES"
  | "REGLE_SANS_EFFET_REEL"
  | "REGLE_INACTIVE"
  | "CONDITION_INSATISFAISABLE"
  | "BRIQUE_INATTEIGNABLE"
  | "CYCLE_HERITAGE"
  | "HERITAGE_INCOHERENT";

export interface AnomalieCoherence {
  code: CodeAnomalieCoherence;
  gravite: "erreur" | "avertissement";
  regle: string | null;
  chemin: string;
  message: string;
}

export interface EntreeCoherence {
  etapes: readonly { code: string }[];
  briques: readonly { code: string; etape_code: string; active_par_defaut: boolean }[];
  elements: readonly {
    code: string;
    type: string;
    brique_code: string | null;
    actif_par_defaut: boolean;
  }[];
  rubriques: readonly {
    code: string;
    brique_code: string | null;
    dimension: string | null;
    ancrages: unknown;
  }[];
  regles: readonly RegleModulation[];
  cas_types: readonly {
    code: string;
    briques_de_base?: readonly string[];
    attendu: {
      presents?: readonly EffetModulation[];
      absents?: readonly EffetModulation[];
      regles_declenchees?: readonly string[];
    };
  }[];
}

export function erreurCoherence(
  code: CodeAnomalieCoherence,
  regle: string | null,
  chemin: string,
  message: string,
): AnomalieCoherence {
  return { code, gravite: "erreur", regle, chemin, message };
}

function avertissement(
  code: CodeAnomalieCoherence,
  regle: string | null,
  chemin: string,
  message: string,
): AnomalieCoherence {
  return { code, gravite: "avertissement", regle, chemin, message };
}

/** Tri stable : erreurs d'abord, puis code, puis chemin. */
export function trierAnomaliesCoherence(
  anomalies: readonly AnomalieCoherence[],
): AnomalieCoherence[] {
  return anomalies
    .map((a, i) => ({ a, i }))
    .sort(
      (x, y) =>
        (x.a.gravite === y.a.gravite ? 0 : x.a.gravite === "erreur" ? -1 : 1) ||
        comparerCodes(x.a.code, y.a.code) ||
        comparerCodes(x.a.chemin, y.a.chemin) ||
        x.i - y.i,
    )
    .map(({ a }) => a);
}

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

function cumulable(e: EffetModulation): boolean {
  return e.type === "recommandation_candidate" || e.type === "relever_classe_risque";
}

/** Forme canonique d'une condition : ordre des enfants et des listes sans effet. */
function canonique(c: ConditionModulation): string {
  switch (c.type) {
    case "tous":
    case "au_moins_un":
      return `${c.type}(${c.conditions.map(canonique).sort(comparerCodes).join(",")})`;
    case "non":
      return `non(${canonique(c.condition)})`;
    case "brique_active":
      return `brique_active(${JSON.stringify(c.brique)})`;
    case "comparaison": {
      const valeur =
        c.comparateur === "dans" && Array.isArray(c.valeur)
          ? [...(c.valeur as readonly (string | number)[])].sort((a, b) =>
              comparerCodes(JSON.stringify(a), JSON.stringify(b)),
            )
          : c.valeur;
      return `comparaison(${JSON.stringify(c.facteur)},${c.comparateur},${JSON.stringify(valeur)})`;
    }
  }
}

/**
 * Vrai seulement si la condition ne peut jamais être vraie (détection simple
 * et sûre). Une négation n'est jamais jugée insatisfaisable : on ne conclut
 * rien d'incertain.
 */
function insatisfaisable(c: ConditionModulation): boolean {
  if (c.type === "au_moins_un") {
    return c.conditions.length > 0 && c.conditions.every(insatisfaisable);
  }
  if (c.type !== "tous") return false;
  if (c.conditions.some(insatisfaisable)) return true;
  const egaux = new Map<string, Set<string>>();
  const differents = new Map<string, Set<string>>();
  for (const s of c.conditions) {
    if (s.type !== "comparaison") continue;
    const cible =
      s.comparateur === "egal" ? egaux : s.comparateur === "different" ? differents : null;
    if (cible === null) continue;
    const set = cible.get(s.facteur) ?? new Set<string>();
    set.add(JSON.stringify(s.valeur));
    cible.set(s.facteur, set);
  }
  for (const [facteur, valeurs] of egaux) {
    if (valeurs.size > 1) return true;
    const [v] = [...valeurs];
    if (differents.get(facteur)?.has(v!)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Contrôles
// ---------------------------------------------------------------------------

function referencesCassees(e: EntreeCoherence): AnomalieCoherence[] {
  const sortie: AnomalieCoherence[] = [];
  const etapes = new Set(e.etapes.map((x) => x.code));
  const briques = new Set(e.briques.map((x) => x.code));
  const items = new Set(e.elements.filter((x) => x.type === "item").map((x) => x.code));
  const regles = new Set(e.regles.map((x) => x.code));
  const casse = (chemin: string, message: string): void => {
    sortie.push(erreurCoherence("REFERENCE_CASSEE", null, chemin, message));
  };
  for (const b of e.briques) {
    if (!etapes.has(b.etape_code)) {
      casse(
        `briques.${b.code}`,
        `La brique « ${b.code} » est rattachée à l'étape « ${b.etape_code} », qui n'existe pas.`,
      );
    }
  }
  for (const el of e.elements) {
    if (el.brique_code !== null && !briques.has(el.brique_code)) {
      casse(
        `elements.${el.code}.brique`,
        `L'élément « ${el.code} » est rattaché à la brique « ${el.brique_code} », qui n'existe pas.`,
      );
    }
  }
  for (const r of e.rubriques) {
    if (r.brique_code !== null && !briques.has(r.brique_code)) {
      casse(
        `rubriques.${r.code}.brique`,
        `La rubrique « ${r.code} » est rattachée à la brique « ${r.brique_code} », qui n'existe pas.`,
      );
    }
  }
  for (const cas of e.cas_types) {
    const base = `cas_types.${cas.code}`;
    for (const b of cas.briques_de_base ?? []) {
      if (!briques.has(b)) {
        casse(
          `${base}.briques_de_base`,
          `Le cas type « ${cas.code} » part d'une brique inconnue : « ${b} ».`,
        );
      }
    }
    for (const r of cas.attendu.regles_declenchees ?? []) {
      if (!regles.has(r)) {
        casse(
          `${base}.attendu.regles_declenchees`,
          `Le cas type « ${cas.code} » attend une règle inconnue : « ${r} ».`,
        );
      }
    }
    for (const famille of ["presents", "absents"] as const) {
      for (const eff of cas.attendu[famille] ?? []) {
        let cible: string | null = null;
        let connu = true;
        if (eff.type === "activer_brique" || eff.type === "retirer_brique") {
          cible = eff.brique;
          connu = briques.has(cible);
        } else if (eff.type === "activer_item" || eff.type === "retirer_item") {
          cible = eff.item;
          connu = items.has(cible);
        }
        if (cible !== null && !connu) {
          casse(
            `${base}.attendu.${famille}`,
            `Le cas type « ${cas.code} » attend un effet sur « ${cible} », qui n'existe pas.`,
          );
        }
      }
    }
  }
  return sortie;
}

function normaliser(texte: string): string {
  return texte.trim().replace(/\s+/g, " ").toLowerCase();
}

function estObjet(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function controlerRubriques(e: EntreeCoherence): AnomalieCoherence[] {
  const sortie: AnomalieCoherence[] = [];
  for (const r of e.rubriques) {
    const chemin = `rubriques.${r.code}.ancrages`;
    if (r.brique_code === null && r.dimension === null) {
      sortie.push(
        avertissement(
          "RUBRIQUE_NON_RATTACHEE",
          null,
          `rubriques.${r.code}`,
          `La rubrique « ${r.code} » n'est rattachée ni à une brique ni à une dimension.`,
        ),
      );
    }
    const liste: unknown[] = Array.isArray(r.ancrages) ? (r.ancrages as unknown[]) : [];
    const defauts: string[] = [];
    if (!Array.isArray(r.ancrages)) defauts.push("les ancrages ne forment pas une liste");
    else if (liste.length !== 5) defauts.push(`${liste.length} ancrage(s) au lieu de 5`);
    liste.slice(0, 5).forEach((a, i) => {
      if (!estObjet(a)) {
        defauts.push(`le niveau ${i + 1} n'est pas un ancrage`);
      } else if (a.niveau !== i + 1) {
        defauts.push(
          `le niveau en position ${i + 1} vaut ${JSON.stringify(a.niveau) ?? "absent"} au lieu de ${i + 1}`,
        );
      } else if (typeof a.description !== "string" || a.description.trim() === "") {
        defauts.push(`le niveau ${i + 1} n'a pas de description`);
      }
    });
    if (defauts.length > 0) {
      sortie.push(
        erreurCoherence(
          "RUBRIQUE_SANS_ANCRAGE",
          null,
          chemin,
          `Ancrages de la rubrique « ${r.code} » invalides : ${defauts.join(" ; ")}.`,
        ),
      );
      continue;
    }
    const ancrages = liste as Record<string, unknown>[];
    const vus = new Map<string, number>();
    const doublons: string[] = [];
    ancrages.forEach((a, i) => {
      const cle = normaliser(a.description as string);
      const premier = vus.get(cle);
      if (premier === undefined) vus.set(cle, i + 1);
      else doublons.push(`${premier} et ${i + 1}`);
    });
    if (doublons.length > 0) {
      sortie.push(
        avertissement(
          "RUBRIQUE_ANCRAGES_IDENTIQUES",
          null,
          chemin,
          `La rubrique « ${r.code} » a des niveaux à la description identique : ${doublons.join(" ; ")}.`,
        ),
      );
    }
    if (!ancrages.some((a) => Array.isArray(a.exemples) && a.exemples.length > 0)) {
      sortie.push(
        avertissement(
          "RUBRIQUE_SANS_EXEMPLE",
          null,
          chemin,
          `La rubrique « ${r.code} » n'a aucun exemple d'ancrage.`,
        ),
      );
    }
  }
  return sortie;
}

function contradictoires(actives: readonly RegleModulation[]): AnomalieCoherence[] {
  const sortie: AnomalieCoherence[] = [];
  const triees = [...actives].sort((a, b) => comparerCodes(a.code, b.code));
  const formes = new Map(triees.map((r) => [r.code, canonique(r.condition)]));
  for (let i = 0; i < triees.length; i++) {
    const a = triees[i]!;
    for (let j = i + 1; j < triees.length; j++) {
      const b = triees[j]!;
      if (a.priorite !== b.priorite || formes.get(a.code) !== formes.get(b.code)) continue;
      const valeursA = new Map<string, Set<string>>();
      for (const eff of a.effets) {
        if (cumulable(eff)) continue;
        const set = valeursA.get(cleEffet(eff)) ?? new Set<string>();
        set.add(valeurEffet(eff));
        valeursA.set(cleEffet(eff), set);
      }
      const cles = new Set<string>();
      for (const eff of b.effets) {
        if (cumulable(eff)) continue;
        const va = valeursA.get(cleEffet(eff));
        if (va !== undefined && !(va.size === 1 && va.has(valeurEffet(eff)))) {
          cles.add(cleEffet(eff));
        }
      }
      if (cles.size > 0) {
        sortie.push(
          erreurCoherence(
            "REGLES_CONTRADICTOIRES",
            a.code,
            `regles.${a.code}`,
            `Les règles « ${a.code} » et « ${b.code} » (priorité ${a.priorite}) ont la même condition et des effets contradictoires sur ${[...cles].sort(comparerCodes).join(", ")}.`,
          ),
        );
      }
    }
  }
  return sortie;
}

function portees(e: EntreeCoherence, actives: readonly RegleModulation[]): AnomalieCoherence[] {
  const sortie: AnomalieCoherence[] = [];
  const briquesDefaut = new Map(e.briques.map((b) => [b.code, b.active_par_defaut]));
  const itemsDefaut = new Map(
    e.elements.filter((x) => x.type === "item").map((x) => [x.code, x.actif_par_defaut]),
  );
  const effets = actives.flatMap((r) => r.effets);
  const activees = new Set<string>();
  const retirees = new Set<string>();
  const itemsActives = new Set<string>();
  const itemsRetires = new Set<string>();
  for (const x of effets) {
    if (x.type === "activer_brique") activees.add(x.brique);
    else if (x.type === "retirer_brique") retirees.add(x.brique);
    else if (x.type === "activer_item") itemsActives.add(x.item);
    else if (x.type === "retirer_item") itemsRetires.add(x.item);
  }
  const sansPortee = (x: EffetModulation): boolean => {
    switch (x.type) {
      case "activer_brique":
        return briquesDefaut.get(x.brique) === true && !retirees.has(x.brique);
      case "retirer_brique":
        return briquesDefaut.get(x.brique) === false && !activees.has(x.brique);
      case "activer_item":
        return itemsDefaut.get(x.item) === true && !itemsRetires.has(x.item);
      case "retirer_item":
        return itemsDefaut.get(x.item) === false && !itemsActives.has(x.item);
      default:
        return false;
    }
  };
  for (const r of actives) {
    if (r.effets.length > 0 && r.effets.every(sansPortee)) {
      sortie.push(
        avertissement(
          "REGLE_SANS_EFFET_REEL",
          r.code,
          `regles.${r.code}`,
          `Tous les effets de la règle « ${r.code} » sont sans portée par rapport à l'état de départ.`,
        ),
      );
    }
  }
  for (const b of e.briques) {
    if (!b.active_par_defaut && !activees.has(b.code)) {
      sortie.push(
        avertissement(
          "BRIQUE_INATTEIGNABLE",
          null,
          `briques.${b.code}`,
          `La brique « ${b.code} » est inactive par défaut et aucune règle active ne l'active : elle ne s'activera que par dérogation.`,
        ),
      );
    }
  }
  return sortie;
}

/** Analyse la cohérence interne d'une version de méthode. */
export function analyserCoherenceMethode(e: EntreeCoherence): AnomalieCoherence[] {
  const actives = e.regles.filter((r) => r.active !== false);
  const sortie: AnomalieCoherence[] = [
    ...referencesCassees(e),
    ...controlerRubriques(e),
    ...contradictoires(actives),
    ...portees(e, actives),
  ];
  for (const r of e.regles) {
    if (r.active === false) {
      sortie.push(
        avertissement(
          "REGLE_INACTIVE",
          r.code,
          `regles.${r.code}`,
          `La règle « ${r.code} » est inactive.`,
        ),
      );
    }
    if (insatisfaisable(r.condition)) {
      sortie.push(
        avertissement(
          "CONDITION_INSATISFAISABLE",
          r.code,
          `regles.${r.code}.condition`,
          `La condition de la règle « ${r.code} » ne peut jamais être vraie.`,
        ),
      );
    }
  }
  return trierAnomaliesCoherence(sortie);
}
