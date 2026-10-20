/**
 * Synthèse hebdomadaire du dirigeant (CLI-07, lot 3c, SPEC §9.5). Fonction pure : les faits sont
 * des COMPTEURS déjà lus (sous le contexte du portail du dirigeant) ; le moteur n'en déduit que
 * deux nombres et les lignes d'affichage. Aucun montant, aucun coût, aucune marge (FIN-02) : le
 * message sortant ne porte que `compteMessage(…)` et un lien vers `/portail/synthese`.
 */
import { COMPTE_MESSAGE_MAX } from "./gabarits";
import { ErreurCanaux } from "./erreurs";

/** Chaque compteur d'entrée est un entier de 0 à 99 999. */
export const SYNTHESE_COMPTEUR_MAX = 99_999;

export interface FaitsSynthese {
  readonly kpiRouges: number;
  readonly kpiOranges: number;
  readonly jalonsAValider: number;
  readonly questionnairesACompleter: number;
  readonly piecesAttendues: number;
  readonly documentsASigner: number;
}

export type CodeSectionSynthese =
  | "kpi_rouges"
  | "kpi_oranges"
  | "jalons_a_valider"
  | "questionnaires_a_completer"
  | "pieces_attendues"
  | "documents_a_signer";

export interface SectionSynthese {
  readonly code: CodeSectionSynthese;
  readonly groupe: "point_attention" | "decision";
  readonly libelle: string;
  readonly nombre: number;
  /** Lien relatif du portail. */
  readonly lien: string;
}

export interface SyntheseDirigeant {
  /** `kpiRouges + kpiOranges`. */
  readonly pointsAttention: number;
  /** `jalonsAValider + questionnairesACompleter + piecesAttendues + documentsASigner`. */
  readonly decisionsAttendues: number;
  /** Rien à signaler : aucun message n'est envoyé. */
  readonly vide: boolean;
  /** Lignes d'affichage du portail, dans l'ordre, seulement celles dont le nombre est positif. */
  readonly sections: readonly SectionSynthese[];
}

function entier(valeur: number): number {
  if (!Number.isInteger(valeur) || valeur < 0 || valeur > SYNTHESE_COMPTEUR_MAX) {
    throw new ErreurCanaux("ENTREE_INVALIDE");
  }
  return valeur;
}

const pluriel = (n: number, singulier: string, plurielTexte: string) =>
  n === 1 ? singulier : plurielTexte;

/** Nombre affiché dans un message : `min(n, 999)`. */
export function compteMessage(n: number): number {
  if (!Number.isInteger(n) || n < 0) throw new ErreurCanaux("ENTREE_INVALIDE");
  return Math.min(n, COMPTE_MESSAGE_MAX);
}

export function composerSyntheseDirigeant(faits: FaitsSynthese): SyntheseDirigeant {
  const f = {
    kpiRouges: entier(faits.kpiRouges),
    kpiOranges: entier(faits.kpiOranges),
    jalonsAValider: entier(faits.jalonsAValider),
    questionnairesACompleter: entier(faits.questionnairesACompleter),
    piecesAttendues: entier(faits.piecesAttendues),
    documentsASigner: entier(faits.documentsASigner),
  };
  const pointsAttention = f.kpiRouges + f.kpiOranges;
  const decisionsAttendues =
    f.jalonsAValider + f.questionnairesACompleter + f.piecesAttendues + f.documentsASigner;

  const toutes: readonly SectionSynthese[] = [
    {
      code: "kpi_rouges",
      groupe: "point_attention",
      libelle: pluriel(f.kpiRouges, "Indicateur en rouge", "Indicateurs en rouge"),
      nombre: f.kpiRouges,
      lien: "/portail/kpi",
    },
    {
      code: "kpi_oranges",
      groupe: "point_attention",
      libelle: pluriel(f.kpiOranges, "Indicateur en orange", "Indicateurs en orange"),
      nombre: f.kpiOranges,
      lien: "/portail/kpi",
    },
    {
      code: "jalons_a_valider",
      groupe: "decision",
      libelle: pluriel(f.jalonsAValider, "Jalon à valider", "Jalons à valider"),
      nombre: f.jalonsAValider,
      lien: "/portail/missions",
    },
    {
      code: "questionnaires_a_completer",
      groupe: "decision",
      libelle: pluriel(
        f.questionnairesACompleter,
        "Questionnaire à compléter",
        "Questionnaires à compléter",
      ),
      nombre: f.questionnairesACompleter,
      lien: "/portail/questionnaires",
    },
    {
      code: "pieces_attendues",
      groupe: "decision",
      libelle: pluriel(f.piecesAttendues, "Pièce attendue", "Pièces attendues"),
      nombre: f.piecesAttendues,
      lien: "/portail/salle",
    },
    {
      code: "documents_a_signer",
      groupe: "decision",
      libelle: pluriel(f.documentsASigner, "Document à signer", "Documents à signer"),
      nombre: f.documentsASigner,
      lien: "/portail/signatures",
    },
  ];

  return {
    pointsAttention,
    decisionsAttendues,
    vide: pointsAttention === 0 && decisionsAttendues === 0,
    sections: toutes.filter((s) => s.nombre > 0),
  };
}
