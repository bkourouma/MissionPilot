/**
 * Score de qualité des données d'un KPI (KPI-15) : fraîcheur, complétude,
 * cohérence. Déterministe, arithmétique exacte, composantes et score en
 * fractions de 0 à 1 arrondies à 4 décimales, score entier de 0 à 100.
 *
 * - Fraîcheur : retard, en périodes EXIGIBLES (période close dont l'échéance,
 *   fin + délai de grâce, est passée), entre la dernière période mesurée et la
 *   dernière période exigible. 0 période de retard : 1 ; chaque période de
 *   retard retire 1/PERIODES_RETARD_NUL_KPI ; au-delà : 0.
 * - Complétude : part des FENETRE_COMPLETUDE_KPI dernières périodes exigibles
 *   (depuis le début du suivi) qui ont au moins une mesure active.
 * - Cohérence : 1 − (valeurs aberrantes + corrections) / lignes saisies, borné
 *   à [0, 1]. Une valeur est aberrante si elle s'écarte de la médiane de plus de
 *   K_ABERRANT_KPI fois l'écart absolu médian (MAD > 0, au moins
 *   MESURES_MIN_ABERRANTES_KPI mesures). Les corrections sont les lignes qui en
 *   remplacent une autre (corrections et annulations).
 * - Score : moyenne pondérée des composantes DISPONIBLES (poids 4 / 3 / 3).
 *   Aucune composante disponible : score null (« non évaluable »).
 * Niveau : « bon » ≥ 0,8 ; « moyen » ≥ 0,5 ; « faible » en dessous.
 *
 * Poids, seuils, fenêtres et facteur d'écart sont des VALEURS DE DÉPART à
 * calibrer avec des cabinets pilotes (docs/DECISIONS.md) : ce sont des
 * constantes exportées, jamais des nombres cachés.
 */
import { dateISODepuisJourUTC } from "../commun/dates";
import type { DateISO } from "../commun/dates";
import { ErreurKpi } from "./erreurs";
import {
  UN,
  ZERO,
  absolu,
  arrondir,
  comparer,
  depuisNombre,
  diviser,
  entier,
  fraction,
  multiplier,
  soustraire,
  somme,
  type Fraction,
} from "./fraction";
import { jourKpi, periodeKpiDepuisRang, rangKpiDuJour, type FrequenceKpi } from "./periodes";
import type { MesureKpi } from "./agregation";

export const PERIODES_RETARD_NUL_KPI = 3;
export const FENETRE_COMPLETUDE_KPI = 12;
export const K_ABERRANT_KPI = 5;
export const MESURES_MIN_ABERRANTES_KPI = 6;
/** Les corrections sont « fréquentes » dès qu'elles forment au moins 1/N des lignes saisies. */
export const SEUIL_CORRECTIONS_FREQUENTES_KPI = 5;
/** Délai de grâce maximal accepté (jours) : au-delà, l'entrée est refusée. */
export const DELAI_GRACE_MAX_JOURS_QUALITE_KPI = 3650;
export const POIDS_QUALITE_KPI = { fraicheur: 4, completude: 3, coherence: 3 } as const;
export const SEUILS_QUALITE_KPI = { bon: 0.8, moyen: 0.5 } as const;
/** Valeurs aberrantes détaillées au plus. */
const ABERRANTES_DETAILLEES_MAX = 20;

export type NiveauQualiteKpi = "bon" | "moyen" | "faible";
export type MotifQualiteKpi =
  | "AUCUNE_MESURE"
  | "MESURE_EN_RETARD"
  | "PERIODES_MANQUANTES"
  | "VALEURS_ABERRANTES"
  | "CORRECTIONS_FREQUENTES";

export interface EntreeQualiteKpi {
  readonly frequence: FrequenceKpi;
  readonly debutSuivi: DateISO;
  readonly finSuivi?: DateISO | null;
  readonly dateReference: DateISO;
  readonly delaiGraceJours: number;
  /** Mesures ACTIVES (ni annulées ni remplacées). */
  readonly mesures: readonly MesureKpi[];
  /** Lignes saisies qui en remplacent une autre (corrections et annulations). */
  readonly nombreCorrections: number;
  /** Toutes les lignes saisies (actives, remplacées, annulations). */
  readonly nombreLignes: number;
}

export interface QualiteKpi {
  /** 0 à 100, ou null si aucune composante n'est évaluable. */
  readonly score: number | null;
  readonly niveau: NiveauQualiteKpi | null;
  readonly fraicheur: number | null;
  readonly completude: number | null;
  readonly coherence: number | null;
  readonly motifs: readonly MotifQualiteKpi[];
  readonly details: {
    /** Périodes exigibles depuis le début du suivi. */
    readonly periodesExigibles: number;
    /** Parmi elles, celles qui ont au moins une mesure active (tout le suivi). */
    readonly periodesMesurees: number;
    /** Taille de la fenêtre de complétude (au plus FENETRE_COMPLETUDE_KPI périodes exigibles). */
    readonly periodesFenetre: number;
    /** Périodes mesurées DANS cette fenêtre (base de la composante « complétude »). */
    readonly periodesMesureesFenetre: number;
    readonly retardPeriodes: number;
    readonly nombreCorrections: number;
    readonly nombreLignes: number;
    readonly valeursAberrantes: readonly { readonly date: DateISO; readonly valeur: number }[];
  };
}

function ajouterJoursKpi(date: DateISO, jours: number): DateISO {
  return dateISODepuisJourUTC(jourKpi(date) + jours);
}

function mediane(valeurs: readonly Fraction[]): Fraction {
  const t = [...valeurs].sort((a, b) => comparer(a, b));
  const m = Math.floor(t.length / 2);
  return t.length % 2 === 1
    ? (t[m] as Fraction)
    : diviser(somme([t[m - 1] as Fraction, t[m] as Fraction]), entier(2));
}

/** Mesures dont l'écart à la médiane dépasse K × MAD (MAD non nul, assez de mesures). */
function aberrantes(mesures: readonly MesureKpi[]): MesureKpi[] {
  if (mesures.length < MESURES_MIN_ABERRANTES_KPI) return [];
  const valeurs = mesures.map((m) => depuisNombre(m.valeur, "Une valeur"));
  const med = mediane(valeurs);
  const mad = mediane(valeurs.map((v) => absolu(soustraire(v, med))));
  if (comparer(mad, ZERO) === 0) return [];
  const seuil = multiplier(entier(K_ABERRANT_KPI), mad);
  return mesures.filter(
    (_, i) => comparer(absolu(soustraire(valeurs[i] as Fraction, med)), seuil) > 0,
  );
}

const borne01 = (f: Fraction): Fraction =>
  comparer(f, ZERO) < 0 ? ZERO : comparer(f, UN) > 0 ? UN : f;

function niveauDe(score: Fraction): NiveauQualiteKpi {
  if (comparer(score, depuisNombre(SEUILS_QUALITE_KPI.bon)) >= 0) return "bon";
  if (comparer(score, depuisNombre(SEUILS_QUALITE_KPI.moyen)) >= 0) return "moyen";
  return "faible";
}

export function evaluerQualiteDonneesKpi(entree: EntreeQualiteKpi): QualiteKpi {
  const { frequence, debutSuivi, dateReference, delaiGraceJours } = entree;
  if (
    !Number.isSafeInteger(delaiGraceJours) ||
    delaiGraceJours < 0 ||
    delaiGraceJours > DELAI_GRACE_MAX_JOURS_QUALITE_KPI
  ) {
    throw new ErreurKpi(
      "OPTIONS_INVALIDES",
      `Le délai de grâce est un entier de jours entre 0 et ${DELAI_GRACE_MAX_JOURS_QUALITE_KPI}.`,
    );
  }
  if (
    !Number.isSafeInteger(entree.nombreCorrections) ||
    !Number.isSafeInteger(entree.nombreLignes) ||
    entree.nombreCorrections < 0 ||
    entree.nombreLignes < entree.nombreCorrections
  ) {
    throw new ErreurKpi("OPTIONS_INVALIDES", "Nombres de lignes saisies incohérents.");
  }
  const fin = entree.finSuivi ?? null;
  const suiviTermine = fin !== null && fin < dateReference;
  const au = fin !== null && fin < dateReference ? fin : dateReference;
  const rangDebut = rangKpiDuJour(jourKpi(debutSuivi), frequence);
  const mesures = entree.mesures.filter((m) => m.date >= debutSuivi && m.date <= au);

  // Dernière période exigible : close, échéance (fin + grâce) passée, ou suivi terminé.
  let rangDu: number | null = null;
  if (au >= debutSuivi) {
    let r = rangKpiDuJour(jourKpi(au), frequence);
    while (r >= rangDebut) {
      const p = periodeKpiDepuisRang(frequence, r);
      if (suiviTermine || ajouterJoursKpi(p.fin, delaiGraceJours) < dateReference) {
        rangDu = r;
        break;
      }
      r -= 1;
    }
  }
  const exigibles = rangDu === null ? 0 : rangDu - rangDebut + 1;

  const rangsMesures = new Set(mesures.map((m) => rangKpiDuJour(jourKpi(m.date), frequence)));
  const derniereMesuree = rangsMesures.size === 0 ? null : Math.max(...rangsMesures);
  let mesureesExigibles = 0;
  if (rangDu !== null) {
    for (const r of rangsMesures) if (r >= rangDebut && r <= rangDu) mesureesExigibles += 1;
  }

  // Fraîcheur.
  let fraicheur: Fraction | null = null;
  let retard = 0;
  if (rangDu !== null) {
    retard = derniereMesuree === null ? exigibles : Math.max(0, rangDu - derniereMesuree);
    fraicheur = borne01(soustraire(UN, fraction(BigInt(retard), BigInt(PERIODES_RETARD_NUL_KPI))));
  } else if (mesures.length > 0) {
    fraicheur = UN;
  }

  // Complétude sur les dernières périodes exigibles.
  let completude: Fraction | null = null;
  let mesureesFenetre = 0;
  let tailleFenetre = 0;
  if (rangDu !== null) {
    const debutFenetre = Math.max(rangDebut, rangDu - FENETRE_COMPLETUDE_KPI + 1);
    const n = rangDu - debutFenetre + 1;
    tailleFenetre = n;
    for (let r = debutFenetre; r <= rangDu; r++) if (rangsMesures.has(r)) mesureesFenetre += 1;
    completude = fraction(BigInt(mesureesFenetre), BigInt(n));
  }

  // Cohérence.
  let coherence: Fraction | null = null;
  const anormales = aberrantes(mesures);
  if (entree.nombreLignes > 0) {
    coherence = borne01(
      soustraire(
        UN,
        fraction(BigInt(anormales.length + entree.nombreCorrections), BigInt(entree.nombreLignes)),
      ),
    );
  }

  // Score pondéré des composantes disponibles.
  const composantes: [Fraction | null, number][] = [
    [fraicheur, POIDS_QUALITE_KPI.fraicheur],
    [completude, POIDS_QUALITE_KPI.completude],
    [coherence, POIDS_QUALITE_KPI.coherence],
  ];
  const disponibles = composantes.filter((c): c is [Fraction, number] => c[0] !== null);
  let score: Fraction | null = null;
  if (disponibles.length > 0) {
    const poids = disponibles.reduce((s, [, p]) => s + p, 0);
    score = diviser(somme(disponibles.map(([f, p]) => multiplier(f, entier(p)))), entier(poids));
  }

  const motifs: MotifQualiteKpi[] = [];
  if (mesures.length === 0 && exigibles > 0) motifs.push("AUCUNE_MESURE");
  if (retard > 0 && mesures.length > 0) motifs.push("MESURE_EN_RETARD");
  if (completude !== null && comparer(completude, UN) < 0) motifs.push("PERIODES_MANQUANTES");
  if (anormales.length > 0) motifs.push("VALEURS_ABERRANTES");
  if (
    entree.nombreCorrections > 0 &&
    SEUIL_CORRECTIONS_FREQUENTES_KPI * entree.nombreCorrections >= entree.nombreLignes
  ) {
    motifs.push("CORRECTIONS_FREQUENTES");
  }

  return {
    score: score === null ? null : arrondir(multiplier(score, entier(100)), 0),
    niveau: score === null ? null : niveauDe(score),
    fraicheur: fraicheur === null ? null : arrondir(fraicheur, 4),
    completude: completude === null ? null : arrondir(completude, 4),
    coherence: coherence === null ? null : arrondir(coherence, 4),
    motifs,
    details: {
      periodesExigibles: exigibles,
      periodesMesurees: mesureesExigibles,
      periodesFenetre: tailleFenetre,
      periodesMesureesFenetre: mesureesFenetre,
      retardPeriodes: retard,
      nombreCorrections: entree.nombreCorrections,
      nombreLignes: entree.nombreLignes,
      valeursAberrantes: anormales
        .slice(0, ABERRANTES_DETAILLEES_MAX)
        .map((m) => ({ date: m.date as DateISO, valeur: m.valeur })),
    },
  };
}
