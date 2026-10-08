import { z } from "zod";

/*
 * Modèle de contenu d'un rapport (SOC-07), indépendant du format de sortie.
 *
 * Règles :
 * - Toutes les valeurs sont des TEXTES déjà mis en forme : un rendu (PDF,
 *   DOCX, PPTX) ne calcule rien. Les chiffres viennent des modules métier,
 *   eux-mêmes adossés à @missionpilot/engines, et sont formatés par les
 *   formateurs du moteur (`formaterJours`, `formaterMontant`).
 * - Le contenu est du texte BRUT : jamais interprété comme HTML ni comme
 *   balisage Office. Chaque rendu échappe tout texte (html.ts `echapper`) ;
 *   `normaliserRapport` retire en plus les caractères de contrôle (invalides
 *   en XML) et les caractères de mise en forme bidirectionnelle.
 * - Taille bornée (plafonds ci-dessous) : un rapport démesuré est refusé
 *   avant tout rendu.
 * - Statut affiché sur chaque page : « brouillon » (généré, à relire) ou
 *   « validé » (relu par un consultant) — « l'IA propose, l'expert dispose »
 *   vaut aussi pour un document généré.
 */

export const STATUTS_RAPPORT = ["brouillon", "valide"] as const;
export type StatutRapport = (typeof STATUTS_RAPPORT)[number];

export const LIBELLES_STATUT_RAPPORT: Record<StatutRapport, string> = {
  brouillon: "Brouillon — document généré automatiquement, à relire avant diffusion",
  valide: "Validé",
};

export const PLAFONDS_MODELE = {
  sections: 40,
  blocsParSection: 40,
  lignesParTableau: 300,
  colonnesParTableau: 10,
  indicateursParBloc: 12,
  elementsParListe: 100,
  longueurTexte: 4000,
  longueurCellule: 300,
  longueurTitre: 200,
  longueurMention: 300,
} as const;

const P = PLAFONDS_MODELE;
const texte = (max: number) => z.string().max(max);
const titre = z.string().min(1).max(P.longueurTitre);

const paragrapheSchema = z
  .object({ type: z.literal("paragraphe"), texte: texte(P.longueurTexte) })
  .strict();

const listeSchema = z
  .object({
    type: z.literal("liste"),
    elements: z.array(texte(P.longueurCellule)).max(P.elementsParListe),
  })
  .strict();

const indicateursSchema = z
  .object({
    type: z.literal("indicateurs"),
    elements: z
      .array(
        z
          .object({
            libelle: texte(P.longueurCellule),
            valeur: texte(P.longueurCellule),
            detail: texte(P.longueurCellule).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(P.indicateursParBloc),
  })
  .strict();

const tableauSchema = z
  .object({
    type: z.literal("tableau"),
    titre: titre.optional(),
    colonnes: z.array(texte(P.longueurCellule)).min(1).max(P.colonnesParTableau),
    /** Alignement par colonne : chiffres à droite. */
    alignements: z
      .array(z.enum(["gauche", "droite"]))
      .max(P.colonnesParTableau)
      .optional(),
    lignes: z
      .array(z.array(texte(P.longueurCellule)).max(P.colonnesParTableau))
      .max(P.lignesParTableau),
  })
  .strict()
  .refine((t) => t.lignes.every((l) => l.length === t.colonnes.length), {
    message: "Chaque ligne a autant de cellules que de colonnes.",
  })
  .refine((t) => !t.alignements || t.alignements.length === t.colonnes.length, {
    message: "Un alignement par colonne.",
  });

const blocSchema = z.union([paragrapheSchema, listeSchema, indicateursSchema, tableauSchema]);

const sectionSchema = z
  .object({ titre, blocs: z.array(blocSchema).max(P.blocsParSection) })
  .strict();

export const rapportSchema = z
  .object({
    titre,
    sous_titre: texte(P.longueurTitre).optional(),
    /** Émetteur affiché dans l'en-tête (nom du cabinet). */
    emetteur: titre,
    statut: z.enum(STATUTS_RAPPORT),
    /** Date de génération, AAAA-MM-JJ. */
    genere_le: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    /** Mention confidentielle (données financières internes FIN-02, dossier de revue KPI). */
    confidentiel: z.boolean(),
    /**
     * Mention de pied de page choisie par le cabinet (contribution de l'IA,
     * PRD complémentaire 21.2 ; rapports/parametres.ts). Absente : aucune.
     */
    mention_pied: texte(P.longueurMention).optional(),
    sections: z.array(sectionSchema).min(1).max(P.sections),
  })
  .strict();

export type Rapport = z.infer<typeof rapportSchema>;
export type Section = z.infer<typeof sectionSchema>;
export type Bloc = z.infer<typeof blocSchema>;
export type Tableau = z.infer<typeof tableauSchema>;

// Contrôles C0/C1 (sauf tabulation et saut de ligne), séparateurs Unicode de
// ligne/paragraphe, mise en forme bidirectionnelle, zéro-largeur, BOM et
// non-caractères : invalides en XML ou trompeurs à l'affichage.
const PLAGES_INTERDITES: readonly [number, number][] = [
  [0x00, 0x08],
  [0x0b, 0x0c],
  [0x0e, 0x1f],
  [0x7f, 0x9f],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff],
  [0xfffe, 0xffff],
];
const hex4 = (n: number) => n.toString(16).padStart(4, "0");
const INTERDITS = new RegExp(
  `[${PLAGES_INTERDITES.map(([a, b]) => `\\u${hex4(a)}-\\u${hex4(b)}`).join("")}]`,
  "g",
);

/** Texte sûr pour tous les rendus : NFC, sans caractère interdit, sauts de ligne normalisés. */
export function nettoyerTexte(brut: string): string {
  return brut.normalize("NFC").replace(/\r\n?/g, "\n").replace(INTERDITS, "");
}

function nettoyerProfond<T>(valeur: T): T {
  if (typeof valeur === "string") return nettoyerTexte(valeur) as T;
  if (Array.isArray(valeur)) return valeur.map(nettoyerProfond) as T;
  if (valeur !== null && typeof valeur === "object") {
    return Object.fromEntries(
      Object.entries(valeur).map(([cle, v]) => [cle, nettoyerProfond(v)]),
    ) as T;
  }
  return valeur;
}

/** Rapport validé (plafonds, structure) et nettoyé ; lève une ZodError sinon. */
export function normaliserRapport(brut: unknown): Rapport {
  return rapportSchema.parse(nettoyerProfond(brut));
}

/** Date AAAA-MM-JJ affichée JJ/MM/AAAA (CODING_STANDARDS §6). */
export function dateAffichee(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
}
