/**
 * Codes techniques (identifiants de référentiel écrits avec des soulignés) rendus lisibles pour
 * l'utilisateur. Un libellé connu (table code -> libellé) est toujours préféré ; sans lui, repli
 * lisible : soulignés remplacés par des espaces. Ne plante jamais. Testé dans `codes-lisibles.test.ts`.
 */

/** Repli lisible d'un identifiant : « kpi_pertes_post_recolte » -> « Kpi pertes post recolte ». */
export function libelleLisible(code: unknown): string {
  if (code === null || code === undefined) return "";
  const texte = (typeof code === "string" ? code : String(code)).replace(/[_\s]+/g, " ").trim();
  return texte === "" ? "" : texte.charAt(0).toUpperCase() + texte.slice(1);
}

/** Libellé d'un code : table fournie, sinon repli lisible. */
export function libelleDeCode(
  code: string,
  table: Readonly<Record<string, string>> | ReadonlyMap<string, string> = {},
): string {
  const connu = table instanceof Map ? table.get(code) : (table as Record<string, string>)[code];
  return typeof connu === "string" && connu !== "" ? connu : libelleLisible(code);
}

const CODE_DANS_TEXTE = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g;

/**
 * Remplace, dans un message produit par un moteur, chaque code technique (au moins un souligné)
 * par son libellé (table) ou, à défaut, par une forme lisible en minuscules.
 */
export function remplacerCodesTechniques(
  message: string,
  table: Readonly<Record<string, string>> | ReadonlyMap<string, string> = {},
): string {
  return message.replace(CODE_DANS_TEXTE, (code) => {
    const connu = table instanceof Map ? table.get(code) : (table as Record<string, string>)[code];
    return typeof connu === "string" && connu !== "" ? connu : libelleLisible(code).toLowerCase();
  });
}

/**
 * Code de ligne généré à la lecture d'un document financier quand la ligne n'a pas de code source :
 * `L<page ou feuille>_<rang>` (cf. `codeGenere` de `packages/engines/src/ingestion/etat-regles.ts`).
 */
const CODE_LIGNE_GENERE = /^L(\d+)_(\d+)$/;

/** Le code est un code de ligne généré (« L1_13 ») et non un code de poste du document. */
export function estCodeLigneGenere(code: unknown): boolean {
  return typeof code === "string" && CODE_LIGNE_GENERE.test(code.trim());
}

/**
 * Libellé lisible d'un poste d'état financier lu : « L1_13 » -> « Poste sans code source (page 1,
 * ligne 13) ». Le rang n'indique pas la nature de la ligne (total, sous-total…) : aucune nature
 * n'est affirmée. Un autre code (« TA1 », « CA ») est un code du document : rendu tel quel ; vide ->
 * « Poste sans code ».
 */
export function libellePosteEtat(code: unknown): string {
  if (typeof code !== "string" || code.trim() === "") return "Poste sans code";
  const m = CODE_LIGNE_GENERE.exec(code.trim());
  return m ? `Poste sans code source (page ${m[1]}, ligne ${m[2]})` : code.trim();
}

/**
 * Remplace, dans un texte, chaque code de ligne généré (« L1_17 ») par son libellé lisible.
 * « Résultat du compte de résultat (L1_17) » -> « Résultat du compte de résultat (Poste sans code
 * source (page 1, ligne 17)) ».
 */
export function remplacerCodesLignes(texte: string): string {
  return texte.replace(/\bL(\d+)_(\d+)\b/g, (code) => libellePosteEtat(code));
}

/**
 * Cible d'un contrôle d'état financier, lisible : « L1_17 » -> « page 1, ligne 17 » ; un autre code
 * (« TA1 ») est rendu tel quel.
 */
export function libelleCibleControle(cible: string): string {
  const m = CODE_LIGNE_GENERE.exec(cible.trim());
  return m ? `page ${m[1]}, ligne ${m[2]}` : cible.trim();
}
