/**
 * Plan de financement (RED-06, lot 2) : emplois et ressources par période, totaux par période et
 * cumulés, solde, équilibre ou insuffisance, couverture en points de base. Tout est exact
 * (entiers, `BigInt`), rien n'est stocké (les totaux sont recalculés à la lecture).
 *
 * CHOIX DOCUMENTÉS
 * - Périodes : l'ANNÉE (12 mois) ou le SEMESTRE (6 mois) au choix de la version, 1 à 8 périodes
 *   consécutives, à partir d'un premier jour de mois (`dateDebut`). La période k couvre les mois
 *   civils [début + (k−1)×pas, début + k×pas[.
 * - Solde d'une période = ressources − emplois. « equilibre » : solde ≥ 0 (les ressources
 *   couvrent les emplois, un solde positif est une marge) ; « insuffisance » : solde < 0.
 *   Couverture = ressources ÷ emplois en points de base (10 000 = 1), nulle (null) sans emploi.
 * - Les montants sont ceux du client, dans la devise du dossier ; les cumuls s'additionnent
 *   période après période, sans actualisation.
 * - `proposerLignesFinancement` PROPOSE des emplois (besoin de financement de la trésorerie à
 *   13 semaines ; échéances restantes des accords créanciers) : elle n'écrit rien, le consultant
 *   retient ce qu'il veut.
 */
import { type DateISO, dateISODepuisJourUTC, jourUTCDepuisComposantes } from "../commun/dates";
import { MONTANT_RED_MAX, exigerEntier, jourDe, rapportPb, versNombreSur } from "./commun";
import { ErreurRedressement } from "./erreurs";

export const TYPES_PERIODE_FINANCEMENT_RED = ["annee", "semestre"] as const;
export type TypePeriodeFinancementRed = (typeof TYPES_PERIODE_FINANCEMENT_RED)[number];

export const EMPLOIS_FINANCEMENT_RED = [
  "remboursement_dettes_accords",
  "besoin_fonds_roulement",
  "investissements",
  "charges_restructuration",
] as const;
export const RESSOURCES_FINANCEMENT_RED = [
  "apport_associes",
  "nouveaux_concours_bancaires",
  "cessions_actifs",
  "report_echeances_obtenu",
  "autofinancement",
] as const;
export type EmploiFinancementRed = (typeof EMPLOIS_FINANCEMENT_RED)[number];
export type RessourceFinancementRed = (typeof RESSOURCES_FINANCEMENT_RED)[number];
export type SensFinancementRed = "emploi" | "ressource";

export const PERIODES_FINANCEMENT_MAX = 8;
export const LIGNES_FINANCEMENT_MAX = 200;

const NATURES_PAR_SENS: Readonly<Record<SensFinancementRed, readonly string[]>> = {
  emploi: EMPLOIS_FINANCEMENT_RED,
  ressource: RESSOURCES_FINANCEMENT_RED,
};
const MOIS_PAR_TYPE: Readonly<Record<TypePeriodeFinancementRed, number>> = {
  annee: 12,
  semestre: 6,
};

export interface LigneFinancement {
  /** 1..nombrePeriodes. */
  readonly periode: number;
  readonly sens: SensFinancementRed;
  /** Doit appartenir à la liste du sens. */
  readonly nature: string;
  /** Entier 1..10^13. */
  readonly montant: number;
}
export interface CadreFinancement {
  /** Premier jour d'un mois. */
  readonly dateDebut: DateISO;
  readonly typePeriode: TypePeriodeFinancementRed;
  /** 1..8. */
  readonly nombrePeriodes: number;
}
export interface EntreeFinancement extends CadreFinancement {
  /** Au plus 200. */
  readonly lignes: readonly LigneFinancement[];
}

export type StatutPeriodeFinancement = "equilibre" | "insuffisance";

export interface PeriodeFinancement {
  readonly periode: number;
  readonly debut: DateISO;
  readonly fin: DateISO;
  readonly emplois: number;
  readonly ressources: number;
  /** Ressources − emplois. */
  readonly solde: number;
  readonly statut: StatutPeriodeFinancement;
  /** Ressources ÷ emplois (pb) ; null sans emploi. */
  readonly couverturePb: number | null;
  readonly cumulEmplois: number;
  readonly cumulRessources: number;
  readonly soldeCumule: number;
  readonly couvertureCumuleePb: number | null;
  readonly statutCumule: StatutPeriodeFinancement;
  /** Totaux par nature (lignes non nulles), emplois puis ressources, dans l'ordre des listes. */
  readonly parNature: readonly {
    readonly sens: SensFinancementRed;
    readonly nature: string;
    readonly montant: number;
  }[];
}
export interface ResultatFinancement {
  readonly periodes: readonly PeriodeFinancement[];
  readonly totaux: {
    readonly emplois: number;
    readonly ressources: number;
    readonly solde: number;
  };
  readonly couvertureTotalePb: number | null;
  /** Numéros des périodes en insuffisance. */
  readonly periodesInsuffisance: readonly number[];
  readonly premierePeriodeInsuffisance: number | null;
  /** max(0, −min(solde cumulé)) : le plus gros manque cumulé à couvrir. */
  readonly insuffisanceMaximaleCumulee: number;
  /** Aucune période en insuffisance. */
  readonly equilibre: boolean;
}

const invalide = (message: string): never => {
  throw new ErreurRedressement("ENTREE_INVALIDE", message);
};

function validerCadre(cadre: CadreFinancement): { annee: number; mois: number; pas: number } {
  if (!(TYPES_PERIODE_FINANCEMENT_RED as readonly string[]).includes(cadre.typePeriode)) {
    invalide("Type de période inconnu (année ou semestre).");
  }
  exigerEntier(
    cadre.nombrePeriodes,
    1,
    PERIODES_FINANCEMENT_MAX,
    "ENTREE_INVALIDE",
    "Nombre de périodes",
  );
  jourDe(cadre.dateDebut, "Début du plan");
  if (cadre.dateDebut.slice(8, 10) !== "01") {
    throw new ErreurRedressement(
      "DATE_INVALIDE",
      "Début du plan : un premier jour de mois est attendu.",
    );
  }
  if (cadre.dateDebut < "2000-01-01" || cadre.dateDebut > "2100-12-31") {
    throw new ErreurRedressement(
      "DATE_INVALIDE",
      "Début du plan : date comprise entre 2000 et 2100.",
    );
  }
  return {
    annee: Number(cadre.dateDebut.slice(0, 4)),
    mois: Number(cadre.dateDebut.slice(5, 7)),
    pas: MOIS_PAR_TYPE[cadre.typePeriode],
  };
}

/** Bornes (début, fin incluse) de chaque période du cadre. */
export function periodesFinancement(
  cadre: CadreFinancement,
): readonly { periode: number; debut: DateISO; fin: DateISO }[] {
  const { annee, mois, pas } = validerCadre(cadre);
  const resultat: { periode: number; debut: DateISO; fin: DateISO }[] = [];
  for (let k = 1; k <= cadre.nombrePeriodes; k++) {
    const debut = jourUTCDepuisComposantes(annee, mois + (k - 1) * pas, 1);
    const suivant = jourUTCDepuisComposantes(annee, mois + k * pas, 1);
    resultat.push({
      periode: k,
      debut: dateISODepuisJourUTC(debut),
      fin: dateISODepuisJourUTC(suivant - 1),
    });
  }
  return resultat;
}

/** Valide les lignes d'un plan (nature du sens, période du cadre, montant entier borné). */
export function validerLignesFinancement(
  lignes: readonly LigneFinancement[],
  nombrePeriodes: number,
): void {
  if (!Array.isArray(lignes) || lignes.length > LIGNES_FINANCEMENT_MAX) {
    invalide(`Trop de lignes de financement (${LIGNES_FINANCEMENT_MAX} au plus).`);
  }
  for (const l of lignes) {
    exigerEntier(l.periode, 1, nombrePeriodes, "ENTREE_INVALIDE", "Période");
    if (l.sens !== "emploi" && l.sens !== "ressource") invalide("Sens de ligne inconnu.");
    if (!NATURES_PAR_SENS[l.sens].includes(l.nature)) invalide("Nature hors de la liste du sens.");
    exigerEntier(l.montant, 1, MONTANT_RED_MAX, "ENTREE_INVALIDE", "Montant d'une ligne");
  }
}

const statutDe = (solde: bigint): StatutPeriodeFinancement =>
  solde >= 0n ? "equilibre" : "insuffisance";
const couverture = (ressources: bigint, emplois: bigint): number | null =>
  emplois === 0n ? null : rapportPb(ressources, emplois);

/** Emplois, ressources, soldes, couvertures et cumuls par période. */
export function calculerPlanFinancement(entree: EntreeFinancement): ResultatFinancement {
  const bornes = periodesFinancement(entree);
  validerLignesFinancement(entree.lignes, entree.nombrePeriodes);
  const periodes: PeriodeFinancement[] = [];
  let cumulEmplois = 0n;
  let cumulRessources = 0n;
  let minimumCumule = 0n;
  const insuffisances: number[] = [];
  for (const b of bornes) {
    let emplois = 0n;
    let ressources = 0n;
    const parNature = new Map<string, bigint>();
    for (const l of entree.lignes) {
      if (l.periode !== b.periode) continue;
      const m = BigInt(l.montant);
      if (l.sens === "emploi") emplois += m;
      else ressources += m;
      const cle = `${l.sens}|${l.nature}`;
      parNature.set(cle, (parNature.get(cle) ?? 0n) + m);
    }
    const solde = ressources - emplois;
    cumulEmplois += emplois;
    cumulRessources += ressources;
    const soldeCumule = cumulRessources - cumulEmplois;
    if (soldeCumule < minimumCumule) minimumCumule = soldeCumule;
    if (solde < 0n) insuffisances.push(b.periode);
    const detail: { sens: SensFinancementRed; nature: string; montant: number }[] = [];
    for (const sens of ["emploi", "ressource"] as const) {
      for (const nature of NATURES_PAR_SENS[sens]) {
        const m = parNature.get(`${sens}|${nature}`);
        if (m !== undefined) detail.push({ sens, nature, montant: versNombreSur(m) });
      }
    }
    periodes.push({
      periode: b.periode,
      debut: b.debut,
      fin: b.fin,
      emplois: versNombreSur(emplois),
      ressources: versNombreSur(ressources),
      solde: versNombreSur(solde),
      statut: statutDe(solde),
      couverturePb: couverture(ressources, emplois),
      cumulEmplois: versNombreSur(cumulEmplois),
      cumulRessources: versNombreSur(cumulRessources),
      soldeCumule: versNombreSur(soldeCumule),
      couvertureCumuleePb: couverture(cumulRessources, cumulEmplois),
      statutCumule: statutDe(soldeCumule),
      parNature: detail,
    });
  }
  return {
    periodes,
    totaux: {
      emplois: versNombreSur(cumulEmplois),
      ressources: versNombreSur(cumulRessources),
      solde: versNombreSur(cumulRessources - cumulEmplois),
    },
    couvertureTotalePb: couverture(cumulRessources, cumulEmplois),
    periodesInsuffisance: insuffisances,
    premierePeriodeInsuffisance: insuffisances[0] ?? null,
    insuffisanceMaximaleCumulee: versNombreSur(-minimumCumule),
    equilibre: insuffisances.length === 0,
  };
}

/* ----- Proposition d'emplois ----- */

export interface EcheanceFinancement {
  readonly echeanceId: string;
  readonly creancierId: string;
  readonly date: DateISO;
  /** Montant restant dû (> 0). */
  readonly montant: number;
}
export interface EntreePropositionFinancement extends CadreFinancement {
  /** Besoin de financement de la trésorerie à 13 semaines et date de son point bas, ou null. */
  readonly besoin: { readonly montant: number; readonly date: DateISO } | null;
  readonly echeances: readonly EcheanceFinancement[];
}
export type OrigineLigneProposee = "tresorerie" | "accords";
export interface LigneProposeeFinancement {
  readonly periode: number;
  readonly sens: "emploi";
  readonly nature: EmploiFinancementRed;
  readonly montant: number;
  readonly origine: OrigineLigneProposee;
  /** Nombre d'échéances regroupées (accords) ; 0 pour le besoin de trésorerie. */
  readonly nombreEcheances: number;
}
export interface PropositionFinancement {
  readonly lignes: readonly LigneProposeeFinancement[];
  /** Échéances datées avant le début du plan. */
  readonly anterieures: number;
  /** Échéances au-delà de la dernière période. */
  readonly ulterieures: number;
  /** Le point bas de la trésorerie tombe hors du plan : besoin non reporté. */
  readonly besoinHorsPlan: boolean;
}

/**
 * Période (1..n) qui contient une date, ou « avant » / « apres » le plan. Le début du plan est un
 * premier jour de mois : l'écart en mois civils suffit.
 */
function periodeDe(
  date: DateISO,
  annee: number,
  mois: number,
  pas: number,
  nombre: number,
): number | "avant" | "apres" {
  jourDe(date, "Date");
  const ecart = (Number(date.slice(0, 4)) - annee) * 12 + (Number(date.slice(5, 7)) - mois);
  if (ecart < 0) return "avant";
  const periode = Math.floor(ecart / pas) + 1;
  return periode > nombre ? "apres" : periode;
}

/** Propose des emplois (n'écrit rien) : besoin de la trésorerie, échéances d'accords. */
export function proposerLignesFinancement(
  entree: EntreePropositionFinancement,
): PropositionFinancement {
  const { annee, mois, pas } = validerCadre(entree);
  const lignes: LigneProposeeFinancement[] = [];
  let besoinHorsPlan = false;
  if (entree.besoin !== null && entree.besoin.montant > 0) {
    exigerEntier(
      entree.besoin.montant,
      1,
      MONTANT_RED_MAX,
      "ENTREE_INVALIDE",
      "Besoin de financement",
    );
    const p = periodeDe(entree.besoin.date, annee, mois, pas, entree.nombrePeriodes);
    if (typeof p === "number") {
      lignes.push({
        periode: p,
        sens: "emploi",
        nature: "besoin_fonds_roulement",
        montant: entree.besoin.montant,
        origine: "tresorerie",
        nombreEcheances: 0,
      });
    } else {
      besoinHorsPlan = true;
    }
  }
  const parPeriode = new Map<number, { total: bigint; nombre: number }>();
  let anterieures = 0;
  let ulterieures = 0;
  for (const e of entree.echeances) {
    exigerEntier(e.montant, 1, MONTANT_RED_MAX, "ENTREE_INVALIDE", "Montant d'échéance");
    const p = periodeDe(e.date, annee, mois, pas, entree.nombrePeriodes);
    if (p === "avant") {
      anterieures += 1;
    } else if (p === "apres") {
      ulterieures += 1;
    } else {
      const courant = parPeriode.get(p) ?? { total: 0n, nombre: 0 };
      parPeriode.set(p, { total: courant.total + BigInt(e.montant), nombre: courant.nombre + 1 });
    }
  }
  for (const [periode, { total, nombre }] of [...parPeriode].sort((a, b) => a[0] - b[0])) {
    lignes.push({
      periode,
      sens: "emploi",
      nature: "remboursement_dettes_accords",
      montant: versNombreSur(total),
      origine: "accords",
      nombreEcheances: nombre,
    });
  }
  // Par période ; à période égale, le besoin de trésorerie avant les accords.
  lignes.sort(
    (a, b) =>
      a.periode - b.periode || (a.origine === b.origine ? 0 : a.origine === "tresorerie" ? -1 : 1),
  );
  return { lignes, anterieures, ulterieures, besoinHorsPlan };
}
