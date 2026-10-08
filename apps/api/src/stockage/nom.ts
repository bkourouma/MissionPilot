/*
 * Noms de fichiers fournis par le client : jamais utilisés comme chemin (la
 * clé de stockage est générée par le serveur), mais conservés pour
 * l'affichage et le téléchargement. Ils sont donc assainis : sans chemin ni
 * remontée, sans caractère de contrôle ni de mise en forme bidirectionnelle,
 * sans caractère réservé, longueur bornée.
 */

const LONGUEUR_MAX = 150;

// eslint-disable-next-line no-control-regex
const CONTROLES = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;
const RESERVES = /[<>:"/\\|?*]/g;

/** Nom d'affichage sûr (« fichier » à défaut). */
export function assainirNom(brut: string): string {
  const base = brut.split(/[/\\]/).pop() ?? "";
  let nom = base
    .normalize("NFC")
    .replace(CONTROLES, "")
    .replace(RESERVES, "_")
    .replace(/\s+/g, " ")
    .replace(/^[\s.]+|[\s.]+$/g, "");
  if (nom === "") nom = "fichier";
  if (nom.length > LONGUEUR_MAX) {
    const point = nom.lastIndexOf(".");
    const ext = point > 0 && nom.length - point <= 10 ? nom.slice(point) : "";
    nom = nom.slice(0, LONGUEUR_MAX - ext.length).replace(/[\s.]+$/, "") + ext;
  }
  return nom;
}

/** Extension en minuscules (sans le point), ou chaîne vide. */
export function extensionDe(nom: string): string {
  const point = nom.lastIndexOf(".");
  return point > 0 ? nom.slice(point + 1).toLowerCase() : "";
}

/** Nom final : l'extension retenue est ajoutée si le nom n'en avait pas. */
export function nomAvecExtension(nom: string, extension: string): string {
  return extensionDe(nom) === "" ? `${nom}.${extension}` : nom;
}

/**
 * En-tête Content-Disposition (RFC 6266) : repli ASCII entre guillemets, sans
 * guillemet ni barre oblique inverse, et forme UTF-8 encodée (RFC 5987).
 */
export function contentDisposition(nom: string, mode: "inline" | "attachment"): string {
  const replis =
    nom
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9._ -]/g, "_")
      .slice(0, LONGUEUR_MAX) || "fichier";
  const encode = encodeURIComponent(nom).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${mode}; filename="${replis}"; filename*=UTF-8''${encode}`;
}
