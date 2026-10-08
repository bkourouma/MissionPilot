import type { ContenuMethode } from "./types.js";

/*
 * Différences entre deux contenus de méthode (STD-03 : « les différences
 * restent visibles ») et fusion à trois voies d'une variante avec une
 * nouvelle version du standard (mise à jour proposée au cabinet). Fonctions
 * pures, déterministes : les éléments se comparent par CODE, les champs un à
 * un, les objets JSON (règles, cas types, ancrages) sous forme canonique
 * (clés triées). Aucun calcul de chiffre.
 */

export const COLLECTIONS = [
  "etapes",
  "briques",
  "elements",
  "rubriques",
  "regles",
  "cas_types",
] as const;
export type Collection = (typeof COLLECTIONS)[number];

type Ligne = { code: string } & Record<string, unknown>;

/** JSON canonique : clés d'objet triées, à toute profondeur. */
export function jsonCanonique(valeur: unknown): string {
  if (Array.isArray(valeur)) return `[${valeur.map(jsonCanonique).join(",")}]`;
  if (valeur !== null && typeof valeur === "object") {
    const cles = Object.keys(valeur as object)
      .filter((k) => (valeur as Record<string, unknown>)[k] !== undefined)
      .sort();
    return `{${cles
      .map((k) => `${JSON.stringify(k)}:${jsonCanonique((valeur as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(valeur ?? null);
}

function egales(a: Ligne | undefined, b: Ligne | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return jsonCanonique(a) === jsonCanonique(b);
}

function parCode(lignes: readonly Ligne[]): Map<string, Ligne> {
  return new Map(lignes.map((l) => [l.code, l]));
}

function trier(codes: Iterable<string>): string[] {
  return [...new Set(codes)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export interface DifferenceCollection {
  ajoutes: string[];
  retires: string[];
  modifies: { code: string; champs: string[] }[];
}

export type DifferencesContenu = { identique: boolean } & Record<Collection, DifferenceCollection>;

function champsModifies(a: Ligne, b: Ligne): string[] {
  return trier([...Object.keys(a), ...Object.keys(b)]).filter(
    (k) => jsonCanonique(a[k]) !== jsonCanonique(b[k]),
  );
}

function comparerCollection(
  avant: readonly Ligne[],
  apres: readonly Ligne[],
): DifferenceCollection {
  const a = parCode(avant);
  const b = parCode(apres);
  const d: DifferenceCollection = { ajoutes: [], retires: [], modifies: [] };
  for (const code of trier([...a.keys(), ...b.keys()])) {
    const x = a.get(code);
    const y = b.get(code);
    if (!x) d.ajoutes.push(code);
    else if (!y) d.retires.push(code);
    else if (!egales(x, y)) d.modifies.push({ code, champs: champsModifies(x, y) });
  }
  return d;
}

/** Différences de `avant` à `apres`, collection par collection. */
export function comparerContenus(avant: ContenuMethode, apres: ContenuMethode): DifferencesContenu {
  const resultat = Object.fromEntries(
    COLLECTIONS.map((c) => [
      c,
      comparerCollection(avant[c] as unknown as Ligne[], apres[c] as unknown as Ligne[]),
    ]),
  ) as Record<Collection, DifferenceCollection>;
  const identique = COLLECTIONS.every(
    (c) =>
      resultat[c].ajoutes.length + resultat[c].retires.length + resultat[c].modifies.length === 0,
  );
  return { identique, ...resultat };
}

export interface ConflitFusion {
  collection: Collection;
  code: string;
}

export interface ResultatFusion {
  contenu: ContenuMethode;
  /** Éléments modifiés à la fois par le cabinet et par le standard : la variante l'emporte. */
  conflits: ConflitFusion[];
  /** Éléments repris de la nouvelle version du standard. */
  repris: ConflitFusion[];
}

function fusionnerCollection(
  collection: Collection,
  base: readonly Ligne[],
  variante: readonly Ligne[],
  standard: readonly Ligne[],
  conflits: ConflitFusion[],
  repris: ConflitFusion[],
): Ligne[] {
  const b = parCode(base);
  const v = parCode(variante);
  const n = parCode(standard);
  const resultat: Ligne[] = [];
  for (const code of trier([...b.keys(), ...v.keys(), ...n.keys()])) {
    const changeCabinet = !egales(b.get(code), v.get(code));
    const changeStandard = !egales(b.get(code), n.get(code));
    let retenu: Ligne | undefined;
    if (changeCabinet) {
      retenu = v.get(code);
      if (changeStandard && !egales(v.get(code), n.get(code))) conflits.push({ collection, code });
    } else {
      retenu = n.get(code);
      if (changeStandard) repris.push({ collection, code });
    }
    if (retenu) resultat.push(retenu);
  }
  return resultat;
}

/**
 * Fusion à trois voies : `base` (version du standard dont part la variante),
 * `variante` (dernière version publiée du cabinet), `standard` (nouvelle
 * version du standard). Un élément que le cabinet a ajouté, modifié ou
 * retiré garde le choix du cabinet ; sinon la nouvelle version du standard
 * s'applique. Une brique dont l'étape a disparu garde l'étape de la variante
 * (ou de la base) ; un élément ou une rubrique dont la brique a disparu perd
 * son rattachement.
 */
export function fusionnerVariante(
  base: ContenuMethode,
  variante: ContenuMethode,
  standard: ContenuMethode,
): ResultatFusion {
  const conflits: ConflitFusion[] = [];
  const repris: ConflitFusion[] = [];
  const f = (c: Collection) =>
    fusionnerCollection(
      c,
      base[c] as unknown as Ligne[],
      variante[c] as unknown as Ligne[],
      standard[c] as unknown as Ligne[],
      conflits,
      repris,
    );
  const contenu = Object.fromEntries(
    COLLECTIONS.map((c) => [c, f(c)]),
  ) as unknown as ContenuMethode;

  const etapes = new Map(contenu.etapes.map((e) => [e.code, e]));
  for (const brique of contenu.briques) {
    if (etapes.has(brique.etape_code)) continue;
    const etape = [...variante.etapes, ...base.etapes, ...standard.etapes].find(
      (e) => e.code === brique.etape_code,
    );
    if (etape) {
      etapes.set(etape.code, etape);
      contenu.etapes.push(etape);
    }
  }
  const briques = new Set(contenu.briques.map((b) => b.code));
  contenu.elements = contenu.elements.map((e) =>
    e.brique_code && !briques.has(e.brique_code) ? { ...e, brique_code: null } : e,
  );
  contenu.rubriques = contenu.rubriques.map((r) =>
    r.brique_code && !briques.has(r.brique_code) ? { ...r, brique_code: null } : r,
  );
  return { contenu, conflits, repris };
}
