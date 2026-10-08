/**
 * Contrôles de FORME d'un jeu de règles de modulation, indépendants de tout
 * référentiel : codes, priorités, conditions (types, profondeur, valeurs
 * comparées), effets (types, cibles, valeurs). Partagés par l'application
 * (qui refuse au premier écart) et par la validation (qui les liste tous).
 */
import { estClasseRisque } from "../qualite/classes";
import {
  COMPARATEURS_MODULATION,
  EFFETS_PAR_REGLE_MAX,
  LONGUEUR_CODE_MAX,
  NOEUDS_CONDITION_MAX,
  PRIORITE_MODULATION_MAX,
  PROFONDEUR_CONDITION_MAX,
  REGLES_MODULATION_MAX,
  TYPES_EFFET_MODULATION,
  VALEURS_LISTE_MAX,
  type AnomalieModulation,
  type CodeAnomalieModulation,
  type ComparateurModulation,
  type ConditionModulation,
  type EffetModulation,
  type RegleModulation,
} from "./types";

/** Code non vide, sans blanc de bord, borné. */
export function estCodeModulation(valeur: unknown): valeur is string {
  return (
    typeof valeur === "string" &&
    valeur !== "" &&
    valeur.trim() === valeur &&
    valeur.length <= LONGUEUR_CODE_MAX
  );
}

export function estObjet(valeur: unknown): valeur is Record<string, unknown> {
  return typeof valeur === "object" && valeur !== null && !Array.isArray(valeur);
}

export function erreur(
  code: CodeAnomalieModulation,
  regle: string | null,
  chemin: string,
  message: string,
): AnomalieModulation {
  return { code, gravite: "erreur", regle, chemin, message };
}

const ORDONNES: readonly ComparateurModulation[] = [
  "inferieur",
  "inferieur_ou_egal",
  "superieur",
  "superieur_ou_egal",
];

function estScalaire(v: unknown): boolean {
  return (
    typeof v === "boolean" || typeof v === "string" || (typeof v === "number" && Number.isFinite(v))
  );
}

/** Liste homogène non vide de chaînes ou de nombres finis, bornée. */
function estListeComparee(v: unknown): boolean {
  if (!Array.isArray(v) || v.length === 0 || v.length > VALEURS_LISTE_MAX) return false;
  return (
    v.every((x) => typeof x === "string") ||
    v.every((x) => typeof x === "number" && Number.isFinite(x))
  );
}

/** Forme de la valeur attendue selon le comparateur (le type du facteur est vu à la validation). */
export function valeurCompareeValide(comparateur: ComparateurModulation, valeur: unknown): boolean {
  if (ORDONNES.includes(comparateur)) return typeof valeur === "number" && Number.isFinite(valeur);
  if (comparateur === "dans") return estListeComparee(valeur);
  if (comparateur === "contient") {
    return (
      typeof valeur === "string" ||
      (estListeComparee(valeur) && typeof (valeur as unknown[])[0] === "string")
    );
  }
  return estScalaire(valeur);
}

interface Parcours {
  readonly regle: string | null;
  readonly anomalies: AnomalieModulation[];
  noeuds: number;
  /** Condition déjà jugée trop complexe : on cesse de la parcourir. */
  trop: boolean;
}

function conditionStructure(
  condition: unknown,
  chemin: string,
  profondeur: number,
  p: Parcours,
): void {
  if (p.trop) return;
  p.noeuds += 1;
  if (profondeur > PROFONDEUR_CONDITION_MAX || p.noeuds > NOEUDS_CONDITION_MAX) {
    p.trop = true;
    p.anomalies.push(
      erreur(
        "CONDITION_TROP_COMPLEXE",
        p.regle,
        chemin,
        `Condition trop complexe : profondeur ${PROFONDEUR_CONDITION_MAX} et ${NOEUDS_CONDITION_MAX} éléments au plus.`,
      ),
    );
    return;
  }
  if (!estObjet(condition)) {
    p.anomalies.push(
      erreur("CONDITION_INVALIDE", p.regle, chemin, "Condition absente ou mal formée."),
    );
    return;
  }
  switch (condition.type) {
    case "tous":
    case "au_moins_un": {
      const sous = condition.conditions;
      if (!Array.isArray(sous) || sous.length === 0) {
        p.anomalies.push(
          erreur(
            "CONDITION_INVALIDE",
            p.regle,
            `${chemin}.conditions`,
            "Liste de conditions vide.",
          ),
        );
        return;
      }
      sous.forEach((c, i) =>
        conditionStructure(c, `${chemin}.conditions[${i}]`, profondeur + 1, p),
      );
      return;
    }
    case "non":
      conditionStructure(condition.condition, `${chemin}.condition`, profondeur + 1, p);
      return;
    case "comparaison":
      comparaisonStructure(condition, chemin, p);
      return;
    case "brique_active":
      if (!estCodeModulation(condition.brique)) {
        p.anomalies.push(
          erreur("CONDITION_INVALIDE", p.regle, `${chemin}.brique`, "Brique absente."),
        );
      }
      return;
    default:
      p.anomalies.push(
        erreur("CONDITION_INVALIDE", p.regle, `${chemin}.type`, "Type de condition inconnu."),
      );
  }
}

function comparaisonStructure(c: Record<string, unknown>, chemin: string, p: Parcours): void {
  if (!estCodeModulation(c.facteur)) {
    p.anomalies.push(erreur("CONDITION_INVALIDE", p.regle, `${chemin}.facteur`, "Facteur absent."));
  }
  const comparateur = c.comparateur;
  if (!(COMPARATEURS_MODULATION as readonly unknown[]).includes(comparateur)) {
    p.anomalies.push(
      erreur("CONDITION_INVALIDE", p.regle, `${chemin}.comparateur`, "Comparateur inconnu."),
    );
    return;
  }
  if (!valeurCompareeValide(comparateur as ComparateurModulation, c.valeur)) {
    p.anomalies.push(
      erreur(
        "VALEUR_INVALIDE",
        p.regle,
        `${chemin}.valeur`,
        "Valeur comparée incompatible avec le comparateur.",
      ),
    );
  }
}

/** Champs obligatoires de chaque type d'effet : codes, et contrôle de la valeur. */
function effetStructure(
  effet: unknown,
  chemin: string,
  regle: string | null,
): AnomalieModulation | null {
  const invalide = (message: string) => erreur("EFFET_INVALIDE", regle, chemin, message);
  if (!estObjet(effet) || !(TYPES_EFFET_MODULATION as readonly unknown[]).includes(effet.type)) {
    return invalide("Type d'effet inconnu.");
  }
  const e = effet as EffetModulation;
  switch (e.type) {
    case "activer_brique":
    case "retirer_brique":
      return estCodeModulation(e.brique) ? null : invalide("Brique absente.");
    case "activer_item":
    case "retirer_item":
      return estCodeModulation(e.item) ? null : invalide("Item absent.");
    case "ponderation":
    case "seuil": {
      if (!estCodeModulation(e.cible)) return invalide("Cible absente.");
      const ok = typeof e.valeur === "number" && Number.isFinite(e.valeur);
      if (!ok || (e.type === "ponderation" && e.valeur < 0)) {
        return invalide(
          e.type === "ponderation" ? "Pondération : nombre fini ≥ 0." : "Seuil : nombre fini.",
        );
      }
      return null;
    }
    case "benchmark":
    case "gabarit":
    case "formulation":
      return estCodeModulation(e.cible) && estCodeModulation(e.choix)
        ? null
        : invalide("Cible ou choix absent.");
    case "recommandation_candidate":
      return estCodeModulation(e.recommandation) ? null : invalide("Recommandation absente.");
    case "relever_classe_risque":
      return estCodeModulation(e.cible) && estClasseRisque(e.classe)
        ? null
        : invalide("Cible absente ou classe de risque inconnue.");
  }
}

function regleStructure(regle: unknown, chemin: string, codes: Set<string>): AnomalieModulation[] {
  if (!estObjet(regle)) return [erreur("REGLE_INVALIDE", null, chemin, "Règle mal formée.")];
  const r = regle as Partial<RegleModulation>;
  const code = estCodeModulation(r.code) ? r.code : null;
  const anomalies: AnomalieModulation[] = [];
  if (code === null)
    anomalies.push(erreur("CODE_INVALIDE", null, `${chemin}.code`, "Code de règle invalide."));
  else if (codes.has(code)) {
    anomalies.push(erreur("CODE_EN_DOUBLE", code, `${chemin}.code`, "Code de règle en double."));
  } else codes.add(code);
  if (!Number.isInteger(r.priorite) || r.priorite! < 0 || r.priorite! > PRIORITE_MODULATION_MAX) {
    anomalies.push(
      erreur(
        "PRIORITE_INVALIDE",
        code,
        `${chemin}.priorite`,
        `Priorité : entier de 0 à ${PRIORITE_MODULATION_MAX}.`,
      ),
    );
  }
  if (r.active !== undefined && typeof r.active !== "boolean") {
    anomalies.push(
      erreur("REGLE_INVALIDE", code, `${chemin}.active`, "Indicateur d'activité invalide."),
    );
  }
  if (r.libelle !== undefined && typeof r.libelle !== "string") {
    anomalies.push(erreur("REGLE_INVALIDE", code, `${chemin}.libelle`, "Libellé invalide."));
  }
  const parcours: Parcours = { regle: code, anomalies, noeuds: 0, trop: false };
  conditionStructure(r.condition, `${chemin}.condition`, 1, parcours);
  if (!Array.isArray(r.effets) || r.effets.length > EFFETS_PAR_REGLE_MAX) {
    anomalies.push(
      erreur(
        "EFFET_INVALIDE",
        code,
        `${chemin}.effets`,
        `Effets : liste de ${EFFETS_PAR_REGLE_MAX} au plus.`,
      ),
    );
  } else {
    r.effets.forEach((e, i) => {
      const a = effetStructure(e, `${chemin}.effets[${i}]`, code);
      if (a) anomalies.push(a);
    });
  }
  return anomalies;
}

/**
 * Anomalies de forme d'un jeu de règles : globales (liste, nombre de règles)
 * et par règle (même indice que la règle).
 */
export function anomaliesStructureParRegle(regles: readonly RegleModulation[]): {
  globales: AnomalieModulation[];
  parRegle: AnomalieModulation[][];
} {
  if (!Array.isArray(regles)) {
    return {
      globales: [erreur("REGLE_INVALIDE", null, "regles", "Liste de règles attendue.")],
      parRegle: [],
    };
  }
  if (regles.length > REGLES_MODULATION_MAX) {
    const message = `Au plus ${REGLES_MODULATION_MAX} règles par jeu.`;
    return { globales: [erreur("REGLES_TROP_NOMBREUSES", null, "regles", message)], parRegle: [] };
  }
  const codes = new Set<string>();
  return { globales: [], parRegle: regles.map((r, i) => regleStructure(r, `regles[${i}]`, codes)) };
}

/** Toutes les anomalies de forme d'un jeu de règles, dans l'ordre des règles. */
export function anomaliesStructure(regles: readonly RegleModulation[]): AnomalieModulation[] {
  const { globales, parRegle } = anomaliesStructureParRegle(regles);
  return [...globales, ...parRegle.flat()];
}

/** Parcourt toutes les feuilles d'une condition bien formée, dans l'ordre. */
export function feuillesCondition(
  condition: ConditionModulation,
  chemin: string,
  visiter: (
    feuille: Extract<ConditionModulation, { type: "comparaison" | "brique_active" }>,
    chemin: string,
  ) => void,
): void {
  switch (condition.type) {
    case "tous":
    case "au_moins_un":
      condition.conditions.forEach((c, i) =>
        feuillesCondition(c, `${chemin}.conditions[${i}]`, visiter),
      );
      return;
    case "non":
      feuillesCondition(condition.condition, `${chemin}.condition`, visiter);
      return;
    default:
      visiter(condition, chemin);
  }
}
