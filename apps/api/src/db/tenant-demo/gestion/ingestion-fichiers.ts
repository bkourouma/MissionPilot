import ExcelJS from "exceljs";
import { lignesEtat } from "../donnees-dossiers.js";
import type { Alea } from "../horloge.js";
import { deviseDuClient } from "../missions/devises.js";
import { valeurEnXof } from "./outils.js";
import type { EtatDoc } from "./donnees-ingestion.js";

/*
 * Fabrique des fichiers fictifs de l'ingestion : classeur .xlsx (liasse en lignes libres : code,
 * libellé, montant de l'exercice, montant de l'exercice précédent) et PDF à couche texte (une
 * page = une liste de lignes). Aucun contenu actif, aucun fichier sur disque, aucun réseau.
 *
 * Les montants de la liasse sont ceux de `lignesEtat` (donnees-dossiers.ts) : bilan et compte de
 * résultat ÉQUILIBRÉS par construction, comme les états du socle. Les variantes « écart » ne
 * touchent QUE le total du passif, pour que les contrôles du moteur échouent et que l'état parte
 * en revue ; elles ne recalculent rien.
 */

export const TYPE_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const SECTIONS = ["actif", "passif", "charges", "produits", "resultat"] as const;
const millier = (x: number): number => Math.round(x / 1000) * 1000;

/** Écart ajouté au total du passif selon la variante (en unités de la devise). */
const ECART: Record<EtatDoc["variante"], number> = {
  equilibre: 0,
  ecart_leger: 1_000,
  ecart_grave: 38_000_000,
};

type Cellule = string | number | null;

/** Lignes (cellules) de la liasse d'un état : sections en titres, puis code, libellé, N, N-1. */
export function lignesLiasse(e: EtatDoc, alea: Alea): Cellule[][] {
  // Les produits et charges du casting sont en valeur de référence FCFA : ramenés à l'échelle de la
  // devise du client (EUR, USD), les montants du tableur restent du même ordre qu'en FCFA.
  const k = valeurEnXof(deviseDuClient(e.client));
  const lignes = lignesEtat(
    {
      cle: e.client,
      exercice: e.exercice,
      produits: Math.round(e.produits / k),
      charges: Math.round(e.charges / k),
    },
    alea,
  );
  const ecart = ECART[e.variante] === 0 ? 0 : Math.max(1, Math.round(ECART[e.variante] / k));
  const rangs: Cellule[][] = [
    [`LIASSE ${e.client.toUpperCase()} - EXERCICE ${e.exercice}`, null, null, null],
  ];
  for (const section of SECTIONS) {
    rangs.push([section.toUpperCase(), null, null, null]);
    for (const l of lignes.filter((x) => x.section === section)) {
      const montant = l.code === "TP" ? l.montant + ecart : l.montant;
      rangs.push([l.code, l.libelle, montant, millier(l.montant * 0.91)]);
    }
  }
  return rangs;
}

/** Classeur .xlsx d'une seule feuille ; une ligne = un tableau de cellules (null : cellule vide). */
export async function fabriquerXlsx(lignes: readonly Cellule[][]): Promise<Buffer> {
  const classeur = new ExcelJS.Workbook();
  const feuille = classeur.addWorksheet("Liasse");
  for (const l of lignes) feuille.addRow([...l]);
  return Buffer.from((await classeur.xlsx.writeBuffer()) as ArrayBuffer);
}

/** Échappe une chaîne PDF (« \ », « ( » et « ) ») et la ramène à latin1 (hors latin1 : « ? »). */
function echapper(texte: string): string {
  const latin1 = Array.from(texte, (c) => ((c.codePointAt(0) as number) <= 0xff ? c : "?")).join(
    "",
  );
  return latin1.split("\\").join("\\\\").split("(").join("\\(").split(")").join("\\)");
}

/**
 * PDF à couche texte (Helvetica, WinAnsi), une page par tableau de lignes. Objets Catalog, Pages,
 * Font puis Page et Contents de chaque page ; table xref exacte, aucun flux compressé.
 */
export function fabriquerPdf(pages: readonly (readonly string[])[]): Buffer {
  const objets: string[] = [];
  const kids = pages.map((_, i) => `${4 + 2 * i} 0 R`).join(" ");
  objets.push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  objets.push(`2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>\nendobj\n`);
  objets.push(
    "3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n",
  );
  pages.forEach((lignes, i) => {
    const flux =
      lignes.length === 0
        ? ""
        : `BT /F1 10 Tf 40 760 Td 14 TL\n${lignes.map((l) => `(${echapper(l)}) Tj T*`).join("\n")}\nET`;
    objets.push(
      `${4 + 2 * i} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${5 + 2 * i} 0 R /Resources << /Font << /F1 3 0 R >> >> >>\nendobj\n`,
    );
    objets.push(
      `${5 + 2 * i} 0 obj\n<< /Length ${flux.length} >>\nstream\n${flux}\nendstream\nendobj\n`,
    );
  });
  let corps = "%PDF-1.4\n";
  const decalages: number[] = [];
  for (const o of objets) {
    decalages.push(corps.length);
    corps += o;
  }
  const debutXref = corps.length;
  const total = objets.length + 1;
  corps += `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (const d of decalages) corps += `${String(d).padStart(10, "0")} 00000 n \n`;
  corps += `trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${debutXref}\n%%EOF\n`;
  return Buffer.from(corps, "latin1");
}
