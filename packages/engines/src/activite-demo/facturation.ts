/**
 * Facture et encaissement de la semaine (D6, DT8, DT16) : ordre d'essai des sources de facture
 * (rotation entre missions), date d'émission compatible avec la numérotation chronologique de
 * l'exercice, et choix de la facture à solder. Pur ; aucun montant n'est calculé ici.
 */
import { ajouterJours, type DateISO, ecartJours, versJourUTC } from "../planning/dates";
import {
  PARAMETRES_ACTIVITE_DEMO,
  type ParametresActiviteDemo,
  comparerTexteDemo,
} from "./parametres";

/** Échéance non liée, due au plus tard le jour de la facture. */
export interface SourceEcheanceDemo {
  type: "echeance";
  missionId: string;
  echeanceId: string;
  statut: "a_facturer" | "prevue";
  datePrevue: DateISO;
}

/** Temps validés non facturés d'une mission en régie. */
export interface SourceRegieDemo {
  type: "regie";
  missionId: string;
}

export type SourceFactureDemo = SourceEcheanceDemo | SourceRegieDemo;

/** Rang d'une source au sein d'une mission : échéance à facturer, échéance prévue, puis régie. */
function rang(s: SourceFactureDemo): number {
  if (s.type === "regie") return 2;
  return s.statut === "a_facturer" ? 0 : 1;
}

function datePrevue(s: SourceFactureDemo): string {
  return s.type === "echeance" ? s.datePrevue : "";
}

function idSource(s: SourceFactureDemo): string {
  return s.type === "echeance" ? s.echeanceId : s.missionId;
}

function comparerSources(
  a: SourceFactureDemo,
  b: SourceFactureDemo,
  derniereFacture: Readonly<Record<string, DateISO>>,
): number {
  const derniere = (x: SourceFactureDemo): string => derniereFacture[x.missionId] ?? "";
  return (
    comparerTexteDemo(derniere(a), derniere(b)) ||
    rang(a) - rang(b) ||
    comparerTexteDemo(datePrevue(a), datePrevue(b)) ||
    comparerTexteDemo(idSource(a), idSource(b))
  );
}

/**
 * Sources dans l'ordre d'essai : mission la moins récemment facturée d'abord (jamais facturée en
 * tête), puis échéance à facturer, échéance prévue, régie, puis date prévue, puis id. Une échéance
 * prévue après `jour` est écartée : elle n'est pas encore due.
 */
export function ordonnerSourcesFactureDemo(
  s: readonly SourceFactureDemo[],
  derniereFacture: Readonly<Record<string, DateISO>>,
  jour: DateISO,
): SourceFactureDemo[] {
  const j = versJourUTC(jour);
  const dues = s.filter((x) => x.type === "regie" || versJourUTC(x.datePrevue) <= j);
  return dues.sort((a, b) => comparerSources(a, b, derniereFacture));
}

/**
 * Date d'émission de la facture de la semaine : `jour`, sauf si une facture de l'exercice a déjà
 * été émise après lui (la numérotation suit l'ordre des dates : `null`, jamais d'antidatage).
 */
export function dateEmissionAdmissibleDemo(
  jour: DateISO,
  derniereEmissionExercice: DateISO | null,
): DateISO | null {
  const j = versJourUTC(jour);
  if (derniereEmissionExercice === null) return jour;
  return versJourUTC(derniereEmissionExercice) <= j ? jour : null;
}

export interface FactureOuverteDemo {
  id: string;
  dateEmission: DateISO;
  soldeMineur: number;
  /** Émise par le job (marqueur `activite_demo.facture`). */
  emiseParJob: boolean;
  /** Échéance de la facture (délai de paiement du cabinet), si elle est connue. */
  dateEcheance?: DateISO | null;
}

const plusAncienne = (a: FactureOuverteDemo, b: FactureOuverteDemo): number =>
  comparerTexteDemo(a.dateEmission, b.dateEmission) || comparerTexteDemo(a.id, b.id);

/**
 * Facture à solder la semaine de `lundi` (DT8) : la plus ancienne de la première catégorie non
 * vide parmi (0) les factures du job échues ou qui le seront avant la semaine suivante, (1) les
 * factures du job âgées d'au moins 21 jours, (2) les factures d'une autre origine, (3) les
 * factures du job âgées d'au moins 7 jours. Une facture émise depuis le lundi, ou sans solde,
 * n'est jamais choisie. Au délai par défaut (30 j), une facture du job est soldée avant son
 * échéance ; un délai raccourci par le cabinet la fait passer en tête (0), pour qu'elle soit
 * soldée avant la relance automatique de FIN-09, qui part 7 jours après l'échéance.
 */
export function choisirFactureASolderDemo(
  f: readonly FactureOuverteDemo[],
  lundi: DateISO,
  jour: DateISO,
  p: ParametresActiviteDemo = PARAMETRES_ACTIVITE_DEMO,
): string | null {
  versJourUTC(lundi);
  versJourUTC(jour);
  const ouvertes = f.filter((x) => x.soldeMineur > 0 && ecartJours(x.dateEmission, lundi) > 0);
  const age = (x: FactureOuverteDemo): number => ecartJours(x.dateEmission, jour);
  const { cibleJours, minimumJours } = p.encaissement;
  const semaineSuivante = ajouterJours(jour, 7);
  const echueBientot = (x: FactureOuverteDemo): boolean =>
    x.dateEcheance != null && ecartJours(x.dateEcheance, semaineSuivante) >= 0;
  const categories = [
    ouvertes.filter((x) => x.emiseParJob && echueBientot(x)),
    ouvertes.filter((x) => x.emiseParJob && age(x) >= cibleJours),
    ouvertes.filter((x) => !x.emiseParJob),
    ouvertes.filter((x) => x.emiseParJob && age(x) >= minimumJours),
  ];
  for (const c of categories) {
    const choisie = c.sort(plusAncienne)[0];
    if (choisie !== undefined) return choisie.id;
  }
  return null;
}
