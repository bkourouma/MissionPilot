import {
  AlignmentType,
  Document,
  Footer,
  Header,
  HeadingLevel,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type FileChild,
} from "docx";
import { LIBELLES_STATUT_RAPPORT, dateAffichee, type Bloc, type Rapport } from "./modele.js";

/*
 * Rendu DOCX (docs/DECISIONS.md, « Rapports » : bibliothèque `docx`).
 * Le texte est passé en `TextRun` : la bibliothèque échappe le XML ; les
 * caractères invalides en XML sont retirés en amont (modele.ts). Aucun
 * champ actif autre que les numéros de page, aucune macro, aucune image ni
 * ressource liée. Page A4, en-tête (émetteur, titre) et pied (statut, page).
 */

const A4 = { width: 11_906, height: 16_838 };
const MARGE = 1_000;

/** Lignes d'un texte : un saut de ligne Word par « \n ». */
function runs(texte: string, options: { bold?: boolean; size?: number; color?: string } = {}) {
  return texte
    .split("\n")
    .map((ligne, i) => new TextRun({ text: ligne, break: i > 0 ? 1 : undefined, ...options }));
}

const cellule = (texte: string, options: { entete?: boolean; droite?: boolean } = {}) =>
  new TableCell({
    children: [
      new Paragraph({
        alignment: options.droite ? AlignmentType.RIGHT : AlignmentType.LEFT,
        children: runs(texte, { bold: options.entete, size: 18 }),
      }),
    ],
    shading: options.entete
      ? { type: ShadingType.CLEAR, fill: "E4EBF1", color: "auto" }
      : undefined,
  });

function tableau(colonnes: string[], lignes: string[][], droite: (j: number) => boolean): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        tableHeader: true,
        children: colonnes.map((c, j) => cellule(c, { entete: true, droite: droite(j) })),
      }),
      ...lignes.map(
        (l) => new TableRow({ children: l.map((c, j) => cellule(c, { droite: droite(j) })) }),
      ),
    ],
  });
}

function blocDocx(bloc: Bloc): FileChild[] {
  switch (bloc.type) {
    case "paragraphe":
      return [new Paragraph({ children: runs(bloc.texte), spacing: { after: 120 } })];
    case "liste":
      return bloc.elements.map((e) => new Paragraph({ children: runs(e), bullet: { level: 0 } }));
    case "indicateurs":
      return [
        tableau(
          ["Indicateur", "Valeur"],
          bloc.elements.map((i) => [i.libelle, i.detail ? `${i.valeur}\n${i.detail}` : i.valeur]),
          (j) => j === 1,
        ),
        new Paragraph({ children: [] }),
      ];
    case "tableau":
      return [
        ...(bloc.titre
          ? [new Paragraph({ heading: HeadingLevel.HEADING_3, children: runs(bloc.titre) })]
          : []),
        tableau(bloc.colonnes, bloc.lignes, (j) => bloc.alignements?.[j] === "droite"),
        new Paragraph({ children: [] }),
      ];
  }
}

function corps(r: Rapport): FileChild[] {
  return [
    new Paragraph({ heading: HeadingLevel.TITLE, children: runs(r.titre) }),
    ...(r.sous_titre ? [new Paragraph({ children: runs(r.sous_titre, { size: 24 }) })] : []),
    new Paragraph({
      children: runs(LIBELLES_STATUT_RAPPORT[r.statut], { bold: true, color: "B44D12" }),
      spacing: { after: 120 },
    }),
    ...(r.confidentiel
      ? [
          new Paragraph({
            children: runs(
              "Confidentiel : contient des données financières internes (coûts, taux, marges).",
              { bold: true, color: "8A1C1C" },
            ),
          }),
        ]
      : []),
    ...r.sections.flatMap((s) => [
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: runs(s.titre) }),
      ...s.blocs.flatMap(blocDocx),
    ]),
  ];
}

/** Rapport → DOCX (Office Open XML), en mémoire. */
export async function rapportEnDocx(r: Rapport): Promise<Buffer> {
  const statut = r.statut === "valide" ? "Validé" : "Brouillon";
  const conf = r.confidentiel ? " — Confidentiel" : "";
  const doc = new Document({
    creator: r.emetteur,
    title: r.titre,
    description: "Rapport généré par MissionPilot",
    sections: [
      {
        properties: {
          page: {
            size: A4,
            margin: { top: MARGE, bottom: MARGE, left: MARGE, right: MARGE },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({ children: runs(`${r.emetteur} — ${r.titre}`, { size: 16 }) }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    size: 16,
                    children: [
                      `${statut}${conf} — généré le ${dateAffichee(r.genere_le)} — Page `,
                      PageNumber.CURRENT,
                      " sur ",
                      PageNumber.TOTAL_PAGES,
                    ],
                  }),
                ],
              }),
            ],
          }),
        },
        children: corps(r),
      },
    ],
  });
  return Packer.toBuffer(doc);
}
