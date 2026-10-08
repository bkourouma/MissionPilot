/**
 * Validation d'un jeu de règles de modulation avant activation (STD-05) et
 * d'un contexte de mission (STD-04). Ne lève pas : renvoie TOUTES les
 * anomalies, chacune avec sa gravité, sa règle et son chemin.
 *
 * Erreurs (le jeu n'est pas activable) : forme, facteur inconnu, comparateur
 * incompatible avec le type du facteur, valeur hors des valeurs permises,
 * référence inconnue (brique, item, cible, choix, recommandation) quand le
 * référentiel fournit l'ensemble, conflit interne à une règle, cycle de
 * dépendances. Avertissements : deux règles de même priorité aux effets
 * contradictoires (conflit non résolu si elles se déclenchent ensemble),
 * règle sans effet.
 */
import { ordreEvaluation } from "./dependances";
import { cleEffet, comparerCodes, valeurEffet } from "./effets";
import {
  anomaliesStructureParRegle,
  erreur,
  estCodeModulation,
  estObjet,
  feuillesCondition,
} from "./structure";
import {
  TYPES_FACTEUR_CONTEXTE,
  VALEURS_LISTE_MAX,
  type AnomalieModulation,
  type ComparateurModulation,
  type ConditionModulation,
  type ContexteModulation,
  type DefinitionFacteurContexte,
  type EffetModulation,
  type ReferentielModulation,
  type RegleModulation,
  type TypeFacteurContexte,
  type ValeurComparee,
} from "./types";

export interface ValidationModulation {
  /** Aucune anomalie de gravité « erreur ». */
  readonly valide: boolean;
  readonly anomalies: readonly AnomalieModulation[];
}

const COMPARATEURS_PAR_TYPE: Readonly<
  Record<TypeFacteurContexte, readonly ComparateurModulation[]>
> = {
  booleen: ["egal", "different"],
  nombre: [
    "egal",
    "different",
    "inferieur",
    "inferieur_ou_egal",
    "superieur",
    "superieur_ou_egal",
    "dans",
  ],
  enumeration: ["egal", "different", "dans"],
  liste: ["dans", "contient"],
};

function resultat(anomalies: AnomalieModulation[]): ValidationModulation {
  return { valide: anomalies.every((a) => a.gravite !== "erreur"), anomalies };
}

function listeDeCodes(v: unknown): v is readonly string[] {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v.length <= VALEURS_LISTE_MAX &&
    v.every(estCodeModulation) &&
    new Set(v).size === v.length
  );
}

function definitionValide(d: unknown): string | null {
  if (!estObjet(d) || !estCodeModulation(d.code)) return "Code de facteur invalide.";
  if (!(TYPES_FACTEUR_CONTEXTE as readonly unknown[]).includes(d.type))
    return "Type de facteur inconnu.";
  const avecValeurs = d.type === "enumeration" || d.type === "liste";
  if (avecValeurs !== (d.valeurs !== undefined)) {
    return "Valeurs permises : obligatoires pour une énumération ou une liste, interdites sinon.";
  }
  if (avecValeurs && !listeDeCodes(d.valeurs)) return "Valeurs permises invalides ou en double.";
  const bornes = [d.min, d.max].filter((b) => b !== undefined);
  if (d.type !== "nombre" && bornes.length > 0) return "Bornes réservées aux facteurs numériques.";
  if (!bornes.every((b) => typeof b === "number" && Number.isFinite(b))) return "Bornes invalides.";
  if (typeof d.min === "number" && typeof d.max === "number" && d.min > d.max) {
    return "Borne minimale supérieure à la maximale.";
  }
  return null;
}

/** Contrôle les définitions de facteurs ; les définitions valides sont indexées par code. */
function definitions(facteurs: readonly DefinitionFacteurContexte[]): {
  anomalies: AnomalieModulation[];
  parCode: Map<string, DefinitionFacteurContexte>;
} {
  const anomalies: AnomalieModulation[] = [];
  const parCode = new Map<string, DefinitionFacteurContexte>();
  if (!Array.isArray(facteurs)) {
    anomalies.push(
      erreur("FACTEUR_DEFINITION_INVALIDE", null, "facteurs", "Liste de facteurs attendue."),
    );
    return { anomalies, parCode };
  }
  facteurs.forEach((d, i) => {
    const message =
      definitionValide(d) ?? (parCode.has(d.code) ? "Code de facteur en double." : null);
    if (message)
      anomalies.push(erreur("FACTEUR_DEFINITION_INVALIDE", null, `facteurs[${i}]`, message));
    else parCode.set(d.code, d);
  });
  return { anomalies, parCode };
}

/** Définitions de facteurs de contexte (STD-04). */
export function validerFacteursContexte(
  facteurs: readonly DefinitionFacteurContexte[],
): ValidationModulation {
  return resultat(definitions(facteurs).anomalies);
}

function valeurContexteValide(d: DefinitionFacteurContexte, v: unknown): boolean {
  switch (d.type) {
    case "booleen":
      return typeof v === "boolean";
    case "nombre":
      return (
        typeof v === "number" &&
        Number.isFinite(v) &&
        (d.min === undefined || v >= d.min) &&
        (d.max === undefined || v <= d.max)
      );
    case "enumeration":
      return typeof v === "string" && d.valeurs!.includes(v);
    case "liste":
      return (
        Array.isArray(v) &&
        v.length <= VALEURS_LISTE_MAX &&
        new Set(v).size === v.length &&
        v.every((x) => typeof x === "string" && d.valeurs!.includes(x))
      );
  }
}

/** Contexte d'une mission contre les définitions : facteurs inconnus, valeurs hors type ou hors bornes. */
export function validerContexteModulation(
  facteurs: readonly DefinitionFacteurContexte[],
  contexte: ContexteModulation,
): ValidationModulation {
  const { anomalies, parCode } = definitions(facteurs);
  if (!estObjet(contexte)) {
    anomalies.push(erreur("VALEUR_INVALIDE", null, "contexte", "Contexte attendu (objet)."));
    return resultat(anomalies);
  }
  for (const code of Object.keys(contexte).sort(comparerCodes)) {
    const valeur = contexte[code];
    const d = parCode.get(code);
    if (!d) {
      anomalies.push(
        erreur("FACTEUR_INCONNU", null, `contexte.${code}`, "Facteur de contexte inconnu."),
      );
    } else if (valeur !== null && valeur !== undefined && !valeurContexteValide(d, valeur)) {
      anomalies.push(
        erreur("VALEUR_INVALIDE", null, `contexte.${code}`, "Valeur incompatible avec le facteur."),
      );
    }
  }
  return resultat(anomalies);
}

/** Valeur comparée compatible avec la définition du facteur (forme déjà contrôlée). */
function valeurCompareeCompatible(
  d: DefinitionFacteurContexte,
  comparateur: ComparateurModulation,
  valeur: ValeurComparee,
): boolean {
  const permises = d.valeurs ?? [];
  const dansPermises = (v: unknown) => typeof v === "string" && permises.includes(v);
  switch (d.type) {
    case "booleen":
      return typeof valeur === "boolean";
    case "nombre":
      return comparateur === "dans"
        ? (valeur as readonly unknown[]).every((v) => typeof v === "number")
        : typeof valeur === "number";
    case "enumeration":
    case "liste":
      return Array.isArray(valeur) ? valeur.every(dansPermises) : dansPermises(valeur);
  }
}

function anomaliesCondition(
  condition: ConditionModulation,
  regle: string,
  chemin: string,
  facteurs: ReadonlyMap<string, DefinitionFacteurContexte>,
  briques: ReadonlySet<string> | null,
): AnomalieModulation[] {
  const anomalies: AnomalieModulation[] = [];
  feuillesCondition(condition, chemin, (f, c) => {
    if (f.type === "brique_active") {
      if (briques && !briques.has(f.brique)) {
        anomalies.push(
          erreur("REFERENCE_INCONNUE", regle, `${c}.brique`, `Brique inconnue : ${f.brique}.`),
        );
      }
      return;
    }
    const d = facteurs.get(f.facteur);
    if (!d) {
      anomalies.push(
        erreur("FACTEUR_INCONNU", regle, `${c}.facteur`, `Facteur inconnu : ${f.facteur}.`),
      );
    } else if (!COMPARATEURS_PAR_TYPE[d.type].includes(f.comparateur)) {
      anomalies.push(
        erreur(
          "COMPARATEUR_INCOMPATIBLE",
          regle,
          `${c}.comparateur`,
          `Comparateur « ${f.comparateur} » inapplicable à un facteur de type ${d.type}.`,
        ),
      );
    } else if (!valeurCompareeCompatible(d, f.comparateur, f.valeur)) {
      anomalies.push(
        erreur("VALEUR_INVALIDE", regle, `${c}.valeur`, "Valeur incompatible avec le facteur."),
      );
    }
  });
  return anomalies;
}

interface Ensembles {
  readonly briques: ReadonlySet<string> | null;
  readonly items: ReadonlySet<string> | null;
  readonly cibles: ReadonlySet<string> | null;
  readonly choix: ReadonlySet<string> | null;
  readonly recommandations: ReadonlySet<string> | null;
}

/** Références de l'effet absentes du référentiel : [champ, code]. */
function referencesInconnues(e: EffetModulation, ens: Ensembles): [string, string][] {
  const inconnue = (
    ensemble: ReadonlySet<string> | null,
    champ: string,
    code: string,
  ): [string, string][] => (ensemble && !ensemble.has(code) ? [[champ, code]] : []);
  switch (e.type) {
    case "activer_brique":
    case "retirer_brique":
      return inconnue(ens.briques, "brique", e.brique);
    case "activer_item":
    case "retirer_item":
      return inconnue(ens.items, "item", e.item);
    case "recommandation_candidate":
      return inconnue(ens.recommandations, "recommandation", e.recommandation);
    case "benchmark":
    case "gabarit":
    case "formulation":
      return [...inconnue(ens.cibles, "cible", e.cible), ...inconnue(ens.choix, "choix", e.choix)];
    default:
      return inconnue(ens.cibles, "cible", e.cible);
  }
}

/** Effets cumulables : jamais en conflit. */
function cumulable(e: EffetModulation): boolean {
  return e.type === "recommandation_candidate" || e.type === "relever_classe_risque";
}

function anomaliesEffets(
  regle: RegleModulation,
  chemin: string,
  ens: Ensembles,
): AnomalieModulation[] {
  const anomalies: AnomalieModulation[] = [];
  const valeurs = new Map<string, string>();
  regle.effets.forEach((e, i) => {
    for (const [champ, code] of referencesInconnues(e, ens)) {
      anomalies.push(
        erreur(
          "REFERENCE_INCONNUE",
          regle.code,
          `${chemin}.effets[${i}].${champ}`,
          `Référence inconnue : ${code}.`,
        ),
      );
    }
    if (cumulable(e)) return;
    const cle = cleEffet(e);
    const precedente = valeurs.get(cle);
    if (precedente !== undefined && precedente !== valeurEffet(e)) {
      anomalies.push(
        erreur(
          "CONFLIT_INTERNE",
          regle.code,
          `${chemin}.effets[${i}]`,
          `Effets contradictoires sur ${cle}.`,
        ),
      );
    }
    valeurs.set(cle, valeurEffet(e));
  });
  if (regle.effets.length === 0) {
    anomalies.push({
      code: "REGLE_SANS_EFFET",
      gravite: "avertissement",
      regle: regle.code,
      chemin: `${chemin}.effets`,
      message: "Règle sans effet.",
    });
  }
  return anomalies;
}

/** Règles distinctes de même priorité aux effets contradictoires sur une même clé. */
function conflitsMemePriorite(regles: readonly RegleModulation[]): AnomalieModulation[] {
  const groupes = new Map<string, Map<string, Set<string>>>();
  for (const r of regles) {
    for (const e of r.effets) {
      if (cumulable(e)) continue;
      const groupe = `${r.priorite}|${cleEffet(e)}`;
      const parValeur = groupes.get(groupe) ?? new Map<string, Set<string>>();
      parValeur.set(valeurEffet(e), (parValeur.get(valeurEffet(e)) ?? new Set()).add(r.code));
      groupes.set(groupe, parValeur);
    }
  }
  const anomalies: AnomalieModulation[] = [];
  for (const groupe of [...groupes.keys()].sort(comparerCodes)) {
    const parValeur = groupes.get(groupe)!;
    const codes = [...new Set([...parValeur.values()].flatMap((s) => [...s]))].sort(comparerCodes);
    if (parValeur.size < 2 || codes.length < 2) continue;
    const [priorite, ...cle] = groupe.split("|");
    anomalies.push({
      code: "CONFLIT_MEME_PRIORITE",
      gravite: "avertissement",
      regle: codes[0]!,
      chemin: "regles",
      message: `Règles ${codes.join(", ")} (priorité ${priorite}) : effets contradictoires sur ${cle.join("|")}.`,
    });
  }
  return anomalies;
}

function ensemble(codes: readonly string[] | undefined): ReadonlySet<string> | null {
  return codes === undefined ? null : new Set(codes);
}

/**
 * Valide un jeu de règles contre un référentiel : forme, facteurs, références,
 * conflits et cycles. Les règles inactives sont validées comme les autres.
 */
export function validerReglesModulation(
  regles: readonly RegleModulation[],
  referentiel: ReferentielModulation,
): ValidationModulation {
  const { globales, parRegle } = anomaliesStructureParRegle(regles);
  const facteurs = definitions(referentiel.facteurs);
  const anomalies: AnomalieModulation[] = [...globales, ...facteurs.anomalies];
  const ens: Ensembles = {
    briques: ensemble(referentiel.briques),
    items: ensemble(referentiel.items),
    cibles: ensemble(referentiel.cibles),
    choix: ensemble(referentiel.choix),
    recommandations: ensemble(referentiel.recommandations),
  };
  const saines: RegleModulation[] = [];
  parRegle.forEach((forme, i) => {
    anomalies.push(...forme);
    if (forme.length > 0) return;
    const regle = regles[i]!;
    saines.push(regle);
    const chemin = `regles[${i}]`;
    anomalies.push(
      ...anomaliesCondition(
        regle.condition,
        regle.code,
        `${chemin}.condition`,
        facteurs.parCode,
        ens.briques,
      ),
      ...anomaliesEffets(regle, chemin, ens),
    );
  });
  anomalies.push(...conflitsMemePriorite(saines));
  for (const cycle of ordreEvaluation(saines).cycles) {
    anomalies.push(
      erreur(
        "CYCLE",
        cycle[0]!,
        "regles",
        `Dépendance circulaire entre règles : ${cycle.join(" → ")}.`,
      ),
    );
  }
  return resultat(anomalies);
}
