/**
 * Différence simple entre deux versions d'un texte (historique des contenus IA, SOC-06).
 * Plus longue sous-suite commune sur les mots (espaces conservés), après retrait du début et
 * de la fin communs ; repli sur les lignes pour un long texte, `null` au-delà (comparaison trop
 * coûteuse pour le navigateur d'un téléphone). Logique pure, testée dans `ia-diff.test.ts`.
 */

export type NatureSegment = "egal" | "ajout" | "retrait";

export interface SegmentDiff {
  nature: NatureSegment;
  texte: string;
}

/** Taille maximale de la table de comparaison (cellules), soit 4 Mo. */
export const LIMITE_CELLULES_DIFF = 1_000_000;

/** « Le chiffre  progresse » → ["Le", " ", "chiffre", "  ", "progresse"]. */
export function decouperMots(texte: string): string[] {
  return texte.match(/\s+|\S+/g) ?? [];
}

/** Lignes, saut de ligne compris (la concaténation redonne le texte). */
export function decouperLignes(texte: string): string[] {
  return texte.match(/[^\n]*\n|[^\n]+/g) ?? [];
}

function ajouter(segments: SegmentDiff[], nature: NatureSegment, texte: string): void {
  if (texte === "") return;
  const dernier = segments[segments.length - 1];
  if (dernier && dernier.nature === nature) dernier.texte += texte;
  else segments.push({ nature, texte });
}

/** Plus longue sous-suite commune, table remplie depuis la fin (lecture dans l'ordre). */
function comparer(a: readonly string[], b: readonly string[], segments: SegmentDiff[]): void {
  const n = a.length;
  const m = b.length;
  const largeur = m + 1;
  const table = new Uint32Array((n + 1) * largeur);
  const cellule = (i: number, j: number) => table[i * largeur + j] ?? 0;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * largeur + j] =
        a[i] === b[j] ? cellule(i + 1, j + 1) + 1 : Math.max(cellule(i + 1, j), cellule(i, j + 1));
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ajouter(segments, "egal", a[i] ?? "");
      i++;
      j++;
    } else if (cellule(i + 1, j) >= cellule(i, j + 1)) {
      ajouter(segments, "retrait", a[i] ?? "");
      i++;
    } else {
      ajouter(segments, "ajout", b[j] ?? "");
      j++;
    }
  }
  for (; i < n; i++) ajouter(segments, "retrait", a[i] ?? "");
  for (; j < m; j++) ajouter(segments, "ajout", b[j] ?? "");
}

/** Différence entre deux suites de jetons ; `null` si la partie différente est trop grande. */
export function diffJetons(
  a: readonly string[],
  b: readonly string[],
  limite: number = LIMITE_CELLULES_DIFF,
): SegmentDiff[] | null {
  let debut = 0;
  while (debut < a.length && debut < b.length && a[debut] === b[debut]) debut++;
  let fin = 0;
  while (
    fin < a.length - debut &&
    fin < b.length - debut &&
    a[a.length - 1 - fin] === b[b.length - 1 - fin]
  ) {
    fin++;
  }
  const milieuA = a.slice(debut, a.length - fin);
  const milieuB = b.slice(debut, b.length - fin);
  if (milieuA.length * milieuB.length > limite) return null;
  const segments: SegmentDiff[] = [];
  ajouter(segments, "egal", a.slice(0, debut).join(""));
  comparer(milieuA, milieuB, segments);
  ajouter(segments, "egal", a.slice(a.length - fin).join(""));
  return segments;
}

/** Mots d'abord, lignes ensuite ; `null` si les deux textes sont trop différents et trop longs. */
export function diffTextes(
  avant: string,
  apres: string,
  limite: number = LIMITE_CELLULES_DIFF,
): SegmentDiff[] | null {
  if (avant === apres) return avant === "" ? [] : [{ nature: "egal", texte: avant }];
  return (
    diffJetons(decouperMots(avant), decouperMots(apres), limite) ??
    diffJetons(decouperLignes(avant), decouperLignes(apres), limite)
  );
}

const compterMots = (texte: string) => (texte.match(/\S+/g) ?? []).length;

/** Nombre de mots ajoutés et retirés (résumé annoncé avant le détail). */
export function resumeDiff(segments: readonly SegmentDiff[]): { ajouts: number; retraits: number } {
  let ajouts = 0;
  let retraits = 0;
  for (const s of segments) {
    if (s.nature === "ajout") ajouts += compterMots(s.texte);
    if (s.nature === "retrait") retraits += compterMots(s.texte);
  }
  return { ajouts, retraits };
}

const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? "s" : ""}`;

/** « 3 mots ajoutés, 1 mot retiré » ; « Texte identique » sans changement. */
export function libelleResumeDiff(segments: readonly SegmentDiff[]): string {
  const { ajouts, retraits } = resumeDiff(segments);
  const changementEspaces = segments.some((s) => s.nature !== "egal");
  if (ajouts === 0 && retraits === 0) {
    return changementEspaces
      ? "Seuls des espaces ou des retours à la ligne changent."
      : "Texte identique.";
  }
  const parties: string[] = [];
  if (ajouts > 0) parties.push(`${pluriel(ajouts, "mot")} ${ajouts > 1 ? "ajoutés" : "ajouté"}`);
  if (retraits > 0)
    parties.push(`${pluriel(retraits, "mot")} ${retraits > 1 ? "retirés" : "retiré"}`);
  return `${parties.join(", ")}.`;
}
