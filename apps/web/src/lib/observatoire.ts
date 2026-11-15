import {
  aPermission,
  creerTraduire,
  LOCALES_INTL,
  OBSERVATOIRE_SECTEUR_LIBELLES,
  OBSERVATOIRE_TAILLE_LIBELLES,
  type ObservatoireAgregats,
  type ObservatoireCasePubliee,
  type ObservatoireEtatAdhesion,
  type ObservatoireSecteurCode,
  type Langue,
  type ObservatoireTailleCode,
  type Role,
} from "@missionpilot/shared";
import { ErreurApi, messageErreur } from "./api";
import type { Resultat } from "./saisie";

/**
 * Observatoire inter-cabinets (CAP-04) : chemins, droits, états de la page et mise en forme.
 * Aucun calcul métier : moyennes, médianes, quartiles, effectifs et publication des cases
 * viennent de l'API (moteur pur) ; ici on ne fait qu'afficher.
 */

export const CHEMIN_ADHESION = "/api/observatoire/adhesion";
export const CHEMIN_RETRAIT_ADHESION = "/api/observatoire/adhesion/retrait";
export const CHEMIN_CONTRIBUTIONS = "/api/observatoire/contributions";
export const CHEMIN_RESUME_CONTRIBUTIONS = "/api/observatoire/contributions/resume";
export const CHEMIN_AGREGATS = "/api/observatoire/agregats";

export const MOTIF_MAX = 500;

/** Seul indicateur ouvert à ce jour. */
export const OBSERVATOIRE_PAGE_INDICATEUR = "notation_score_global";

/** Principes affichés à tout cabinet (aucun chiffre : un non-adhérent ne voit rien de l'observatoire). */
export const PRINCIPES_OBSERVATOIRE: readonly string[] = [
  "L'adhésion est volontaire : elle reste désactivée tant qu'un associé ne l'a pas décidée.",
  "Seuls des agrégats anonymes sont partagés : jamais le nom d'un client, d'un cabinet ou d'une mission.",
  "Une case (secteur et taille) n'est publiée qu'à partir de 5 entreprises issues d'au moins 3 cabinets ; en dessous, elle reste masquée.",
  "Les agrégats sont gelés chaque mois : un versement n'apparaît qu'au mois suivant.",
  "Seuls les cabinets contributeurs consultent l'observatoire. Vous pouvez vous retirer et retirer vos contributions à tout moment.",
];

export const PRINCIPES_OBSERVATOIRE_EN: readonly string[] = [
  "Membership is voluntary: it stays disabled until a partner decides otherwise.",
  "Only anonymous aggregates are shared: never the name of a client, a firm or an engagement.",
  "A cell (sector and size) is only published from 5 companies coming from at least 3 firms; below that, it stays hidden.",
  "Aggregates are frozen every month: a contribution only appears the following month.",
  "Only contributing firms can view the observatory. You can withdraw and remove your contributions at any time.",
];

/** Principes de l'observatoire dans la langue demandée. */
export const principesObservatoire = (langue: Langue = "fr"): readonly string[] =>
  langue === "en" ? PRINCIPES_OBSERVATOIRE_EN : PRINCIPES_OBSERVATOIRE;

/* ----- Droits et états ----- */

export function peutConsulterObservatoire(roles: readonly Role[]): boolean {
  return aPermission(roles, "observatoire.lire");
}

export function peutAdhererObservatoire(roles: readonly Role[]): boolean {
  return aPermission(roles, "observatoire.adherer");
}

export type EtatPageObservatoire = "adherent" | "adhesion_possible" | "adhesion_a_demander";

/** Ce que la page propose selon l'adhésion du cabinet et les droits de la personne. */
export function etatPageObservatoire(
  adhesion: Pick<ObservatoireEtatAdhesion, "active">,
  roles: readonly Role[],
): EtatPageObservatoire {
  if (adhesion.active) return "adherent";
  return peutAdhererObservatoire(roles) ? "adhesion_possible" : "adhesion_a_demander";
}

/* ----- Libellés et mise en forme ----- */

const SECTEUR_LIBELLES_EN: Record<ObservatoireSecteurCode, string> = {
  agriculture: "Agriculture and agribusiness",
  industrie: "Industry, mining and energy",
  btp: "Construction and real estate",
  commerce: "Trade and distribution",
  services: "Services",
  numerique: "Digital and telecommunications",
  finance: "Banking, insurance and microfinance",
  autres: "Other sectors",
};

const TAILLE_LIBELLES_EN: Record<ObservatoireTailleCode, string> = {
  tpe: "Very small business",
  pme: "SME",
  eti: "Mid-size company",
  grande_entreprise: "Large company",
};

export function libelleSecteur(code: ObservatoireSecteurCode, langue: Langue = "fr"): string {
  return (langue === "en" ? SECTEUR_LIBELLES_EN : OBSERVATOIRE_SECTEUR_LIBELLES)[code] ?? code;
}

export function libelleTaille(code: ObservatoireTailleCode, langue: Langue = "fr"): string {
  return (langue === "en" ? TAILLE_LIBELLES_EN : OBSERVATOIRE_TAILLE_LIBELLES)[code] ?? code;
}

const MOIS: Record<Langue, Intl.DateTimeFormat> = {
  fr: new Intl.DateTimeFormat(LOCALES_INTL.fr, { month: "long", year: "numeric", timeZone: "UTC" }),
  en: new Intl.DateTimeFormat(LOCALES_INTL.en, { month: "long", year: "numeric", timeZone: "UTC" }),
};

/** « 2026-10-01 » → « octobre 2026 » ; chaîne illisible rendue telle quelle. */
export function formaterPeriode(periode: string | null | undefined, langue: Langue = "fr"): string {
  if (!periode) return "—";
  const d = new Date(`${periode.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? periode : MOIS[langue].format(d);
}

/** « au moins 15 entreprises » (effectif arrondi par l'API à la tranche de 5 inférieure). */
export function libelleEffectifMinimum(n: number, langue: Langue = "fr"): string {
  return creerTraduire(langue)(
    `au moins ${n} ${n > 1 ? "entreprises" : "entreprise"}`,
    `at least ${n} ${n > 1 ? "companies" : "company"}`,
  );
}

export function formaterEntier(n: number, langue: Langue = "fr"): string {
  return new Intl.NumberFormat(LOCALES_INTL[langue], { maximumFractionDigits: 0 }).format(n);
}

/** Tranches de la répartition (« 0-10 », … « 90-100 » pour 10 tranches). */
export function libellesTranches(nombre = 10): string[] {
  const pas = 100 / nombre;
  return Array.from({ length: nombre }, (_, i) => `${i * pas}-${(i + 1) * pas}`);
}

export interface LigneRepartition {
  tranche: string;
  pourcentage: number;
}

/** Associe chaque pourcentage (déjà arrondi par l'API) à sa tranche. */
export function lignesRepartition(repartition: readonly number[]): LigneRepartition[] {
  const tranches = libellesTranches(repartition.length);
  return repartition.map((pourcentage, i) => ({ tranche: tranches[i] ?? String(i), pourcentage }));
}

/** Libellé d'une case pour les lecteurs d'écran. */
export function libelleCase(
  c: Pick<ObservatoireCasePubliee, "secteur" | "taille">,
  langue: Langue = "fr",
): string {
  return `${libelleSecteur(c.secteur, langue)}, ${libelleTaille(c.taille, langue)}`;
}

/** Index secteur|taille → case, pour dessiner la grille complète fournie par l'API. */
export function indexerCases(
  cases: readonly ObservatoireCasePubliee[],
): Map<string, ObservatoireCasePubliee> {
  return new Map(cases.map((c) => [`${c.secteur}|${c.taille}`, c]));
}

export function trouverCase(
  index: Map<string, ObservatoireCasePubliee>,
  secteur: ObservatoireSecteurCode,
  taille: ObservatoireTailleCode,
): ObservatoireCasePubliee | undefined {
  return index.get(`${secteur}|${taille}`);
}

export function nombreCasesPubliees(a: Pick<ObservatoireAgregats, "cases">): number {
  return a.cases.filter((c) => c.statut === "publiee").length;
}

/* ----- Saisies ----- */

export type ChampAdhesion = "consentement" | "motif";

/** Adhésion : le consentement explicite est obligatoire ; motif facultatif. */
export function lireAdhesion(
  s: {
    consentement: boolean;
    motif: string;
  },
  langue: Langue = "fr",
): Resultat<{ consentement: true; motif?: string }, ChampAdhesion> {
  const t = creerTraduire(langue);
  if (!s.consentement) {
    return {
      ok: false,
      erreurs: {
        consentement: t(
          "Cochez la case pour confirmer l'adhésion de votre cabinet.",
          "Tick the box to confirm your firm's membership.",
        ),
      },
    };
  }
  const motif = s.motif.trim();
  if (motif.length > MOTIF_MAX) {
    return {
      ok: false,
      erreurs: {
        motif: t(
          `Le motif ne dépasse pas ${MOTIF_MAX} caractères.`,
          `The reason must not exceed ${MOTIF_MAX} characters.`,
        ),
      },
    };
  }
  return {
    ok: true,
    charge: motif === "" ? { consentement: true } : { consentement: true, motif },
  };
}

export function lireRetrait(
  s: { motif: string },
  langue: Langue = "fr",
): Resultat<{ motif?: string }, "motif"> {
  const motif = s.motif.trim();
  if (motif.length > MOTIF_MAX) {
    return {
      ok: false,
      erreurs: {
        motif: creerTraduire(langue)(
          `Le motif ne dépasse pas ${MOTIF_MAX} caractères.`,
          `The reason must not exceed ${MOTIF_MAX} characters.`,
        ),
      },
    };
  }
  return { ok: true, charge: motif === "" ? {} : { motif } };
}

const MESSAGES: Record<string, string> = {
  OBSERVATOIRE_RESERVE_ADHERENTS:
    "L'observatoire est réservé aux cabinets contributeurs : un associé doit d'abord adhérer.",
  OBSERVATOIRE_ADHESION_INACTIVE:
    "L'adhésion de votre cabinet n'est pas active : adhérez avant de verser des données.",
  OBSERVATOIRE_DEJA_ADHERENT: "Votre cabinet a déjà adhéré à l'observatoire.",
  OBSERVATOIRE_NON_ADHERENT: "Votre cabinet n'est pas adhérent de l'observatoire.",
};

const MESSAGES_EN: Record<string, string> = {
  OBSERVATOIRE_RESERVE_ADHERENTS:
    "The observatory is reserved for contributing firms: a partner must join first.",
  OBSERVATOIRE_ADHESION_INACTIVE:
    "Your firm's membership is not active: join before contributing data.",
  OBSERVATOIRE_DEJA_ADHERENT: "Your firm has already joined the observatory.",
  OBSERVATOIRE_NON_ADHERENT: "Your firm is not a member of the observatory.",
};

export function messageObservatoire(e: unknown, langue: Langue = "fr"): string {
  const table = langue === "en" ? MESSAGES_EN : MESSAGES;
  if (e instanceof ErreurApi && table[e.code]) return table[e.code] as string;
  return messageErreur(e, langue);
}

/* ----- 403 métier des agrégats ----- */

/** 403 de l'API : le cabinet adhère mais n'a encore rien versé (agrégats réservés aux contributeurs). */
export const CODE_CONTRIBUTION_REQUISE = "OBSERVATOIRE_CONTRIBUTION_REQUISE";
/** 403 de l'API : le cabinet n'est pas (ou plus) adhérent. */
export const CODE_RESERVE_ADHERENTS = "OBSERVATOIRE_RESERVE_ADHERENTS";

/**
 * 403 métier de GET /agrégats que la page affiche elle-même (information, pas un refus de
 * droits) : sans cela, `chargerServeur` redirigerait vers /acces-refuse.
 */
export const CODES_403_AGREGATS: readonly string[] = [
  CODE_CONTRIBUTION_REQUISE,
  CODE_RESERVE_ADHERENTS,
];

/** Vrai si l'échec de chargement des agrégats est un de ces états métier (à afficher en information). */
export function estEtatMetierAgregats(r: { ok: boolean; code?: string }): boolean {
  return !r.ok && r.code !== undefined && CODES_403_AGREGATS.includes(r.code);
}
