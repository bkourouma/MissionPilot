/**
 * Découpage, budget en jours et planning d'une mission (PLN-01 à PLN-03) : logique pure,
 * testée dans `decoupage.test.ts`. Agrégats, dates au plus tôt et couleurs viennent des
 * moteurs de l'API ; ce module réordonne, valide les saisies et met en page.
 */
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import { lireNombre, texteOuNull, type Resultat } from "./saisie";

export interface LigneBudgetTache {
  id: string;
  grade_id: string | null;
  grade_code: string | null;
  collaborateur_id: string | null;
  collaborateur_nom: string | null;
  jours: number;
}

export interface Tache {
  id: string;
  phase_id: string;
  lot_id: string | null;
  libelle: string;
  ordre: number;
  est_livrable: boolean;
  date_debut: string | null;
  duree_jours_ouvres: number;
  /** Absent sans « budget.lire_jours ». */
  budget?: LigneBudgetTache[];
}

export interface Lot {
  id: string;
  phase_id: string;
  libelle: string;
  ordre: number;
  est_livrable: boolean;
  taches: Tache[];
}

export interface Phase {
  id: string;
  libelle: string;
  ordre: number;
  lots: Lot[];
  /** Tâches directement sous la phase (sans lot). */
  taches: Tache[];
}

export interface Jalon {
  id: string;
  phase_id: string | null;
  libelle: string;
  date_prevue: string | null;
  atteint: boolean;
  ordre: number;
}

export interface Dependance {
  id: string;
  predecesseur_id: string;
  successeur_id: string;
  decalage: number;
}

export interface Decoupage {
  phases: Phase[];
  jalons: Jalon[];
  dependances: Dependance[];
}

export interface TachePlanifiee {
  id: string;
  libelle: string;
  phase_id: string;
  lot_id: string | null;
  duree_jours_ouvres: number;
  debut?: string;
  fin?: string;
}

export interface Planning {
  taches: TachePlanifiee[];
  jalons: Jalon[];
  dependances: Dependance[];
}

export type Couleur = "vert" | "orange" | "rouge";

export interface Suivi {
  budget: number;
  realise: number;
  resteAFaire: number;
  atterrissage: number;
  ecart: number;
  ecartRelatif: number | null;
  consommation: number | null;
}

export interface NoeudSynthese {
  id: string;
  niveau: "mission" | "phase" | "lot" | "tache";
  libelle?: string;
  suivi: Suivi;
  couleur: Couleur;
  enfants: NoeudSynthese[];
}

/** Couleur de pilotage → badge : le libellé accompagne toujours la couleur. */
export const COULEUR_BADGE: Record<Couleur, { tonalite: TonaliteStatut; libelle: string }> = {
  vert: { tonalite: "succes", libelle: "Dans le budget" },
  orange: { tonalite: "attention", libelle: "À surveiller" },
  rouge: { tonalite: "danger", libelle: "Dépassement" },
};

// --- Parcours de l'arbre ------------------------------------------------------------------

export interface TacheSituee extends Tache {
  /** « Phase › Lot › Tâche », pour les listes de choix et les annonces. */
  chemin: string;
}

/** Toutes les tâches dans l'ordre de lecture (phase, puis ses lots, puis ses tâches directes). */
export function tachesDansLOrdre(d: Pick<Decoupage, "phases">): TacheSituee[] {
  const liste: TacheSituee[] = [];
  for (const p of d.phases) {
    for (const l of p.lots) {
      for (const t of l.taches)
        liste.push({ ...t, chemin: `${p.libelle} › ${l.libelle} › ${t.libelle}` });
    }
    for (const t of p.taches) liste.push({ ...t, chemin: `${p.libelle} › ${t.libelle}` });
  }
  return liste;
}

export interface OptionParent {
  valeur: string;
  libelle: string;
}

/** Parents possibles d'une tâche : chaque phase et chaque lot. */
export function parentsDeTache(d: Pick<Decoupage, "phases">): OptionParent[] {
  return d.phases.flatMap((p) => [
    { valeur: p.id, libelle: `Phase : ${p.libelle}` },
    ...p.lots.map((l) => ({ valeur: l.id, libelle: `Lot : ${p.libelle} › ${l.libelle}` })),
  ]);
}

// --- Réorganisation (PLN-01) sans glisser-déposer -----------------------------------------

export type TypeElement = "phase" | "lot" | "tache" | "jalon";

export interface Deplacement {
  type: TypeElement;
  id: string;
  parent_id?: string | null;
  ordre: number;
}

const PAS_ORDRE = 10;

/**
 * Monter (-1) ou descendre (+1) un élément parmi ses frères : les frères sont renumérotés
 * 10, 20, 30… dans le nouvel ordre (robuste aux ordres égaux). `null` si l'élément est déjà
 * en bout de liste ou introuvable.
 */
export function deplacementsEchange(
  freres: readonly { id: string }[],
  id: string,
  sens: -1 | 1,
  type: TypeElement,
  parentId?: string | null,
): Deplacement[] | null {
  const i = freres.findIndex((f) => f.id === id);
  const j = i + sens;
  if (i < 0 || j < 0 || j >= freres.length) return null;
  const ordre = freres.map((f) => f.id);
  [ordre[i], ordre[j]] = [ordre[j] as string, ordre[i] as string];
  return ordre.map((fid, k) => ({
    type,
    id: fid,
    ...(type === "phase" ? {} : { parent_id: parentId ?? null }),
    ordre: (k + 1) * PAS_ORDRE,
  }));
}

/** Rattache un élément à un autre parent, en dernière position. */
export function deplacementChangementParent(
  type: Exclude<TypeElement, "phase">,
  id: string,
  parentId: string | null,
  freresCible: readonly { id: string; ordre: number }[],
): Deplacement {
  const max = freresCible.filter((f) => f.id !== id).reduce((m, f) => Math.max(m, f.ordre), 0);
  return { type, id, parent_id: parentId, ordre: Math.min(max + PAS_ORDRE, 100_000) };
}

/** Frères d'une tâche sous un parent (phase : tâches directes ; lot : ses tâches). */
export function tachesDuParent(d: Pick<Decoupage, "phases">, parentId: string): Tache[] {
  for (const p of d.phases) {
    if (p.id === parentId) return p.taches;
    const lot = p.lots.find((l) => l.id === parentId);
    if (lot) return lot.taches;
  }
  return [];
}

/** Ordre proposé pour un nouvel élément ajouté en fin de liste. */
export const ordreSuivant = (freres: readonly { ordre: number }[]) =>
  Math.min(freres.reduce((m, f) => Math.max(m, f.ordre), 0) + PAS_ORDRE, 100_000);

// --- Saisies -----------------------------------------------------------------------------

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function libelleValide(v: string, erreurs: Record<string, string>): string {
  const l = v.trim();
  if (l === "") erreurs.libelle = "Saisissez un libellé.";
  else if (l.length > 200) erreurs.libelle = "200 caractères au plus.";
  return l;
}

export function validerPhase(libelle: string): Resultat<{ libelle: string }, "libelle"> {
  const erreurs: Record<string, string> = {};
  const l = libelleValide(libelle, erreurs);
  return Object.keys(erreurs).length
    ? { ok: false, erreurs }
    : { ok: true, charge: { libelle: l } };
}

export function validerLot(s: {
  libelle: string;
  est_livrable: boolean;
}): Resultat<{ libelle: string; est_livrable: boolean }, "libelle"> {
  const erreurs: Record<string, string> = {};
  const l = libelleValide(s.libelle, erreurs);
  return Object.keys(erreurs).length
    ? { ok: false, erreurs }
    : { ok: true, charge: { libelle: l, est_livrable: s.est_livrable } };
}

export interface SaisieTache {
  libelle: string;
  est_livrable: boolean;
  date_debut: string;
  duree_jours_ouvres: string;
}

export type ChampTache = "libelle" | "date_debut" | "duree_jours_ouvres";

export function saisieDepuisTache(t: Tache): SaisieTache {
  return {
    libelle: t.libelle,
    est_livrable: t.est_livrable,
    date_debut: t.date_debut ?? "",
    duree_jours_ouvres: String(t.duree_jours_ouvres),
  };
}

export const SAISIE_TACHE_VIDE: SaisieTache = {
  libelle: "",
  est_livrable: false,
  date_debut: "",
  duree_jours_ouvres: "1",
};

export function validerTache(s: SaisieTache): Resultat<
  {
    libelle: string;
    est_livrable: boolean;
    date_debut: string | null;
    duree_jours_ouvres: number;
  },
  ChampTache
> {
  const erreurs: Record<string, string> = {};
  const libelle = libelleValide(s.libelle, erreurs);
  if (s.date_debut !== "" && !DATE.test(s.date_debut)) erreurs.date_debut = "Date invalide.";
  const d = lireNombre(s.duree_jours_ouvres);
  if (d === null || Number.isNaN(d) || !Number.isInteger(d) || d < 1 || d > 1000)
    erreurs.duree_jours_ouvres = "Nombre entier de jours ouvrés, entre 1 et 1000.";
  if (Object.keys(erreurs).length) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      libelle,
      est_livrable: s.est_livrable,
      date_debut: texteOuNull(s.date_debut),
      duree_jours_ouvres: d as number,
    },
  };
}

export interface SaisieJalon {
  libelle: string;
  phase_id: string;
  date_prevue: string;
  atteint: boolean;
}

export const SAISIE_JALON_VIDE: SaisieJalon = {
  libelle: "",
  phase_id: "",
  date_prevue: "",
  atteint: false,
};

export function saisieDepuisJalon(j: Jalon): SaisieJalon {
  return {
    libelle: j.libelle,
    phase_id: j.phase_id ?? "",
    date_prevue: j.date_prevue ?? "",
    atteint: j.atteint,
  };
}

export function validerJalon(
  s: SaisieJalon,
): Resultat<
  { libelle: string; phase_id: string | null; date_prevue: string | null; atteint: boolean },
  "libelle" | "phase_id" | "date_prevue"
> {
  const erreurs: Record<string, string> = {};
  const libelle = libelleValide(s.libelle, erreurs);
  if (s.phase_id !== "" && !UUID.test(s.phase_id)) erreurs.phase_id = "Choisissez une phase.";
  if (s.date_prevue !== "" && !DATE.test(s.date_prevue)) erreurs.date_prevue = "Date invalide.";
  if (Object.keys(erreurs).length) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      libelle,
      phase_id: s.phase_id === "" ? null : s.phase_id,
      date_prevue: texteOuNull(s.date_prevue),
      atteint: s.atteint,
    },
  };
}

/**
 * Budget en jours d'une tâche saisi par grade (PLN-02). Les lignes nominatives existantes
 * (par collaborateur) sont conservées : l'API remplace toutes les lignes de la tâche.
 */
export function validerBudgetTache(
  saisieParGrade: Record<string, string>,
  existantes: readonly LigneBudgetTache[],
): Resultat<
  { lignes: ({ grade_id: string; jours: number } | { collaborateur_id: string; jours: number })[] },
  string
> {
  const erreurs: Record<string, string> = {};
  const lignes: (
    { grade_id: string; jours: number } | { collaborateur_id: string; jours: number }
  )[] = [];
  for (const [gradeId, texte] of Object.entries(saisieParGrade)) {
    const n = lireNombre(texte);
    if (n === null) continue;
    if (Number.isNaN(n) || n < 0 || n > 100_000 || Math.abs(n * 100 - Math.round(n * 100)) > 1e-9)
      erreurs[gradeId] = "Jours positifs, au centième au plus (ex. 2,5).";
    else if (n > 0) lignes.push({ grade_id: gradeId, jours: n });
  }
  for (const l of existantes) {
    if (l.collaborateur_id && l.jours > 0)
      lignes.push({ collaborateur_id: l.collaborateur_id, jours: l.jours });
  }
  if (lignes.length > 50) erreurs._ = "50 lignes au plus par tâche.";
  if (Object.keys(erreurs).length) return { ok: false, erreurs };
  return { ok: true, charge: { lignes } };
}

/** Saisie initiale du budget par grade d'une tâche (identifiant de grade → jours). */
export function saisieBudgetDepuisTache(t: Tache): Record<string, string> {
  return Object.fromEntries(
    (t.budget ?? [])
      .filter((l) => l.grade_id)
      .map((l) => [l.grade_id as string, String(l.jours).replace(".", ",")]),
  );
}

export function validerDependance(s: {
  predecesseur_id: string;
  successeur_id: string;
  decalage: string;
}): Resultat<
  { predecesseur_id: string; successeur_id: string; decalage: number },
  "predecesseur_id" | "successeur_id" | "decalage"
> {
  const erreurs: Record<string, string> = {};
  if (!UUID.test(s.predecesseur_id)) erreurs.predecesseur_id = "Choisissez la tâche précédente.";
  if (!UUID.test(s.successeur_id)) erreurs.successeur_id = "Choisissez la tâche suivante.";
  else if (s.successeur_id === s.predecesseur_id)
    erreurs.successeur_id = "Une tâche ne dépend pas d'elle-même.";
  const d = s.decalage.trim() === "" ? 0 : lireNombre(s.decalage);
  if (d === null || Number.isNaN(d) || !Number.isInteger(d) || d < -365 || d > 365)
    erreurs.decalage = "Nombre entier de jours ouvrés entre -365 et 365.";
  if (Object.keys(erreurs).length) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      predecesseur_id: s.predecesseur_id,
      successeur_id: s.successeur_id,
      decalage: d as number,
    },
  };
}

// --- Planning (PLN-03) : liste chronologique et Gantt léger -------------------------------

const JOUR_MS = 86_400_000;
const jourUtc = (iso: string) => {
  const [a, m, j] = iso.split("-").map(Number);
  return Date.UTC(a as number, (m as number) - 1, j as number) / JOUR_MS;
};

/** Tâches datées triées par début, puis fin, puis libellé. */
export function tachesChronologiques(taches: readonly TachePlanifiee[]): TachePlanifiee[] {
  return [...taches].sort(
    (a, b) =>
      (a.debut ?? "9999").localeCompare(b.debut ?? "9999") ||
      (a.fin ?? "9999").localeCompare(b.fin ?? "9999") ||
      a.libelle.localeCompare(b.libelle, "fr"),
  );
}

export interface BarreGantt {
  id: string;
  /** Position et largeur en pourcentage de l'étendue du planning (mise en page seulement). */
  gauche: number;
  largeur: number;
}

export interface EtendueGantt {
  debut: string;
  fin: string;
  jours: number;
  barres: Map<string, BarreGantt>;
  jalons: Map<string, number>;
}

/**
 * Géométrie du Gantt : étendue des dates (tâches et jalons datés) et position de chaque
 * barre en pourcentage (jours calendaires, fin incluse). `null` si rien n'est daté.
 */
export function geometrieGantt(
  taches: readonly TachePlanifiee[],
  jalons: readonly Pick<Jalon, "id" | "date_prevue">[] = [],
): EtendueGantt | null {
  const dates = [
    ...taches.flatMap((t) => (t.debut && t.fin ? [t.debut, t.fin] : [])),
    ...jalons.flatMap((j) => (j.date_prevue ? [j.date_prevue] : [])),
  ].sort();
  if (dates.length === 0) return null;
  const debut = dates[0] as string;
  const fin = dates[dates.length - 1] as string;
  const origine = jourUtc(debut);
  const total = jourUtc(fin) - origine + 1;
  const pct = (n: number) => Math.round((n / total) * 10_000) / 100;
  const barres = new Map<string, BarreGantt>();
  for (const t of taches) {
    if (!t.debut || !t.fin) continue;
    const g = jourUtc(t.debut) - origine;
    const l = jourUtc(t.fin) - jourUtc(t.debut) + 1;
    barres.set(t.id, { id: t.id, gauche: pct(g), largeur: Math.max(pct(l), 0.5) });
  }
  const positionsJalons = new Map<string, number>();
  for (const j of jalons) {
    if (j.date_prevue) positionsJalons.set(j.id, pct(jourUtc(j.date_prevue) - origine + 0.5));
  }
  return { debut, fin, jours: total, barres, jalons: positionsJalons };
}

/** Jours budgétés de chaque nœud de la synthèse (identifiant → budget agrégé par le moteur). */
export function budgetsParNoeud(racine: NoeudSynthese | null | undefined): Record<string, number> {
  const budgets: Record<string, number> = {};
  const parcourir = (n: NoeudSynthese) => {
    budgets[n.id] = n.suivi.budget;
    n.enfants.forEach(parcourir);
  };
  if (racine) parcourir(racine);
  return budgets;
}

/** Phases de la synthèse (enfants directs de la racine mission). */
export const phasesSynthese = (racine: NoeudSynthese | null | undefined): NoeudSynthese[] =>
  racine?.enfants ?? [];
