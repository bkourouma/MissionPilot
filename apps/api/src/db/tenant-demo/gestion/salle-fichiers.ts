import type { ContexteTenantDemo, SessionDemo } from "../contexte.js";
import { pdfDemo } from "../../seed-demo-portail.js";

/*
 * Fichiers déposés dans la salle de mission : de minuscules PDF fictifs (une page de texte, sans
 * contenu actif) et le corps multipart/form-data d'un fichier (champ « fichier »), avec une
 * frontière FIXE : la même pièce donne les mêmes octets (reprise et rejeu identiques).
 */

const FRONTIERE = "----mptenantdemosalle0001";

/** Nom de fichier ASCII d'une pièce (sans accent ni séparateur), borné. */
export function nomFichierPiece(libelle: string, version: number): string {
  const base = libelle
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || "piece"}-v${version}.pdf`;
}

/** PDF de démonstration d'une pièce : le texte change avec la version (le rejeu identique est refusé). */
export function pdfPiece(
  titre: string,
  mission: string,
  version: number,
  deposant: string,
): Buffer {
  return pdfDemo(titre, [
    `Document fictif de demonstration (version ${version}).`,
    `Mission : ${mission}.`,
    `Depose par : ${deposant}.`,
    "Aucune donnee reelle : jeu de donnees du cabinet Tenant demo.",
  ]);
}

/** Corps multipart d'un fichier (champ « fichier »), type MIME donné. */
export function corpsMultipart(nom: string, contenu: Buffer, type = "application/pdf") {
  const entete =
    `--${FRONTIERE}\r\nContent-Disposition: form-data; name="fichier"; filename="${nom}"\r\n` +
    `Content-Type: ${type}\r\n\r\n`;
  return {
    payload: Buffer.concat([
      Buffer.from(entete, "utf8"),
      contenu,
      Buffer.from(`\r\n--${FRONTIERE}--\r\n`, "utf8"),
    ]),
    headers: { "content-type": `multipart/form-data; boundary=${FRONTIERE}` },
  };
}

/** Dépose un fichier PDF sur une pièce par la route du PORTAIL avec la session du client. */
export async function deposerParPortail(
  ctx: ContexteTenantDemo,
  s: SessionDemo,
  pieceId: string,
  nom: string,
  contenu: Buffer,
) {
  const m = corpsMultipart(nom, contenu);
  return ctx.app.inject({
    method: "POST",
    url: `/api/portail/salle/pieces/${pieceId}/depots`,
    headers: { cookie: s.cookie, ...m.headers },
    payload: m.payload,
  });
}
