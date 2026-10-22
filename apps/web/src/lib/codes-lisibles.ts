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
