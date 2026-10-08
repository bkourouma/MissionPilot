/**
 * Frise chronologique de l'entreprise cliente (DOS-06) : fusion triée et
 * STABLE d'événements venus de sources distinctes (notations, missions,
 * décisions, alertes, faits).
 *
 * Tri par date (la plus récente d'abord par défaut) ; à date égale, l'ordre
 * des sources passées en argument, puis l'ordre de chaque source, est
 * conservé : mêmes entrées, même frise. Une date est une date civile
 * « AAAA-MM-JJ » (lue comme minuit UTC) ou un horodatage ISO 8601 UTC
 * (« AAAA-MM-JJTHH:MM:SS(.mmm)Z »). La frise est tronquée à `limite`
 * événements ; `tronquee` le signale (jamais de coupe silencieuse).
 */
import { analyserDateISO } from "../commun/dates";
import { ErreurDossier } from "./erreurs";

export const TYPES_EVENEMENT_FRISE = ["notation", "mission", "decision", "alerte", "fait"] as const;
export type TypeEvenementFrise = (typeof TYPES_EVENEMENT_FRISE)[number];

/** Bornes : événements par frise renvoyée, événements reçus au total. */
export const FRISE_LIMITE_MAX = 1000;
export const FRISE_EVENEMENTS_MAX = 20_000;

export interface EvenementFrise {
  readonly type: TypeEvenementFrise;
  /** Identifiant de l'objet source (pour un lien), unique dans sa source. */
  readonly id: string;
  readonly date: string;
  readonly libelle: string;
}

export interface OptionsFrise {
  readonly ordre?: "recent_d_abord" | "ancien_d_abord";
  readonly limite?: number;
}

export interface Frise<T extends EvenementFrise> {
  readonly evenements: readonly T[];
  readonly total: number;
  readonly tronquee: boolean;
}

const HORODATAGE = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,6})?Z$/;

/** Clé de tri normalisée (millisecondes UTC) d'une date d'événement, ou erreur. */
export function cleDateFrise(date: string): number {
  if (typeof date !== "string") throw invalide("date absente");
  const m = HORODATAGE.exec(date);
  const jour = m ? (m[1] as string) : date;
  const analyse = analyserDateISO(jour);
  if (!analyse.valide) throw invalide(`date invalide « ${date.slice(0, 30)} »`);
  return m ? Date.parse(date) : analyse.jourUTC * 86_400_000;
}

function invalide(raison: string): ErreurDossier {
  return new ErreurDossier("EVENEMENT_INVALIDE", `Événement de frise invalide : ${raison}.`);
}

function controlerOptions(options: OptionsFrise): { descendant: boolean; limite: number } {
  const limite = options.limite ?? 200;
  if (!Number.isInteger(limite) || limite < 1 || limite > FRISE_LIMITE_MAX) {
    throw new ErreurDossier("OPTIONS_INVALIDES", `Limite de frise entre 1 et ${FRISE_LIMITE_MAX}.`);
  }
  const ordre = options.ordre ?? "recent_d_abord";
  if (ordre !== "recent_d_abord" && ordre !== "ancien_d_abord") {
    throw new ErreurDossier("OPTIONS_INVALIDES", "Ordre de frise inconnu.");
  }
  return { descendant: ordre === "recent_d_abord", limite };
}

/**
 * Fusionne les sources en une frise triée et stable. Lève `ErreurDossier` sur
 * un événement invalide (type inconnu, date illisible) ou des options hors bornes.
 */
export function construireFrise<T extends EvenementFrise>(
  sources: readonly (readonly T[])[],
  options: OptionsFrise = {},
): Frise<T> {
  const { descendant, limite } = controlerOptions(options);
  const tous: { e: T; cle: number; rang: number }[] = [];
  for (const source of sources) {
    for (const e of source) {
      if (tous.length >= FRISE_EVENEMENTS_MAX) {
        throw new ErreurDossier("OPTIONS_INVALIDES", `Au plus ${FRISE_EVENEMENTS_MAX} événements.`);
      }
      if (!(TYPES_EVENEMENT_FRISE as readonly string[]).includes(e.type))
        throw invalide("type inconnu");
      tous.push({ e, cle: cleDateFrise(e.date), rang: tous.length });
    }
  }
  tous.sort((a, b) =>
    a.cle === b.cle ? a.rang - b.rang : descendant ? b.cle - a.cle : a.cle - b.cle,
  );
  return {
    evenements: tous.slice(0, limite).map((x) => x.e),
    total: tous.length,
    tronquee: tous.length > limite,
  };
}
