/**
 * Valeur courante d'une clé datée (faits du dossier DOS-02, facteurs de
 * contexte STD-04) : pour chaque clé, la valeur dont la date d'effet est la
 * plus récente SANS dépasser la date de référence ; à date d'effet égale, la
 * plus récemment enregistrée (`rang` le plus grand) l'emporte. Une valeur à
 * date d'effet future est ignorée jusqu'à cette date. Résultat trié par clé
 * (unités UTF-16) : mêmes entrées, même sortie.
 */
import { analyserDateISO, type DateISO } from "../commun/dates";
import { ErreurDossier } from "./erreurs";

export interface ValeurDatee {
  readonly cle: string;
  readonly dateEffet: DateISO;
  /** Ordre d'enregistrement (croissant) : départage deux dates d'effet égales. */
  readonly rang: number;
}

function exigerDate(date: DateISO): void {
  if (!analyserDateISO(date).valide) {
    throw new ErreurDossier("DATE_INVALIDE", `Date invalide : « ${String(date).slice(0, 20)} ».`);
  }
}

/** Valeur courante de chaque clé à `aLaDate`, triée par clé. */
export function valeursCourantesDatees<T extends ValeurDatee>(
  valeurs: readonly T[],
  aLaDate: DateISO,
): T[] {
  exigerDate(aLaDate);
  const retenues = new Map<string, T>();
  for (const v of valeurs) {
    exigerDate(v.dateEffet);
    if (!Number.isFinite(v.rang)) {
      throw new ErreurDossier("OPTIONS_INVALIDES", "Rang d'enregistrement invalide.");
    }
    if (v.dateEffet > aLaDate) continue;
    const actuelle = retenues.get(v.cle);
    if (
      !actuelle ||
      v.dateEffet > actuelle.dateEffet ||
      (v.dateEffet === actuelle.dateEffet && v.rang > actuelle.rang)
    ) {
      retenues.set(v.cle, v);
    }
  }
  return [...retenues.values()].sort((a, b) => (a.cle < b.cle ? -1 : a.cle > b.cle ? 1 : 0));
}

/**
 * Contexte de modulation (forme de `contexteModulationSchema`, STD-04) à partir des valeurs
 * datées des facteurs d'un client : code → valeur courante.
 */
export function contexteDepuisFacteurs<V>(
  valeurs: readonly (ValeurDatee & { readonly valeur: V })[],
  aLaDate: DateISO,
): Record<string, V> {
  // `Object.fromEntries` crée des propriétés propres : une clé « __proto__ » reste une donnée.
  return Object.fromEntries(valeursCourantesDatees(valeurs, aLaDate).map((v) => [v.cle, v.valeur]));
}
