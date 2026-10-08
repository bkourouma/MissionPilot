import { analyserDateISO } from "../commun/dates";
import { ErreurAutomatisation } from "./erreurs";

/*
 * Détection des événements qui naissent du TEMPS (AUT-01) : questionnaire resté sans
 * réponse, KPI au rouge plusieurs périodes de suite. Le moteur dit SI l'événement est dû et
 * avec quelle clé ; l'API le publie (idempotent par clé).
 */

/** Paliers (en jours depuis l'envoi) d'un questionnaire sans réponse : J+3, J+7, J+10, J+14. */
export const PALIERS_SANS_REPONSE_JOURS = [3, 7, 10, 14] as const;

const JOUR_MS = 86_400_000;

/** Instant ISO 8601 complet : date, heure, puis « Z » ou un décalage (jamais sans fuseau). */
const INSTANT_ISO =
  /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

/** Millisecondes d'un instant ISO avec fuseau ; `ENTREE_INVALIDE` pour toute autre forme. */
function instantISO(valeur: string): number {
  const m = INSTANT_ISO.exec(valeur);
  const ms = m && analyserDateISO(m[1]!).valide ? Date.parse(valeur) : Number.NaN;
  if (Number.isNaN(ms)) {
    throw new ErreurAutomatisation(
      "ENTREE_INVALIDE",
      "Instant invalide : format ISO 8601 avec fuseau (Z ou décalage) attendu.",
    );
  }
  return ms;
}

/**
 * Jours entiers écoulés entre deux instants ISO 8601 AVEC fuseau (« Z » ou décalage : une
 * chaîne sans fuseau dépendrait de la machine et est refusée). 0 si `jusqua` précède `depuis`.
 */
export function joursEcoules(depuis: string, jusqua: string): number {
  const a = instantISO(depuis);
  const b = instantISO(jusqua);
  return b <= a ? 0 : Math.floor((b - a) / JOUR_MS);
}

/** Plus haut palier atteint (≤ jours), ou null avant le premier. */
export function palierAtteint(jours: number, paliers: readonly number[]): number | null {
  if (!Number.isFinite(jours)) {
    throw new ErreurAutomatisation("ENTREE_INVALIDE", "Nombre de jours invalide.");
  }
  let palier: number | null = null;
  for (const p of paliers) if (p <= jours && (palier === null || p > palier)) palier = p;
  return palier;
}

/** Statut d'une période close d'un KPI (moteur KPI : vert, orange, rouge, non_mesure…). */
export interface PeriodeStatut {
  readonly cle: string;
  readonly statut: string;
}

export interface SerieRouge {
  /** Nombre de périodes rouges consécutives terminant la série mesurée. */
  readonly periodes: number;
  /** Clé de la dernière période mesurée (rouge), clé d'idempotence de l'événement. */
  readonly periode: string;
}

/**
 * Série rouge en fin de suivi : les périodes closes NON MESURÉES de la fin sont écartées (la
 * mesure peut arriver en retard), puis on compte les périodes rouges consécutives. `null` si
 * la dernière période mesurée n'est pas rouge ou si la série est plus courte que `minimum`.
 */
export function serieRougeFinale(
  periodes: readonly PeriodeStatut[],
  minimum = 2,
): SerieRouge | null {
  if (!Number.isInteger(minimum) || minimum < 1) {
    throw new ErreurAutomatisation("ENTREE_INVALIDE", "Longueur de série invalide.");
  }
  let fin = periodes.length - 1;
  while (fin >= 0 && periodes[fin]!.statut === "non_mesure") fin -= 1;
  let n = 0;
  for (let i = fin; i >= 0 && periodes[i]!.statut === "rouge"; i--) n += 1;
  return n >= minimum ? { periodes: n, periode: periodes[fin]!.cle } : null;
}
