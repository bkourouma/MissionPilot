import PptxGenJS from "pptxgenjs";
import {
  LIBELLES_STATUT_RAPPORT,
  dateAffichee,
  type Bloc,
  type Rapport,
  type Section,
} from "./modele.js";

/*
 * Rendu PPTX (docs/DECISIONS.md, « Rapports » : bibliothèque `pptxgenjs`),
 * format 16:9. Une diapositive de titre, puis par section : le texte, les
 * indicateurs et chaque tableau (découpé par pages de lignes). Aucune image,
 * aucun lien, aucune ressource distante (pptxgenjs ne télécharge que des
 * images, jamais utilisées ici). La propriété « company » n'est pas
 * renseignée : pptxgenjs ne l'échappe pas.
 */

const LARGEUR = 10;
const COULEUR = "0B3D5C";
const GRIS = "52606D";
const LIGNES_PAR_DIAPO = 11;
const POLICE = "Arial";

type Diapo = ReturnType<PptxGenJS["addSlide"]>;
type Texte = PptxGenJS.TextProps;

function cadre(pptx: PptxGenJS, r: Rapport, titre: string): Diapo {
  const d = pptx.addSlide();
  d.addText(titre, {
    x: 0.4,
    y: 0.25,
    w: LARGEUR - 0.8,
    h: 0.6,
    fontSize: 22,
    bold: true,
    color: COULEUR,
    fontFace: POLICE,
  });
  const statut = r.statut === "valide" ? "Validé" : "Brouillon";
  const conf = r.confidentiel ? " — Confidentiel" : "";
  d.addText(`${r.emetteur} — ${statut}${conf} — ${dateAffichee(r.genere_le)}`, {
    x: 0.4,
    y: 5.2,
    w: 7.5,
    h: 0.3,
    fontSize: 9,
    color: GRIS,
    fontFace: POLICE,
  });
  d.slideNumber = { x: 9.1, y: 5.2, w: 0.6, h: 0.3, fontSize: 9, color: GRIS, fontFace: POLICE };
  if (r.mention_pied) {
    d.addText(r.mention_pied.replace(/\n/g, " "), {
      x: 0.4,
      y: 5.42,
      w: LARGEUR - 0.8,
      h: 0.2,
      fontSize: 7,
      color: GRIS,
      fontFace: POLICE,
    });
  }
  return d;
}

function texteDiapo(pptx: PptxGenJS, r: Rapport, s: Section, blocs: Bloc[]): void {
  const lignes = blocs.flatMap((b): Texte[] =>
    b.type === "paragraphe"
      ? [{ text: b.texte, options: { breakLine: true, paraSpaceAfter: 6 } }]
      : b.type === "liste"
        ? b.elements.map((e) => ({ text: e, options: { bullet: true, breakLine: true } }))
        : [],
  );
  if (lignes.length === 0) return;
  cadre(pptx, r, s.titre).addText(lignes, {
    x: 0.5,
    y: 1.0,
    w: LARGEUR - 1,
    h: 4.0,
    fontSize: 14,
    fontFace: POLICE,
    valign: "top",
    fit: "shrink",
  });
}

function indicateursDiapo(
  pptx: PptxGenJS,
  r: Rapport,
  s: Section,
  b: Bloc & { type: "indicateurs" },
) {
  const d = cadre(pptx, r, s.titre);
  const parLigne = 3;
  const l = (LARGEUR - 1 - 0.2 * (parLigne - 1)) / parLigne;
  b.elements.forEach((i, n) => {
    const x = 0.5 + (n % parLigne) * (l + 0.2);
    const y = 1.0 + ((n - (n % parLigne)) / parLigne) * 1.05;
    d.addText(
      [
        { text: i.libelle, options: { fontSize: 10, color: GRIS, breakLine: true } },
        { text: i.valeur, options: { fontSize: 18, bold: true, color: COULEUR, breakLine: true } },
        ...(i.detail ? [{ text: i.detail, options: { fontSize: 9, color: GRIS } }] : []),
      ],
      { x, y, w: l, h: 0.95, fontFace: POLICE, valign: "top", line: { color: "CBD2D9", width: 1 } },
    );
  });
}

function tableauDiapos(pptx: PptxGenJS, r: Rapport, s: Section, b: Bloc & { type: "tableau" }) {
  const align = (j: number): PptxGenJS.HAlign =>
    b.alignements?.[j] === "droite" ? "right" : "left";
  const entete = b.colonnes.map((c, j) => ({
    text: c,
    options: { bold: true, fill: { color: "E4EBF1" }, align: align(j) },
  }));
  // Au moins une diapositive (tableau vide : l'en-tête seul), puis une par page de lignes.
  for (let debut = 0; debut === 0 || debut < b.lignes.length; debut += LIGNES_PAR_DIAPO) {
    const lignes = b.lignes.slice(debut, debut + LIGNES_PAR_DIAPO);
    const titre = `${s.titre}${b.titre ? ` — ${b.titre}` : ""}${debut > 0 ? " (suite)" : ""}`;
    cadre(pptx, r, titre).addTable(
      [entete, ...lignes.map((l) => l.map((c, j) => ({ text: c, options: { align: align(j) } })))],
      {
        x: 0.4,
        y: 1.0,
        w: LARGEUR - 0.8,
        fontSize: 10,
        fontFace: POLICE,
        border: { type: "solid", pt: 0.5, color: "CBD2D9" },
      },
    );
  }
}

/** Rapport → PPTX (Office Open XML), en mémoire. */
export async function rapportEnPptx(r: Rapport): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";
  pptx.author = r.emetteur;
  pptx.title = r.titre;
  pptx.subject = "Rapport généré par MissionPilot";
  const titre = pptx.addSlide();
  titre.addText(r.titre, {
    x: 0.5,
    y: 1.4,
    w: LARGEUR - 1,
    h: 1.2,
    fontSize: 30,
    bold: true,
    color: COULEUR,
    fontFace: POLICE,
  });
  titre.addText(
    [
      ...(r.sous_titre ? [{ text: r.sous_titre, options: { breakLine: true } }] : []),
      { text: r.emetteur, options: { breakLine: true } },
      {
        text: LIBELLES_STATUT_RAPPORT[r.statut],
        options: { bold: true, color: "B44D12", breakLine: true },
      },
      ...(r.confidentiel
        ? [
            {
              text: "Confidentiel : document interne, réservé aux personnes autorisées.",
              options: { color: "8A1C1C" },
            },
          ]
        : []),
    ],
    {
      x: 0.5,
      y: 2.7,
      w: LARGEUR - 1,
      h: 1.8,
      fontSize: 14,
      color: GRIS,
      fontFace: POLICE,
      valign: "top",
    },
  );
  for (const s of r.sections) {
    texteDiapo(pptx, r, s, s.blocs);
    for (const b of s.blocs) {
      if (b.type === "indicateurs") indicateursDiapo(pptx, r, s, b);
      if (b.type === "tableau") tableauDiapos(pptx, r, s, b);
    }
  }
  const sortie = await pptx.write({ outputType: "nodebuffer" });
  return Buffer.isBuffer(sortie) ? sortie : Buffer.from(sortie as Uint8Array);
}
