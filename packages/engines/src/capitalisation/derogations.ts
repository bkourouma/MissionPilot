import { ErreurCapitalisation } from "./erreurs";

/**
 * Analyse des dérogations (CAP-05) : regroupement par méthode, brique et nature, puis par
 * motif (similarité de Jaccard des mots significatifs, sans accents, regroupement glouton dans
 * l'ordre chronologique : déterministe). Un groupe atteint le seuil quand il touche au moins
 * `seuilMissions` missions distinctes : il devient candidat à une proposition d'évolution du
 * standard soumise au comité méthode (jamais appliquée d'office).
 *
 * Confidentialité : un motif `null` (dérogation d'une mission que le lecteur ne voit pas) est
 * COMPTÉ mais n'entre ni dans les mots-clés ni dans les regroupements de motifs.
 */

export interface DerogationObservee {
  id: string;
  mission_id: string;
  methode_id: string | null;
  methode_code: string | null;
  brique_code: string;
  nature: string;
  statut: "demandee" | "approuvee" | "refusee";
  /** null : motif non visible du lecteur. */
  motif: string | null;
  cree_le: string;
}

export interface MotCle {
  mot: string;
  occurrences: number;
}

export interface GroupeMotifs {
  representant: string;
  effectif: number;
}

export interface GroupeDerogations {
  cle: string;
  methode_id: string | null;
  methode_code: string | null;
  brique_code: string;
  nature: string;
  missions: number;
  derogations: number;
  approuvees: number;
  refusees: number;
  demandees: number;
  motifs_visibles: number;
  mots_cles: MotCle[];
  motifs: GroupeMotifs[];
  au_dessus_du_seuil: boolean;
}

export const SEUIL_MISSIONS_PAR_DEFAUT = 3;
export const SIMILARITE_MOTIFS_POUR_CENT = 50;

const MOTS_VIDES = new Set(
  (
    "les des une pour par sur dans avec sans aux que qui est sont pas plus moins tres son ses " +
    "leur leurs cette ces cet elle ils nous vous etre avoir fait faire mais donc car comme " +
    "entre deja tout tous toute toutes aussi ainsi lors dont afin ete etait avait peu trop"
  ).split(" "),
);

/** Mots significatifs d'un motif : minuscules, sans accents, 3 lettres au moins, pluriel retiré. */
export function motsDuMotif(texte: string): string[] {
  const mots = texte
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((m) => m.length >= 3 && !MOTS_VIDES.has(m))
    .map((m) => (m.length > 4 && /[sx]$/.test(m) ? m.slice(0, -1) : m));
  return [...new Set(mots)].sort();
}

/** Jaccard(a, b) ≥ seuil (pour cent), en entiers. Deux ensembles vides sont semblables. */
export function motifsSemblables(
  a: readonly string[],
  b: readonly string[],
  seuil: number,
): boolean {
  const sa = new Set(a);
  const inter = b.filter((m) => sa.has(m)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 || inter * 100 >= seuil * union;
}

function grouperMotifs(motifs: readonly string[], seuil: number): GroupeMotifs[] {
  const groupes: { mots: string[]; representant: string; effectif: number }[] = [];
  for (const motif of motifs) {
    const mots = motsDuMotif(motif);
    const g = groupes.find((x) => motifsSemblables(x.mots, mots, seuil));
    if (g) g.effectif += 1;
    else groupes.push({ mots, representant: motif, effectif: 1 });
  }
  return groupes
    .map(({ representant, effectif }) => ({ representant, effectif }))
    .sort((a, b) => b.effectif - a.effectif);
}

function motsCles(motifs: readonly string[], max = 8): MotCle[] {
  const compte = new Map<string, number>();
  for (const m of motifs)
    for (const mot of motsDuMotif(m)) compte.set(mot, (compte.get(mot) ?? 0) + 1);
  return [...compte.entries()]
    .map(([mot, occurrences]) => ({ mot, occurrences }))
    .filter((m) => m.occurrences >= 2)
    .sort((a, b) => b.occurrences - a.occurrences || a.mot.localeCompare(b.mot))
    .slice(0, max);
}

function exigerSeuils(seuilMissions: number, similarite: number): void {
  if (!Number.isInteger(seuilMissions) || seuilMissions < 2 || seuilMissions > 1000) {
    throw new ErreurCapitalisation(
      "SEUIL_INVALIDE",
      "Le seuil de fréquence va de 2 à 1 000 missions.",
    );
  }
  if (!Number.isInteger(similarite) || similarite < 1 || similarite > 100) {
    throw new ErreurCapitalisation("SEUIL_INVALIDE", "La similarité des motifs va de 1 à 100 %.");
  }
}

export const cleGroupeDerogations = (
  d: Pick<DerogationObservee, "methode_id" | "brique_code" | "nature">,
) => `${d.methode_id ?? "sans_methode"}|${d.brique_code}|${d.nature}`;

function resumerGroupe(
  liste: readonly DerogationObservee[],
  seuilMissions: number,
  similarite: number,
) {
  const d0 = liste[0] as DerogationObservee;
  const tries = [...liste].sort(
    (a, b) => a.cree_le.localeCompare(b.cree_le) || a.id.localeCompare(b.id),
  );
  const visibles = tries.map((d) => d.motif).filter((m): m is string => m !== null);
  const missions = new Set(liste.map((d) => d.mission_id)).size;
  return {
    cle: cleGroupeDerogations(d0),
    methode_id: d0.methode_id,
    methode_code: d0.methode_code,
    brique_code: d0.brique_code,
    nature: d0.nature,
    missions,
    derogations: liste.length,
    approuvees: liste.filter((d) => d.statut === "approuvee").length,
    refusees: liste.filter((d) => d.statut === "refusee").length,
    demandees: liste.filter((d) => d.statut === "demandee").length,
    motifs_visibles: visibles.length,
    mots_cles: motsCles(visibles),
    motifs: grouperMotifs(visibles, similarite),
    au_dessus_du_seuil: missions >= seuilMissions,
  };
}

/** Groupes triés : au-dessus du seuil d'abord, puis par missions, dérogations et clé. */
export function analyserDerogations(
  derogations: readonly DerogationObservee[],
  options: { seuilMissions?: number; similarite?: number } = {},
): GroupeDerogations[] {
  const seuilMissions = options.seuilMissions ?? SEUIL_MISSIONS_PAR_DEFAUT;
  const similarite = options.similarite ?? SIMILARITE_MOTIFS_POUR_CENT;
  exigerSeuils(seuilMissions, similarite);
  const parCle = new Map<string, DerogationObservee[]>();
  for (const d of derogations) {
    const cle = cleGroupeDerogations(d);
    parCle.set(cle, [...(parCle.get(cle) ?? []), d]);
  }
  return [...parCle.values()]
    .map((l) => resumerGroupe(l, seuilMissions, similarite))
    .sort(
      (a, b) =>
        Number(b.au_dessus_du_seuil) - Number(a.au_dessus_du_seuil) ||
        b.missions - a.missions ||
        b.derogations - a.derogations ||
        a.cle.localeCompare(b.cle),
    );
}
