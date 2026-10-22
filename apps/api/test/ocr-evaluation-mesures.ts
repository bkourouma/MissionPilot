import type { LigneVeriteOcr } from "./ocr-outils.js";

/*
 * Mesure de l'exactitude d'un texte reconnu par rapport à la vérité terrain du manifeste des scans de
 * test (`fixtures/ocr/MANIFESTE.json`). Partagé par le script d'évaluation (`ocr-evaluation.ts`) et les
 * tests du moteur (`ocr-moteur.test.ts`) : les seuils des tests viennent des mesures de ce script.
 *
 * - MONTANT EXACT : une ligne du texte porte le montant écrit EXACTEMENT comme sur le document
 *   (« 1 200 000 » en français, « 1,200,000 » en anglais) et le code du poste ou au moins 60 % des mots
 *   de son libellé : le montant est retrouvé au bon endroit, même si le libellé est un peu abîmé ;
 * - LIGNE EXACTE : la ligne porte le libellé EXACT puis, après au moins un espace, le montant exact (ce
 *   que la chaîne aval « libellé [espaces] montant » sait lire telle quelle).
 */

export function formaterMontant(montant: number, langue: "fra" | "eng"): string {
  const chiffres = String(Math.trunc(Math.abs(montant)));
  const groupes: string[] = [];
  for (let fin = chiffres.length; fin > 0; fin -= 3) {
    groupes.unshift(chiffres.slice(Math.max(0, fin - 3), fin));
  }
  return (montant < 0 ? "-" : "") + groupes.join(langue === "fra" ? " " : ",");
}

const echapper = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function mots(s: string): string[] {
  return s
    .normalize("NFC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((m) => m.length > 1);
}

export interface MesureTexte {
  total: number;
  montantsExacts: number;
  lignesExactes: number;
  /** Postes dont le montant n'a pas été retrouvé exactement (code ou libellé). */
  manques: string[];
}

export function mesurerTexte(
  texte: string,
  lignes: readonly LigneVeriteOcr[],
  langue: "fra" | "eng",
): MesureTexte {
  const lignesTexte = texte.normalize("NFC").replaceAll(String.fromCharCode(0xa0), " ").split("\n");
  let montantsExacts = 0;
  let lignesExactes = 0;
  const manques: string[] = [];
  for (const l of lignes) {
    const montant = new RegExp(
      `(^|[^\\d,.])${echapper(formaterMontant(l.montant, langue))}($|[^\\d,.])`,
    );
    const motsLibelle = mots(l.libelle);
    const trouve = lignesTexte.some((t) => {
      if (!montant.test(t)) return false;
      if (l.code && new RegExp(`(^|\\s)${echapper(l.code)}(\\s|$)`).test(t)) return true;
      const presents = new Set(mots(t));
      const communs = motsLibelle.filter((m) => presents.has(m)).length;
      return motsLibelle.length > 0 && communs / motsLibelle.length >= 0.6;
    });
    if (trouve) montantsExacts += 1;
    else manques.push(l.code ?? l.libelle);
    const exacte = new RegExp(
      `${echapper(l.libelle.normalize("NFC"))}\\s+${echapper(formaterMontant(l.montant, langue))}($|[^\\d,.])`,
    );
    if (lignesTexte.some((t) => exacte.test(t))) lignesExactes += 1;
  }
  return { total: lignes.length, montantsExacts, lignesExactes, manques };
}
