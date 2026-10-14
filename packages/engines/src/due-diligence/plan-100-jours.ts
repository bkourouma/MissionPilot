/**
 * Plan des 100 jours (DD-15, SPEC-3b §5.8) : phases, dates calendaires depuis la date de
 * l'opération, retards, taux de réalisation, actions sans responsable, sans indicateur (service
 * #4) ou sans initiative de plan (service #3). Fonction pure : la date du jour est un paramètre.
 */
import { diviserArrondi } from "../finance/calcul-exact";
import { ajouterJours, ecartJours, type DateISO } from "../planning/dates";
import { ErreurDueDiligence } from "./erreurs";
import { STATUTS_ACTION_100J, type StatutAction100j } from "./vocabulaire";

export const DUREE_PLAN_JOURS = 100;

/** Selon `jourDebut`, PROVISOIRE. */
export type PhasePlanDd = "jours_0_30" | "jours_31_60" | "jours_61_100";

export interface ActionCentJours {
  readonly id: string;
  readonly jourDebut: number;
  readonly jourFin: number;
  readonly statut: StatutAction100j;
  readonly responsableId: string | null;
  readonly reliePlan: boolean;
  readonly relieKpi: boolean;
}
export interface EntreePlanCentJours {
  readonly dateOperation: DateISO | null;
  readonly aujourdhui: DateISO;
  readonly actions: readonly ActionCentJours[];
}
export interface ActionPlanSynthese {
  readonly id: string;
  readonly phase: PhasePlanDd;
  readonly dateDebut: DateISO | null;
  readonly dateFin: DateISO | null;
  readonly enRetard: boolean;
}
export interface SynthesePlanCentJours {
  /** Tri : jourDebut, puis id. */
  readonly actions: readonly ActionPlanSynthese[];
  readonly parPhase: Readonly<Record<PhasePlanDd, { total: number; terminees: number }>>;
  readonly total: number;
  readonly terminees: number;
  /** terminées × 10 000 / total, arrondi ; `null` si total 0. */
  readonly tauxRealisationBp: number | null;
  readonly enRetard: readonly string[];
  /** aujourdhui − dateOperation, en jours (peut être < 0 ou > 100) ; `null` sans date. */
  readonly jourCourant: number | null;
  readonly sansResponsable: readonly string[];
  readonly sansIndicateur: readonly string[];
  readonly sansPlan: readonly string[];
}

function parametre(message: string): never {
  throw new ErreurDueDiligence("PARAMETRE_INVALIDE", message);
}

function verifierDate(date: DateISO, nom: string): void {
  try {
    ecartJours(date, date);
  } catch {
    throw new ErreurDueDiligence("DATE_INVALIDE", `${nom} : date AAAA-MM-JJ valide attendue.`);
  }
}

function jourValide(jour: number, nom: string): void {
  if (!Number.isInteger(jour) || jour < 0 || jour > DUREE_PLAN_JOURS) {
    parametre(`${nom} : entier de 0 à ${DUREE_PLAN_JOURS} attendu.`);
  }
}

function phaseDe(jourDebut: number): PhasePlanDd {
  if (jourDebut <= 30) return "jours_0_30";
  if (jourDebut <= 60) return "jours_31_60";
  return "jours_61_100";
}

export function planCentJours(entree: EntreePlanCentJours): SynthesePlanCentJours {
  const { dateOperation, aujourdhui } = entree;
  verifierDate(aujourdhui, "Date du jour");
  if (dateOperation !== null) verifierDate(dateOperation, "Date de l'opération");

  const ids = new Set<string>();
  for (const a of entree.actions) {
    if (ids.has(a.id)) {
      throw new ErreurDueDiligence("ENTREE_INVALIDE", `Action « ${a.id} » en double.`);
    }
    ids.add(a.id);
    jourValide(a.jourDebut, `Action « ${a.id} », jour de début`);
    jourValide(a.jourFin, `Action « ${a.id} », jour de fin`);
    if (a.jourDebut > a.jourFin)
      parametre(`Action « ${a.id} » : jour de début après le jour de fin.`);
    if (!(STATUTS_ACTION_100J as readonly string[]).includes(a.statut)) {
      parametre(`Action « ${a.id} » : statut inconnu « ${String(a.statut)} ».`);
    }
  }

  const triees = [...entree.actions].sort(
    (x, y) => x.jourDebut - y.jourDebut || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0),
  );
  const parPhase: Record<PhasePlanDd, { total: number; terminees: number }> = {
    jours_0_30: { total: 0, terminees: 0 },
    jours_31_60: { total: 0, terminees: 0 },
    jours_61_100: { total: 0, terminees: 0 },
  };
  const actions: ActionPlanSynthese[] = triees.map((a) => {
    const phase = phaseDe(a.jourDebut);
    parPhase[phase].total += 1;
    if (a.statut === "terminee") parPhase[phase].terminees += 1;
    const dateDebut = dateOperation === null ? null : ajouterJours(dateOperation, a.jourDebut);
    const dateFin = dateOperation === null ? null : ajouterJours(dateOperation, a.jourFin);
    // Dates ISO : l'ordre lexicographique est l'ordre chronologique.
    const enRetard = a.statut !== "terminee" && dateFin !== null && dateFin < aujourdhui;
    return { id: a.id, phase, dateDebut, dateFin, enRetard };
  });

  const total = triees.length;
  const terminees = triees.filter((a) => a.statut === "terminee").length;
  return {
    actions,
    parPhase,
    total,
    terminees,
    tauxRealisationBp:
      total === 0 ? null : Number(diviserArrondi(BigInt(terminees) * 10_000n, BigInt(total))),
    enRetard: actions.filter((a) => a.enRetard).map((a) => a.id),
    jourCourant: dateOperation === null ? null : ecartJours(dateOperation, aujourdhui),
    sansResponsable: triees.filter((a) => a.responsableId === null).map((a) => a.id),
    sansIndicateur: triees.filter((a) => !a.relieKpi).map((a) => a.id),
    sansPlan: triees.filter((a) => !a.reliePlan).map((a) => a.id),
  };
}
