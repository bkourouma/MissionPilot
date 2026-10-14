/**
 * Plan de redressement à deux volets (RED-05, RED-07) : transitions du kanban, avancement,
 * retards, anomalies de fenêtre, impacts cumulés, contenu canonique d'une version de plan et
 * écart avec la version validée.
 *
 * Ce qui fait le PLAN (`ActionCanonique`) n'est ni le statut ni le rang : le kanban bouge
 * librement sans invalider une version validée. Une action abandonnée sort du plan.
 */
import type { DateISO } from "../commun/dates";
import { ajouterMois } from "../finance/dates";
import { exigerEntier, jourDe, rapportPb, versNombreSur } from "./commun";
import { ErreurRedressement } from "./erreurs";
import { DOMAINES_URGENCE, type DomaineUrgence } from "./urgence";

export const VOLETS_PLAN_RED = ["quick_win", "restructuration"] as const;
export type VoletPlanRed = (typeof VOLETS_PLAN_RED)[number];
export const STATUTS_ACTION_RED = [
  "a_faire",
  "en_cours",
  "bloquee",
  "terminee",
  "abandonnee",
] as const;
export type StatutActionRed = (typeof STATUTS_ACTION_RED)[number];
/** PRD : quick wins à 3–6 mois, restructuration à 6–24 mois. Bornes en mois depuis la date de référence. */
export const FENETRE_QUICK_WIN_MOIS = { max: 6 } as const;
export const FENETRE_RESTRUCTURATION_MOIS = { min: 6, max: 24 } as const;

export interface ActionPlan {
  readonly numero: number;
  readonly titre: string;
  readonly volet: VoletPlanRed;
  readonly domaine: DomaineUrgence;
  readonly echeance: DateISO;
  readonly statut: StatutActionRed;
  readonly rang: number;
  readonly responsableId: string;
  readonly levierCode: string | null;
  readonly impactTresorerieUnique: number | null;
  readonly impactResultatAnnuel: number | null;
}

const TRANSITIONS: Readonly<Record<StatutActionRed, readonly StatutActionRed[]>> = {
  a_faire: ["en_cours", "bloquee", "terminee", "abandonnee"],
  en_cours: ["bloquee", "terminee", "abandonnee"],
  bloquee: ["en_cours", "abandonnee"],
  terminee: [],
  abandonnee: [],
};

/** Transition admise ; le maintien du même statut et toute sortie de terminee / abandonnee : faux. */
export function transitionActionAdmise(de: StatutActionRed, vers: StatutActionRed): boolean {
  return (TRANSITIONS[de] ?? []).includes(vers);
}

export interface Kanban {
  readonly colonnes: Readonly<
    Record<"a_faire" | "en_cours" | "bloquee" | "terminee", readonly ActionPlan[]>
  >;
  readonly abandonnees: readonly ActionPlan[];
}

const comparerActions = (a: ActionPlan, b: ActionPlan): number =>
  a.rang - b.rang ||
  (a.echeance < b.echeance ? -1 : a.echeance > b.echeance ? 1 : 0) ||
  a.numero - b.numero;

/** Colonnes du kanban, triées par rang, puis échéance, puis numéro ; abandonnées à part. */
export function organiserKanban(actions: readonly ActionPlan[]): Kanban {
  const triees = [...actions].sort(comparerActions);
  const parStatut = (statut: StatutActionRed): ActionPlan[] =>
    triees.filter((a) => a.statut === statut);
  return {
    colonnes: {
      a_faire: parStatut("a_faire"),
      en_cours: parStatut("en_cours"),
      bloquee: parStatut("bloquee"),
      terminee: parStatut("terminee"),
    },
    abandonnees: parStatut("abandonnee"),
  };
}

export type CodeAnomaliePlan =
  "AUCUNE_ACTION" | "AUCUN_QUICK_WIN" | "QUICK_WIN_HORS_FENETRE" | "RESTRUCTURATION_HORS_FENETRE";
export interface AnomaliePlan {
  readonly code: CodeAnomaliePlan;
  readonly numero: number | null;
  readonly bloquante: boolean;
}
export interface AvancementVolet {
  readonly total: number;
  readonly terminees: number;
  readonly abandonnees: number;
  readonly enRetard: number;
  /** Terminées / (total − abandonnées), pb ; null si dénominateur nul. */
  readonly avancementPb: number | null;
}
export interface EvaluationPlan {
  readonly parVolet: Readonly<Record<VoletPlanRed, AvancementVolet>>;
  /** Numéros ; statut a_faire / en_cours / bloquee et échéance < date de référence. */
  readonly enRetard: readonly number[];
  readonly anomalies: readonly AnomaliePlan[];
  readonly bloquantsValidation: readonly CodeAnomaliePlan[];
  /** Σ des actions non abandonnées (null = 0). */
  readonly impactTresorerieUnique: number;
  readonly impactResultatAnnuel: number;
}

function validerActions(actions: readonly ActionPlan[]): void {
  const numeros = new Set<number>();
  for (const a of actions) {
    exigerEntier(a.numero, 1, 1_000_000, "PLAN_INVALIDE", "Numéro d'action");
    if (numeros.has(a.numero)) {
      throw new ErreurRedressement("PLAN_INVALIDE", "Deux actions portent le même numéro.");
    }
    numeros.add(a.numero);
    if (!(VOLETS_PLAN_RED as readonly string[]).includes(a.volet)) {
      throw new ErreurRedressement("PLAN_INVALIDE", "Volet inconnu.");
    }
    if (!(STATUTS_ACTION_RED as readonly string[]).includes(a.statut)) {
      throw new ErreurRedressement("PLAN_INVALIDE", "Statut d'action inconnu.");
    }
    if (!(DOMAINES_URGENCE as readonly string[]).includes(a.domaine)) {
      throw new ErreurRedressement("PLAN_INVALIDE", "Domaine inconnu.");
    }
    jourDe(a.echeance, "Échéance d'action");
    for (const impact of [a.impactTresorerieUnique, a.impactResultatAnnuel]) {
      if (impact !== null) {
        exigerEntier(
          impact,
          -Number.MAX_SAFE_INTEGER,
          Number.MAX_SAFE_INTEGER,
          "PLAN_INVALIDE",
          "Impact",
        );
      }
    }
  }
}

/** Avancement, retards, anomalies de fenêtre et impacts cumulés du plan. */
export function evaluerPlanRedressement(
  actions: readonly ActionPlan[],
  dateReference: DateISO,
): EvaluationPlan {
  validerActions(actions);
  const jourReference = jourDe(dateReference, "Date de référence");
  const borneQuickWin = ajouterMois(dateReference, FENETRE_QUICK_WIN_MOIS.max);
  const borneBasse = ajouterMois(dateReference, FENETRE_RESTRUCTURATION_MOIS.min);
  const borneHaute = ajouterMois(dateReference, FENETRE_RESTRUCTURATION_MOIS.max);

  const actives = actions.filter((a) => a.statut !== "abandonnee");
  const enRetardAction = (a: ActionPlan): boolean =>
    (a.statut === "a_faire" || a.statut === "en_cours" || a.statut === "bloquee") &&
    jourDe(a.echeance) < jourReference;

  const avancement = (volet: VoletPlanRed): AvancementVolet => {
    const duVolet = actions.filter((a) => a.volet === volet);
    const total = duVolet.length;
    const abandonnees = duVolet.filter((a) => a.statut === "abandonnee").length;
    const terminees = duVolet.filter((a) => a.statut === "terminee").length;
    return {
      total,
      terminees,
      abandonnees,
      enRetard: duVolet.filter(enRetardAction).length,
      avancementPb:
        total - abandonnees === 0
          ? null
          : rapportPb(BigInt(terminees), BigInt(total - abandonnees)),
    };
  };

  const anomalies: AnomaliePlan[] = [];
  if (actives.length === 0)
    anomalies.push({ code: "AUCUNE_ACTION", numero: null, bloquante: true });
  if (!actives.some((a) => a.volet === "quick_win")) {
    anomalies.push({ code: "AUCUN_QUICK_WIN", numero: null, bloquante: true });
  }
  for (const a of [...actives].sort((x, y) => x.numero - y.numero)) {
    if (a.volet === "quick_win" && a.echeance > borneQuickWin) {
      anomalies.push({ code: "QUICK_WIN_HORS_FENETRE", numero: a.numero, bloquante: false });
    }
    if (a.volet === "restructuration" && (a.echeance <= borneBasse || a.echeance > borneHaute)) {
      anomalies.push({ code: "RESTRUCTURATION_HORS_FENETRE", numero: a.numero, bloquante: false });
    }
  }

  let tresorerie = 0n;
  let resultat = 0n;
  for (const a of actives) {
    tresorerie += BigInt(a.impactTresorerieUnique ?? 0);
    resultat += BigInt(a.impactResultatAnnuel ?? 0);
  }
  return {
    parVolet: {
      quick_win: avancement("quick_win"),
      restructuration: avancement("restructuration"),
    },
    enRetard: actions
      .filter(enRetardAction)
      .map((a) => a.numero)
      .sort((x, y) => x - y),
    anomalies,
    bloquantsValidation: anomalies.filter((a) => a.bloquante).map((a) => a.code),
    impactTresorerieUnique: versNombreSur(tresorerie),
    impactResultatAnnuel: versNombreSur(resultat),
  };
}

/** Ce qui fait le PLAN : ni statut ni rang (le kanban bouge librement). */
export interface ActionCanonique {
  readonly numero: number;
  readonly titre: string;
  readonly volet: VoletPlanRed;
  readonly domaine: DomaineUrgence;
  readonly echeance: DateISO;
  readonly responsableId: string;
  readonly levierCode: string | null;
  readonly impactTresorerieUnique: number | null;
  readonly impactResultatAnnuel: number | null;
}
export interface ContenuPlan {
  readonly version: 1;
  readonly actions: readonly ActionCanonique[];
}

/** Actions abandonnées exclues, triées par numéro. */
export function construireContenuPlan(actions: readonly ActionPlan[]): ContenuPlan {
  validerActions(actions);
  return {
    version: 1,
    actions: actions
      .filter((a) => a.statut !== "abandonnee")
      .sort((x, y) => x.numero - y.numero)
      .map((a) => ({
        numero: a.numero,
        titre: a.titre,
        volet: a.volet,
        domaine: a.domaine,
        echeance: a.echeance,
        responsableId: a.responsableId,
        levierCode: a.levierCode,
        impactTresorerieUnique: a.impactTresorerieUnique,
        impactResultatAnnuel: a.impactResultatAnnuel,
      })),
  };
}

/** JSON canonique de une action : clés dans un ordre fixe. */
const actionCanonique = (a: ActionCanonique): ActionCanonique => ({
  numero: a.numero,
  titre: a.titre,
  volet: a.volet,
  domaine: a.domaine,
  echeance: a.echeance,
  responsableId: a.responsableId,
  levierCode: a.levierCode,
  impactTresorerieUnique: a.impactTresorerieUnique,
  impactResultatAnnuel: a.impactResultatAnnuel,
});

/** JSON à clés dans un ordre fixe : l'API en prend le SHA-256. */
export function serialiserContenuPlan(c: ContenuPlan): string {
  return JSON.stringify({ version: c.version, actions: c.actions.map(actionCanonique) });
}

export interface EcartPlan {
  readonly ajoutees: readonly number[];
  readonly retirees: readonly number[];
  readonly modifiees: readonly number[];
}

/** Écart entre le contenu courant du plan et celui de la version validée. */
export function comparerContenusPlan(courant: ContenuPlan, valide: ContenuPlan): EcartPlan {
  const parNumero = (c: ContenuPlan): Map<number, string> =>
    new Map(c.actions.map((a) => [a.numero, JSON.stringify(actionCanonique(a))]));
  const actuel = parNumero(courant);
  const reference = parNumero(valide);
  const tri = (valeurs: number[]): number[] => valeurs.sort((x, y) => x - y);
  return {
    ajoutees: tri([...actuel.keys()].filter((n) => !reference.has(n))),
    retirees: tri([...reference.keys()].filter((n) => !actuel.has(n))),
    modifiees: tri(
      [...actuel.keys()].filter((n) => reference.has(n) && actuel.get(n) !== reference.get(n)),
    ),
  };
}
