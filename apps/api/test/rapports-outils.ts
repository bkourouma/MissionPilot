import { inflateRawSync } from "node:zlib";
import type { Rapport } from "../src/rapports/modele.js";

/** Contenu des entrées d'une archive ZIP (stockée ou « deflate »), lu par le répertoire central. */
export function dezipper(archive: Buffer): Map<string, Buffer> {
  let fin = -1;
  for (let i = archive.length - 22; i >= 0; i--) {
    if (archive.readUInt32LE(i) === 0x06054b50) {
      fin = i;
      break;
    }
  }
  if (fin < 0) throw new Error("Archive ZIP illisible");
  const nombre = archive.readUInt16LE(fin + 10);
  let p = archive.readUInt32LE(fin + 16);
  const entrees = new Map<string, Buffer>();
  for (let n = 0; n < nombre; n++) {
    if (archive.readUInt32LE(p) !== 0x02014b50) throw new Error("Répertoire central invalide");
    const methode = archive.readUInt16LE(p + 10);
    const taille = archive.readUInt32LE(p + 20);
    const lNom = archive.readUInt16LE(p + 28);
    const lExtra = archive.readUInt16LE(p + 30);
    const lCommentaire = archive.readUInt16LE(p + 32);
    const local = archive.readUInt32LE(p + 42);
    const nom = archive.subarray(p + 46, p + 46 + lNom).toString("utf8");
    const debut = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
    const brut = archive.subarray(debut, debut + taille);
    entrees.set(nom, methode === 0 ? Buffer.from(brut) : inflateRawSync(brut));
    p += 46 + lNom + lExtra + lCommentaire;
  }
  return entrees;
}

/** Texte XML d'une entrée, ou erreur si elle manque. */
export function xml(entrees: Map<string, Buffer>, nom: string): string {
  const e = entrees.get(nom);
  if (!e) throw new Error(`Entrée absente : ${nom}`);
  return e.toString("utf8");
}

/** Texte de toutes les entrées XML (diapositives, document, en-têtes…). */
export function toutLeXml(entrees: Map<string, Buffer>): string {
  return [...entrees]
    .filter(([nom]) => nom.endsWith(".xml") || nom.endsWith(".rels"))
    .map(([, c]) => c.toString("utf8"))
    .join("\n");
}

/** Contrôle minimal de bonne formation : chaque balise ouverte est fermée, dans l'ordre. */
export function xmlBienForme(texte: string): boolean {
  const corps = texte.replace(/<\?xml[^>]*\?>/g, "").replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
  const pile: string[] = [];
  const re = /<(\/?)([A-Za-z_][\w:.-]*)([^>]*?)(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(corps))) {
    const [, fermante, nom, , auto] = m;
    if (auto) continue;
    if (fermante) {
      if (pile.pop() !== nom) return false;
    } else pile.push(nom as string);
  }
  // Aucun « < » isolé hors balise.
  return pile.length === 0 && !/<(?![A-Za-z_/?!])/.test(corps);
}

export const INJECTION = `<script>alert("x")</script><img src=x onerror=alert(1)>&amp; ' " </w:t></a:t>`;

/** Rapport d'exemple couvrant tous les blocs. */
export function rapportExemple(surcharge: Partial<Rapport> = {}): Rapport {
  return {
    titre: "État d'avancement de mission",
    sous_titre: "Plan stratégique — Client exemple",
    emetteur: "Cabinet exemple",
    statut: "brouillon",
    genere_le: "2026-10-06",
    confidentiel: false,
    sections: [
      {
        titre: "Synthèse",
        blocs: [
          {
            type: "indicateurs",
            elements: [
              { libelle: "Budget", valeur: "120 j" },
              { libelle: "Réalisé", valeur: "45,5 j", detail: "temps validés" },
            ],
          },
          { type: "paragraphe", texte: "Première ligne\nSeconde ligne" },
          { type: "liste", elements: ["Point un", "Point deux"] },
        ],
      },
      {
        titre: "Budget en jours par phase",
        blocs: [
          {
            type: "tableau",
            titre: "Phases",
            colonnes: ["Phase", "Budget"],
            alignements: ["gauche", "droite"],
            lignes: Array.from({ length: 25 }, (_, i) => [`Phase ${i + 1}`, `${i + 1} j`]),
          },
        ],
      },
    ],
    ...surcharge,
  };
}
