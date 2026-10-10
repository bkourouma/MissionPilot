import { analyserDateISO } from "../commun/dates";
import { ErreurAutomatisation } from "./erreurs";
import {
  NOEUDS_CONDITION_AUTOMATISATION_MAX,
  PROFONDEUR_CONDITION_AUTOMATISATION_MAX,
  VALEURS_LISTE_AUTOMATISATION_MAX,
  type ChampsEvenement,
  type ConditionAutomatisation,
  type OperateurAutomatisation,
  type PayloadEvenement,
  type TypeChampEvenement,
  type ValeurCompareeAutomatisation,
  type ValeurPayload,
} from "./types";

/*
 * Conditions TYPÉES sur le contenu d'un événement (AUT-02) : une condition ne cite que des
 * champs déclarés par le catalogue de l'événement, avec un opérateur compatible avec le type
 * du champ et une valeur de la bonne forme. L'évaluation est déterministe ; un champ absent
 * ou nul ne satisfait aucune comparaison (seul « renseigne » le teste).
 */

const ORDONNES: readonly OperateurAutomatisation[] = [
  "inferieur",
  "inferieur_ou_egal",
  "superieur",
  "superieur_ou_egal",
];

/** Opérateurs admis par type de champ. */
export const OPERATEURS_PAR_TYPE: Readonly<
  Record<TypeChampEvenement, readonly OperateurAutomatisation[]>
> = {
  nombre: ["egal", "different", ...ORDONNES, "dans"],
  date: ["egal", "different", ...ORDONNES],
  texte: ["egal", "different", "dans", "contient"],
  identifiant: ["egal", "different", "dans"],
  booleen: ["egal", "different"],
};

export type CodeErreurCondition =
  "TROP_COMPLEXE" | "CHAMP_INCONNU" | "OPERATEUR_INCOMPATIBLE" | "VALEUR_INCOMPATIBLE";

export interface ErreurCondition {
  /** Chemin dans la condition (« conditions.0.valeur »). */
  readonly chemin: string;
  readonly code: CodeErreurCondition;
  readonly message: string;
}

function scalaireAdmis(type: TypeChampEvenement, v: unknown): boolean {
  switch (type) {
    case "nombre":
      return typeof v === "number" && Number.isFinite(v);
    case "date":
      return typeof v === "string" && analyserDateISO(v).valide;
    case "booleen":
      return typeof v === "boolean";
    default:
      return typeof v === "string" && v.length > 0;
  }
}

/** Forme de la valeur comparée selon le type du champ et l'opérateur. */
export function valeurAdmise(
  type: TypeChampEvenement,
  operateur: OperateurAutomatisation,
  valeur: ValeurCompareeAutomatisation,
): boolean {
  if (operateur === "dans") {
    return (
      Array.isArray(valeur) &&
      valeur.length > 0 &&
      valeur.length <= VALEURS_LISTE_AUTOMATISATION_MAX &&
      (valeur as readonly unknown[]).every((v) => scalaireAdmis(type, v))
    );
  }
  return !Array.isArray(valeur) && scalaireAdmis(type, valeur);
}

interface Etat {
  noeuds: number;
  trop: boolean;
}

function chemin(base: string, suite: string | number): string {
  return base === "" ? String(suite) : `${base}.${suite}`;
}

function parcourir(
  c: ConditionAutomatisation,
  champs: ChampsEvenement,
  ou: string,
  profondeur: number,
  etat: Etat,
  erreurs: ErreurCondition[],
): void {
  if (etat.trop) return;
  etat.noeuds += 1;
  if (
    profondeur > PROFONDEUR_CONDITION_AUTOMATISATION_MAX ||
    etat.noeuds > NOEUDS_CONDITION_AUTOMATISATION_MAX
  ) {
    etat.trop = true;
    erreurs.push({
      chemin: ou,
      code: "TROP_COMPLEXE",
      message: `Condition trop complexe : profondeur ${PROFONDEUR_CONDITION_AUTOMATISATION_MAX} et ${NOEUDS_CONDITION_AUTOMATISATION_MAX} éléments au plus.`,
    });
    return;
  }
  if (c.type === "tous" || c.type === "au_moins_un") {
    c.conditions.forEach((s, i) =>
      parcourir(s, champs, chemin(chemin(ou, "conditions"), i), profondeur + 1, etat, erreurs),
    );
    return;
  }
  if (c.type === "non") {
    parcourir(c.condition, champs, chemin(ou, "condition"), profondeur + 1, etat, erreurs);
    return;
  }
  const champ = Object.prototype.hasOwnProperty.call(champs, c.champ) ? champs[c.champ] : undefined;
  if (!champ) {
    erreurs.push({
      chemin: chemin(ou, "champ"),
      code: "CHAMP_INCONNU",
      message: `Champ « ${c.champ} » inconnu pour cet événement.`,
    });
    return;
  }
  if (c.type === "renseigne") return;
  if (!OPERATEURS_PAR_TYPE[champ.type].includes(c.operateur)) {
    erreurs.push({
      chemin: chemin(ou, "operateur"),
      code: "OPERATEUR_INCOMPATIBLE",
      message: `Opérateur « ${c.operateur} » incompatible avec un champ de type ${champ.type}.`,
    });
    return;
  }
  if (!valeurAdmise(champ.type, c.operateur, c.valeur)) {
    erreurs.push({
      chemin: chemin(ou, "valeur"),
      code: "VALEUR_INCOMPATIBLE",
      message: `Valeur incompatible avec le champ « ${c.champ} » (${champ.type}).`,
    });
  }
}

/** Erreurs de la condition au regard des champs de l'événement (vide si elle est valide). */
export function validerConditionAutomatisation(
  condition: ConditionAutomatisation | null,
  champs: ChampsEvenement,
): ErreurCondition[] {
  const erreurs: ErreurCondition[] = [];
  if (condition !== null) parcourir(condition, champs, "", 1, { noeuds: 0, trop: false }, erreurs);
  return erreurs;
}

function comparer(
  v: ValeurPayload | undefined,
  operateur: OperateurAutomatisation,
  valeur: ValeurCompareeAutomatisation,
): boolean {
  if (v === undefined || v === null) return false;
  switch (operateur) {
    case "egal":
      return v === valeur;
    case "different":
      return v !== valeur;
    case "dans":
      return Array.isArray(valeur) && (valeur as readonly unknown[]).includes(v);
    case "contient":
      return (
        typeof v === "string" &&
        typeof valeur === "string" &&
        v.toLowerCase().includes(valeur.toLowerCase())
      );
    default: {
      if (typeof v !== typeof valeur || (typeof v !== "number" && typeof v !== "string")) {
        return false;
      }
      const a = v as number | string;
      const b = valeur as number | string;
      if (operateur === "inferieur") return a < b;
      if (operateur === "inferieur_ou_egal") return a <= b;
      if (operateur === "superieur") return a > b;
      return a >= b;
    }
  }
}

function evaluer(
  c: ConditionAutomatisation,
  payload: PayloadEvenement,
  profondeur: number,
): boolean {
  if (profondeur > PROFONDEUR_CONDITION_AUTOMATISATION_MAX) {
    throw new ErreurAutomatisation("CONDITION_INVALIDE", "Condition trop imbriquée.");
  }
  const valeurDe = (champ: string) =>
    Object.prototype.hasOwnProperty.call(payload, champ) ? payload[champ] : undefined;
  switch (c.type) {
    case "tous":
      return c.conditions.every((s): boolean => evaluer(s, payload, profondeur + 1));
    case "au_moins_un":
      return c.conditions.some((s): boolean => evaluer(s, payload, profondeur + 1));
    case "non":
      return !evaluer(c.condition, payload, profondeur + 1);
    case "renseigne": {
      const v = valeurDe(c.champ);
      return v !== undefined && v !== null && v !== "";
    }
    case "comparaison":
      return comparer(valeurDe(c.champ), c.operateur, c.valeur);
    default:
      throw new ErreurAutomatisation("CONDITION_INVALIDE", "Type de condition inconnu.");
  }
}

/** Vrai si le contenu satisfait la condition (`null` : toujours vrai). */
export function evaluerConditionAutomatisation(
  condition: ConditionAutomatisation | null,
  payload: PayloadEvenement,
): boolean {
  if (condition === null) return true;
  return evaluer(condition, payload, 1);
}
