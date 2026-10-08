import { LIBELLES_STATUT_RAPPORT, dateAffichee, type Bloc, type Rapport } from "./modele.js";

/*
 * Rendu HTML d'un rapport, destiné au seul moteur PDF (Chromium headless,
 * pdf.ts). Jamais servi tel quel à un navigateur.
 *
 * SÉCURITÉ : tout texte passe par `echapper` (& < > " ' et `/`), aucun
 * attribut ne reçoit de valeur issue des données, aucun script, aucune
 * ressource externe (styles en ligne, polices système). La politique de
 * sécurité du document interdit toute ressource (`default-src 'none'`) en
 * plus des barrières du rendu PDF (JavaScript désactivé, requêtes bloquées).
 */

const ECHAPPEMENTS: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
  "/": "&#47;",
  "`": "&#96;",
};

/** Texte brut → HTML inerte (contenu et valeur d'attribut). */
export function echapper(texte: string): string {
  return texte.replace(/[&<>"'/`]/g, (c) => ECHAPPEMENTS[c] as string);
}

/** Paragraphe : sauts de ligne conservés, sans balisage issu des données. */
const avecSauts = (texte: string) => echapper(texte).replace(/\n/g, "<br>");

export const CSP_RAPPORT =
  "default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; " +
  "script-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; " +
  "base-uri 'none'; form-action 'none'";

const STYLE = `
@page { size: A4; }
* { box-sizing: border-box; }
body { font-family: "Segoe UI", Arial, "Liberation Sans", Helvetica, sans-serif; font-size: 10.5pt;
  color: #1f2933; margin: 0; line-height: 1.45; }
h1 { font-size: 20pt; margin: 0 0 4pt; color: #0b3d5c; }
.sous-titre { font-size: 12pt; color: #52606d; margin: 0 0 6pt; }
.statut { display: inline-block; border: 1px solid #b44d12; color: #b44d12; padding: 2pt 6pt;
  font-size: 9pt; margin: 4pt 0 10pt; }
.statut.valide { border-color: #1b7f3b; color: #1b7f3b; }
.confidentiel { color: #8a1c1c; font-weight: 600; font-size: 9pt; margin: 0 0 10pt; }
h2 { font-size: 13.5pt; color: #0b3d5c; border-bottom: 1px solid #cbd2d9; padding-bottom: 2pt;
  margin: 16pt 0 6pt; page-break-after: avoid; }
h3 { font-size: 11pt; margin: 8pt 0 4pt; page-break-after: avoid; }
p { margin: 0 0 6pt; }
ul { margin: 0 0 6pt 14pt; padding: 0; }
table { width: 100%; border-collapse: collapse; margin: 0 0 8pt; font-size: 9.5pt; }
thead { display: table-header-group; }
tr { page-break-inside: avoid; }
th { background: #e4ebf1; text-align: left; font-weight: 600; }
th, td { border: 1px solid #cbd2d9; padding: 3pt 5pt; vertical-align: top; }
.droite { text-align: right; }
.indicateurs { display: flex; flex-wrap: wrap; gap: 6pt; margin: 0 0 8pt; }
.indicateur { border: 1px solid #cbd2d9; padding: 5pt 7pt; min-width: 30%; flex: 1 1 30%; }
.indicateur .libelle { font-size: 8.5pt; color: #52606d; }
.indicateur .valeur { font-size: 14pt; font-weight: 600; color: #0b3d5c; }
.indicateur .detail { font-size: 8pt; color: #52606d; }
`;

function blocHtml(bloc: Bloc): string {
  switch (bloc.type) {
    case "paragraphe":
      return `<p>${avecSauts(bloc.texte)}</p>`;
    case "liste":
      return `<ul>${bloc.elements.map((e) => `<li>${echapper(e)}</li>`).join("")}</ul>`;
    case "indicateurs":
      return `<div class="indicateurs">${bloc.elements
        .map(
          (i) =>
            `<div class="indicateur"><div class="libelle">${echapper(i.libelle)}</div>` +
            `<div class="valeur">${echapper(i.valeur)}</div>` +
            (i.detail ? `<div class="detail">${echapper(i.detail)}</div>` : "") +
            "</div>",
        )
        .join("")}</div>`;
    case "tableau": {
      const classe = (j: number) => (bloc.alignements?.[j] === "droite" ? ' class="droite"' : "");
      const tete = bloc.colonnes.map((c, j) => `<th${classe(j)}>${echapper(c)}</th>`).join("");
      const corps = bloc.lignes
        .map((l) => `<tr>${l.map((c, j) => `<td${classe(j)}>${echapper(c)}</td>`).join("")}</tr>`)
        .join("");
      const titre = bloc.titre ? `<h3>${echapper(bloc.titre)}</h3>` : "";
      return `${titre}<table><thead><tr>${tete}</tr></thead><tbody>${corps}</tbody></table>`;
    }
  }
}

/** Document HTML complet (corps du PDF), sans aucune ressource externe. */
export function rapportEnHtml(r: Rapport): string {
  const sections = r.sections
    .map((s) => `<section><h2>${echapper(s.titre)}</h2>${s.blocs.map(blocHtml).join("")}</section>`)
    .join("");
  return [
    "<!doctype html>",
    '<html lang="fr"><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${CSP_RAPPORT}">`,
    `<title>${echapper(r.titre)}</title><style>${STYLE}</style></head><body>`,
    `<h1>${echapper(r.titre)}</h1>`,
    r.sous_titre ? `<p class="sous-titre">${echapper(r.sous_titre)}</p>` : "",
    `<div class="statut${r.statut === "valide" ? " valide" : ""}">${echapper(LIBELLES_STATUT_RAPPORT[r.statut])}</div>`,
    r.confidentiel
      ? '<p class="confidentiel">Confidentiel : document interne, réservé aux personnes autorisées.</p>'
      : "",
    sections,
    "</body></html>",
  ].join("");
}

const PETIT = "font-family: Arial, sans-serif; font-size: 8pt; color: #52606d; width: 100%;";

/** En-tête de page : émetteur et titre (texte échappé ; gabarit rendu par Chromium). */
export function enTeteHtml(r: Rapport): string {
  return (
    `<div style="${PETIT} padding: 0 15mm; display: flex; justify-content: space-between;">` +
    `<span>${echapper(r.emetteur)}</span><span>${echapper(r.titre)}</span></div>`
  );
}

/** Pied de page : statut, date de génération, numéro de page, puis mention du cabinet. */
export function piedHtml(r: Rapport): string {
  const statut = r.statut === "valide" ? "Validé" : "Brouillon";
  const conf = r.confidentiel ? " — Confidentiel" : "";
  const mention = r.mention_pied
    ? `<div style="margin-top: 1mm;">${echapper(r.mention_pied.replace(/\n/g, " "))}</div>`
    : "";
  return (
    `<div style="${PETIT} padding: 0 15mm;">` +
    '<div style="display: flex; justify-content: space-between;">' +
    `<span>${echapper(`${statut}${conf} — généré le ${dateAffichee(r.genere_le)}`)}</span>` +
    '<span>Page <span class="pageNumber"></span> sur <span class="totalPages"></span></span></div>' +
    `${mention}</div>`
  );
}
