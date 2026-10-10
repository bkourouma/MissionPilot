import { ErreurCapitalisation } from "./erreurs";
import { sommeCentiemes } from "./temps";

/**
 * Matrice de compétences (CAP-06). Un niveau n'est JAMAIS attribué par le calcul : il vient
 * d'une déclaration (par la personne ou un responsable) validée par un humain habilité. Les
 * preuves d'usage (temps passé sur une brique, livrable rédigé ou relu) sont comptées et
 * datées ; elles signalent seulement les cases « à revoir » (usage sans niveau validé, ou
 * déclaration en attente).
 */

export const NIVEAUX_COMPETENCE = [1, 2, 3, 4] as const;
export type NiveauCompetence = (typeof NIVEAUX_COMPETENCE)[number];

export interface DeclarationCompetence {
  id: string;
  collaborateur_id: string;
  competence_id: string;
  niveau: number;
  cree_le: string;
}

export interface DecisionCompetence {
  declaration_id: string;
  decision: "validee" | "refusee";
}

export interface PreuveUsage {
  collaborateur_id: string;
  competence_id: string;
  /** Centièmes de jour passés (preuve issue des temps), sinon null. */
  centiemes: number | null;
  date: string;
}

export interface CelluleCompetence {
  competence_id: string;
  niveau_valide: NiveauCompetence | null;
  niveau_valide_le: string | null;
  /** Déclaration plus récente que le niveau validé, sans décision. */
  niveau_en_attente: NiveauCompetence | null;
  declaration_en_attente_id: string | null;
  preuves: number;
  centiemes: number;
  derniere_preuve: string | null;
  a_revoir: boolean;
}

export interface LigneMatrice {
  collaborateur_id: string;
  cellules: CelluleCompetence[];
}

export function estNiveauCompetence(n: number): n is NiveauCompetence {
  return (NIVEAUX_COMPETENCE as readonly number[]).includes(n);
}

const cle = (collaborateur: string, competence: string) => `${collaborateur}|${competence}`;

function grouper<T>(liste: readonly T[], f: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of liste) m.set(f(x), [...(m.get(f(x)) ?? []), x]);
  return m;
}

function niveaux(declarations: readonly DeclarationCompetence[], decisions: Map<string, string>) {
  const tries = [...declarations].sort(
    (a, b) => b.cree_le.localeCompare(a.cree_le) || b.id.localeCompare(a.id),
  );
  for (const d of tries) {
    if (!estNiveauCompetence(d.niveau)) {
      throw new ErreurCapitalisation("NIVEAU_INVALIDE", "Niveau de compétence hors de 1 à 4.");
    }
  }
  const valide = tries.find((d) => decisions.get(d.id) === "validee") ?? null;
  const attente =
    tries.find(
      (d) =>
        !decisions.has(d.id) && (valide === null || d.cree_le >= valide.cree_le) && d !== valide,
    ) ?? null;
  return { valide, attente };
}

function cellule(
  competenceId: string,
  declarations: readonly DeclarationCompetence[],
  decisions: Map<string, string>,
  preuves: readonly PreuveUsage[],
): CelluleCompetence {
  const { valide, attente } = niveaux(declarations, decisions);
  const dates = preuves.map((p) => p.date).sort();
  return {
    competence_id: competenceId,
    niveau_valide: valide ? (valide.niveau as NiveauCompetence) : null,
    niveau_valide_le: valide ? valide.cree_le : null,
    niveau_en_attente: attente ? (attente.niveau as NiveauCompetence) : null,
    declaration_en_attente_id: attente ? attente.id : null,
    preuves: preuves.length,
    centiemes: sommeCentiemes(preuves.map((p) => p.centiemes ?? 0)),
    derniere_preuve: dates.length > 0 ? (dates[dates.length - 1] as string) : null,
    a_revoir: attente !== null || (valide === null && preuves.length > 0),
  };
}

/** Une ligne par collaborateur, une cellule par compétence, dans l'ordre reçu. */
export function matriceCompetences(entree: {
  collaborateurs: readonly string[];
  competences: readonly string[];
  declarations: readonly DeclarationCompetence[];
  decisions: readonly DecisionCompetence[];
  preuves: readonly PreuveUsage[];
}): LigneMatrice[] {
  const decisions = new Map(entree.decisions.map((d) => [d.declaration_id, d.decision]));
  const decl = grouper(entree.declarations, (d) => cle(d.collaborateur_id, d.competence_id));
  const preuves = grouper(entree.preuves, (p) => cle(p.collaborateur_id, p.competence_id));
  return entree.collaborateurs.map((c) => ({
    collaborateur_id: c,
    cellules: entree.competences.map((k) =>
      cellule(k, decl.get(cle(c, k)) ?? [], decisions, preuves.get(cle(c, k)) ?? []),
    ),
  }));
}
