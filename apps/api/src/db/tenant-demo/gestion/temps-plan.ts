import { ajouterJours } from "@missionpilot/engines";
import type { CleCompte } from "../cles.js";
import type { CleMission } from "./casting.js";
import { ecartJours, lundiDe, type Alea } from "../horloge.js";
import { COMMENTAIRES_INTERNES, COMMENTAIRES_MISSION, POIDS_ACTIVITES } from "./donnees-temps.js";
import type { GenreProfil } from "./donnees-temps.js";
import { maxDate, minDate } from "./outils.js";

/*
 * PLANIFICATION PURE des temps du Tenant démo (aucun accès base ni route) : transforme le
 * casting des missions, les affectations et le calendrier en feuilles de temps hebdomadaires
 * « à saisir ». Les saisies elles-mêmes passent ensuite par les vraies routes (temps-saisie.ts).
 *
 * Unité interne : le DEMI-JOUR (« unité » : 2 unités = 1 jour), pas de saisie du cabinet
 * (`demi_journee`). Un jour ouvré porte 2 unités au plus, donc jamais plus de 5 jours par
 * semaine pour une personne, toutes missions et activités internes confondues.
 *
 * Règle de volume (brief du lot 2b) :
 * - mission TERMINÉE : 96 à 103 % des jours alloués de chaque affectation, sauf
 *   `wouri-redressement` (~150 %, dépassement voulu) ;
 * - mission EN COURS : prorata de l'avancement à la date du jour (100 %), sauf
 *   `gabon-redressement` (~135 % du prorata, dépassement voulu) ;
 * - les tâches (une tâche = une phase) se consomment dans l'ordre du casting, sur des fenêtres
 *   proportionnelles à leurs jours alloués : les premières phases sont terminées, la phase
 *   courante est entamée.
 */

export interface AbsenceTemps {
  debut: string;
  fin: string;
  type: string;
}

export interface PersonneTemps {
  cle: CleCompte;
  collaborateurId: string;
  utilisateurId: string;
  nom: string;
  /** Date d'entrée dans le cabinet (création du collaborateur). */
  depuis: string;
  genre: GenreProfil;
  /** Jours par semaine au plus sur les missions (3 à 4,5 selon la personne). */
  rythme: number;
  absences: AbsenceTemps[];
}

export interface LigneUnites {
  date: string;
  unites: number;
}

/** Travail d'une personne sur une tâche (une affectation) à répartir dans le temps. */
export interface Paquet {
  missionCle: CleMission;
  missionId: string;
  tacheId: string;
  affectationId: string;
  cle: CleCompte;
  collaborateurId: string;
  joursAlloues: number;
  debut: string;
  fin: string;
  /** Unités cibles (demi-journées). */
  unitesCible: number;
  /** Rempli par la planification. */
  lignes: LigneUnites[];
  /** Unités qui n'ont pas pu être placées (capacité insuffisante). */
  manque: number;
}

export interface LignePlan {
  date: string;
  tacheId: string | null;
  missionId: string | null;
  /** Code d'activité interne (null pour une ligne de mission). */
  activite: string | null;
  unites: number;
  commentaire: string | null;
}

export interface FeuillePlan {
  cle: CleCompte;
  collaborateurId: string;
  utilisateurId: string;
  semaine: string;
  lignes: LignePlan[];
  missionIds: string[];
  interne: boolean;
}

/* ----- Répartition ----- */

/**
 * Répartit `total` unités sur des semaines (plafonds `caps`, poids relatifs) : parts entières au
 * prorata des poids, puis unités restantes tirées au hasard pondéré. Renvoie les parts et le
 * reste non placé.
 */
function repartir(
  total: number,
  caps: number[],
  poids: number[],
  rng: Alea,
): { parts: number[]; reste: number } {
  const parts = caps.map(() => 0);
  let reste = total;
  for (let tour = 0; tour < 12 && reste > 0; tour++) {
    const actifs = caps.flatMap((c, i) => (parts[i]! < c && poids[i]! > 0 ? [i] : []));
    const somme = actifs.reduce((s, i) => s + poids[i]!, 0);
    if (actifs.length === 0 || somme <= 0) break;
    let place = 0;
    for (const i of actifs) {
      const part = Math.min(caps[i]! - parts[i]!, Math.floor((reste * poids[i]!) / somme));
      parts[i]! += part;
      place += part;
    }
    reste -= place;
    if (place === 0) break;
  }
  // Unités restantes : une à une, au hasard pondéré (puis sans poids si nécessaire).
  for (const pondere of [true, false]) {
    while (reste > 0) {
      const actifs = caps.flatMap((c, i) =>
        parts[i]! < c && (!pondere || poids[i]! > 0) ? [i] : [],
      );
      if (actifs.length === 0) break;
      const somme = actifs.reduce((s, i) => s + (pondere ? poids[i]! : 1), 0);
      let tirage = rng.suivant() * somme;
      let choisi = actifs[actifs.length - 1]!;
      for (const i of actifs) {
        tirage -= pondere ? poids[i]! : 1;
        if (tirage < 0) {
          choisi = i;
          break;
        }
      }
      parts[choisi]! += 1;
      reste -= 1;
    }
  }
  return { parts, reste };
}

function tirerPondere(poids: Record<string, number>, rng: Alea): string | null {
  const entrees = Object.entries(poids).filter(([, p]) => p > 0);
  const somme = entrees.reduce((s, [, p]) => s + p, 0);
  if (entrees.length === 0) return null;
  let t = rng.suivant() * somme;
  for (const [code, p] of entrees) {
    t -= p;
    if (t < 0) return code;
  }
  return entrees[entrees.length - 1]![0];
}

/** Unités de temps interne d'une semaine, selon le profil et la charge de mission. */
function unitesInternes(genre: GenreProfil, unitesMission: number, rng: Alea): number {
  if (genre === "associe") return rng.entier(2, 5);
  if (genre === "externe") return rng.proba(0.4) ? rng.entier(1, 2) : 0;
  const base = rng.proba(0.5) ? 1 : 2;
  if (unitesMission <= 2) return base + rng.entier(2, 4);
  if (unitesMission <= 5) return base + rng.entier(0, 1);
  return base;
}

/* ----- Planification d'une personne ----- */

export interface EntreePlanification {
  personne: PersonneTemps;
  paquets: Paquet[];
  debutActivite: string;
  aujourdhui: string;
  ouvre: (date: string) => boolean;
  /** Codes d'activités internes actives du cabinet. */
  activites: ReadonlySet<string>;
  rng: Alea;
}

export function planifierPersonne(e: EntreePlanification): FeuillePlan[] {
  const { personne: p, paquets, aujourdhui, rng } = e;
  const premierPaquet = paquets.length
    ? paquets.reduce((m, q) => minDate(m, q.debut), aujourdhui)
    : p.depuis;
  const debut = maxDate(e.debutActivite, minDate(p.depuis, premierPaquet));
  if (debut > aujourdhui) return [];

  // Jours disponibles (ouvrés, non absents) et jours d'absence validée.
  const libre = new Map<string, number>();
  const absents = new Map<string, string>();
  for (const a of p.absences) {
    for (let d = maxDate(a.debut, debut); d <= minDate(a.fin, aujourdhui); d = ajouterJours(d, 1)) {
      if (e.ouvre(d)) absents.set(d, a.type);
    }
  }
  for (let d = debut; d <= aujourdhui; d = ajouterJours(d, 1)) {
    if (e.ouvre(d) && !absents.has(d)) libre.set(d, 2);
  }
  const semaines = new Map<string, LignePlan[]>();
  const lignesDe = (w: string): LignePlan[] => {
    const l = semaines.get(w) ?? [];
    semaines.set(w, l);
    return l;
  };
  const ajouter = (w: string, l: LignePlan): void => {
    const existante = lignesDe(w).find(
      (x) => x.date === l.date && x.tacheId === l.tacheId && x.activite === l.activite,
    );
    if (existante) existante.unites += l.unites;
    else lignesDe(w).push(l);
  };

  // Missions : les fenêtres les plus courtes d'abord (elles ont le moins de marge), puis par début.
  const ordonnes = [...paquets].sort(
    (a, b) =>
      ecartJours(a.debut, a.fin) - ecartJours(b.debut, b.fin) || a.debut.localeCompare(b.debut),
  );
  const poser = (q: Paquet, d: string, don: number): void => {
    libre.set(d, (libre.get(d) ?? 0) - don);
    ajouter(lundiDe(d), {
      date: d,
      tacheId: q.tacheId,
      missionId: q.missionId,
      activite: null,
      unites: don,
      commentaire: rng.proba(0.3) ? rng.choisir(COMMENTAIRES_MISSION) : null,
    });
    q.lignes.push({ date: d, unites: don });
  };
  for (const q of ordonnes) {
    const fin = minDate(q.fin, aujourdhui);
    const infos: { w: string; jours: string[]; cap: number; poids: number }[] = [];
    for (let w = lundiDe(q.debut); w <= lundiDe(fin); w = ajouterJours(w, 7)) {
      const jours = Array.from({ length: 7 }, (_, i) => ajouterJours(w, i)).filter(
        (d) => d >= q.debut && d <= fin && (libre.get(d) ?? 0) > 0,
      );
      const dispo = jours.reduce((s, d) => s + (libre.get(d) ?? 0), 0);
      const cap = Math.min(Math.round(p.rythme * 2), dispo);
      const alea = rng.proba(0.08) ? 0 : 0.4 + 1.2 * rng.suivant();
      infos.push({ w, jours, cap, poids: cap > 0 ? alea * Math.max(0.4, jours.length / 5) : 0 });
    }
    const { parts, reste } = repartir(
      q.unitesCible,
      infos.map((i) => i.cap),
      infos.map((i) => i.poids),
      rng,
    );
    q.manque = reste;
    infos.forEach((info, k) => {
      let u = parts[k]!;
      for (const d of rng.melanger(info.jours)) {
        if (u <= 0) break;
        const don = Math.min(libre.get(d) ?? 0, u);
        if (don <= 0) continue;
        u -= don;
        poser(q, d, don);
      }
    });
    // Secours : unités restantes sur les jours encore libres de la fenêtre, au-delà du rythme.
    if (q.manque > 0) {
      const jours = Array.from({ length: ecartJours(q.debut, fin) + 1 }, (_, i) =>
        ajouterJours(q.debut, i),
      ).filter((d) => (libre.get(d) ?? 0) > 0);
      for (const d of rng.melanger(jours)) {
        if (q.manque <= 0) break;
        const don = Math.min(libre.get(d) ?? 0, q.manque);
        q.manque -= don;
        poser(q, d, don);
      }
    }
  }

  // Absences validées : une ligne « congés » (ou formation) par jour ouvré.
  for (const [d, type] of absents) {
    const code = type === "formation" ? "formation" : "conges";
    if (e.activites.has(code)) {
      ajouter(lundiDe(d), {
        date: d,
        tacheId: null,
        missionId: null,
        activite: code,
        unites: 2,
        commentaire: null,
      });
    }
  }

  // Temps interne : toutes les semaines, davantage quand la charge de mission est faible.
  const poidsActivites = Object.fromEntries(
    Object.entries(POIDS_ACTIVITES[p.genre]).filter(([code]) => e.activites.has(code)),
  );
  const feuilles: FeuillePlan[] = [];
  for (let w = lundiDe(debut); w <= lundiDe(aujourdhui); w = ajouterJours(w, 7)) {
    const jours = Array.from({ length: 7 }, (_, i) => ajouterJours(w, i)).filter(
      (d) => (libre.get(d) ?? 0) > 0,
    );
    const unitesMission = lignesDe(w).reduce((s, l) => s + (l.activite ? 0 : l.unites), 0);
    let cible = Math.min(
      unitesInternes(p.genre, unitesMission, rng),
      jours.reduce((s, d) => s + (libre.get(d) ?? 0), 0),
    );
    for (const d of rng.melanger(jours)) {
      if (cible <= 0) break;
      const don = Math.min(libre.get(d) ?? 0, cible, rng.entier(1, 2));
      const code = tirerPondere(poidsActivites, rng);
      if (don <= 0 || !code) continue;
      libre.set(d, (libre.get(d) ?? 0) - don);
      cible -= don;
      const exemples = COMMENTAIRES_INTERNES[code] ?? [];
      ajouter(w, {
        date: d,
        tacheId: null,
        missionId: null,
        activite: code,
        unites: don,
        commentaire: exemples.length > 0 && rng.proba(0.4) ? rng.choisir(exemples) : null,
      });
    }
    const lignes = (semaines.get(w) ?? []).sort(
      (a, b) => a.date.localeCompare(b.date) || String(a.tacheId).localeCompare(String(b.tacheId)),
    );
    if (lignes.length === 0) continue;
    feuilles.push({
      cle: p.cle,
      collaborateurId: p.collaborateurId,
      utilisateurId: p.utilisateurId,
      semaine: w,
      lignes,
      missionIds: [...new Set(lignes.flatMap((l) => (l.missionId ? [l.missionId] : [])))],
      interne: lignes.some((l) => l.activite !== null),
    });
  }
  return feuilles;
}
