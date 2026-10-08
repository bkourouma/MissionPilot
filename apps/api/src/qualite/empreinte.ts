import { createHash } from "node:crypto";

/*
 * Empreinte SHA-256 d'une valeur JSON sous forme CANONIQUE (clés triées, aucun espace) : deux
 * valeurs égales donnent la même empreinte quel que soit l'ordre d'insertion des clés ; un
 * `undefined` est ignoré comme dans `JSON.stringify`. Sert à la signature d'un livrable (QUA-06).
 */

export function jsonCanonique(valeur: unknown): string {
  if (valeur === null || typeof valeur !== "object") return JSON.stringify(valeur) ?? "null";
  if (valeur instanceof Date) return JSON.stringify(valeur.toISOString());
  if (Array.isArray(valeur)) return `[${valeur.map((v) => jsonCanonique(v)).join(",")}]`;
  const objet = valeur as Record<string, unknown>;
  const morceaux = Object.keys(objet)
    .filter((k) => objet[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${jsonCanonique(objet[k])}`);
  return `{${morceaux.join(",")}}`;
}

export function empreinteJson(valeur: unknown): string {
  return createHash("sha256").update(jsonCanonique(valeur), "utf8").digest("hex");
}
