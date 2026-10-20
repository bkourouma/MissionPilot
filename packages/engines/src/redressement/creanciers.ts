/**
 * Créanciers, accords et échéanciers (RED-12) : échéancier d'un accord (régulier ou
 * explicite), contrôle contre l'encours de la créance, situation recalculée à chaque lecture
 * (imputation des paiements dans l'ordre des échéances) et synthèse du passif.
 *
 * Aucun terme juridique : un « retard » est l'écart entre le montant échu d'un échéancier
 * convenu et le total payé. Exactitude : entiers, sommes en `BigInt`, arrondi demi
 * s'éloignant de zéro ; le reste d'arrondi d'un échéancier va à la dernière échéance.
 */
import type { DateISO } from "../commun/dates";
import { ajouterMois } from "../finance/dates";
import { MONTANT_RED_MAX, exigerEntier, jourDe, rapportPb, somme, versNombreSur } from "./commun";
import { ErreurRedressement } from "./erreurs";

export const CATEGORIES_CREANCIER_RED = [
  "fournisseur",
  "banque",
  "fiscal",
  "social",
  "bailleur",
  "autre",
] as const;
export type CategorieCreancierRed = (typeof CATEGORIES_CREANCIER_RED)[number];

const ECHEANCES_MAX = 60;
const DATE_MIN = "2000-01-01";
const DATE_MAX = "2100-12-31";

export interface TermesAccordReguliers {
  /** Entier 1..10^13. */
  readonly montantConvenu: number;
  /** 1..60. */
  readonly nombreEcheances: number;
  readonly datePremiere: DateISO;
  /** 1..12. */
  readonly periodiciteMois: number;
}
export interface EcheanceAccord {
  readonly rang: number;
  readonly date: DateISO;
  readonly montant: number;
}

/** Date métier : valide et comprise entre 2000 et 2100 (bornes des CHECK de la base). */
function dateEcheance(date: DateISO): DateISO {
  jourDe(date, "Date d'échéance");
  if (date < DATE_MIN || date > DATE_MAX) {
    throw new ErreurRedressement(
      "ECHEANCIER_INVALIDE",
      "Date d'échéance comprise entre 2000 et 2100 attendue.",
    );
  }
  return date;
}

function montantConvenuValide(montant: number): number {
  return exigerEntier(montant, 1, MONTANT_RED_MAX, "ECHEANCIER_INVALIDE", "Montant convenu");
}

/**
 * n échéances égales ; le reste d'arrondi va à la DERNIÈRE (comme finance/echeancier.ts) ;
 * date k = ajouterMois(datePremiere, (k − 1) × périodicité), depuis la date d'origine.
 */
export function construireEcheancierAccord(t: TermesAccordReguliers): readonly EcheanceAccord[] {
  const montant = montantConvenuValide(t.montantConvenu);
  const nombre = exigerEntier(
    t.nombreEcheances,
    1,
    ECHEANCES_MAX,
    "ECHEANCIER_INVALIDE",
    "Nombre d'échéances",
  );
  const periodicite = exigerEntier(t.periodiciteMois, 1, 12, "ECHEANCIER_INVALIDE", "Périodicité");
  const premiere = dateEcheance(t.datePremiere);
  const n = BigInt(nombre);
  const base = BigInt(montant) / n;
  const reste = BigInt(montant) - base * n;
  const echeances: EcheanceAccord[] = [];
  for (let rang = 1; rang <= nombre; rang++) {
    echeances.push({
      rang,
      date: dateEcheance(ajouterMois(premiere, (rang - 1) * periodicite)),
      montant: versNombreSur(rang === nombre ? base + reste : base),
    });
  }
  return echeances;
}

/** Échéancier explicite : somme = montant convenu, dates strictement croissantes, ≤ 60 lignes. */
export function validerEcheancierAccord(
  montantConvenu: number,
  lignes: readonly { readonly date: DateISO; readonly montant: number }[],
): readonly EcheanceAccord[] {
  const convenu = montantConvenuValide(montantConvenu);
  if (lignes.length < 1 || lignes.length > ECHEANCES_MAX) {
    throw new ErreurRedressement("ECHEANCIER_INVALIDE", "Entre 1 et 60 échéances attendues.");
  }
  const echeances: EcheanceAccord[] = lignes.map((ligne, index) => {
    const date = dateEcheance(ligne.date);
    const montant = exigerEntier(
      ligne.montant,
      1,
      MONTANT_RED_MAX,
      "ECHEANCIER_INVALIDE",
      "Montant d'échéance",
    );
    return { rang: index + 1, date, montant };
  });
  for (let i = 1; i < echeances.length; i++) {
    if ((echeances[i] as EcheanceAccord).date <= (echeances[i - 1] as EcheanceAccord).date) {
      throw new ErreurRedressement(
        "ECHEANCIER_INVALIDE",
        "Les dates d'échéance doivent être strictement croissantes.",
      );
    }
  }
  if (somme(echeances.map((e) => BigInt(e.montant))) !== BigInt(convenu)) {
    throw new ErreurRedressement(
      "ECHEANCIER_INVALIDE",
      "La somme des échéances doit égaler le montant convenu.",
    );
  }
  return echeances;
}

/** Un accord ne dépasse pas l'encours (principal + intérêts) de la créance courante. */
export function verifierAccordContreCreance(montantConvenu: number, encours: number): void {
  const convenu = montantConvenuValide(montantConvenu);
  exigerEntier(encours, 0, Number.MAX_SAFE_INTEGER, "ECHEANCIER_INVALIDE", "Encours");
  if (convenu > encours) {
    throw new ErreurRedressement(
      "ACCORD_SUPERIEUR_CREANCE",
      "Le montant convenu dépasse l'encours de la créance.",
    );
  }
}

export interface AccordSuivi {
  readonly montantConvenu: number;
  readonly echeances: readonly EcheanceAccord[];
  readonly paiements: readonly { readonly date: DateISO; readonly montant: number }[];
  readonly rompu: boolean;
}

const totalPaiements = (accord: AccordSuivi): bigint =>
  somme(
    accord.paiements.map((p) =>
      BigInt(
        exigerEntier(p.montant, 0, MONTANT_RED_MAX, "MONTANT_INVALIDE", "Montant d'un paiement"),
      ),
    ),
  );

/** ACCORD_ROMPU si rompu ; PAIEMENT_EXCESSIF si total payé + montant > convenu. */
export function exigerPaiementAdmissible(accord: AccordSuivi, montant: number): void {
  if (accord.rompu) {
    throw new ErreurRedressement(
      "ACCORD_ROMPU",
      "L'accord a été rompu : plus de paiement rattachable.",
    );
  }
  exigerEntier(montant, 1, MONTANT_RED_MAX, "MONTANT_INVALIDE", "Montant du paiement");
  if (totalPaiements(accord) + BigInt(montant) > BigInt(accord.montantConvenu)) {
    throw new ErreurRedressement(
      "PAIEMENT_EXCESSIF",
      "Le paiement dépasse le montant convenu de l'accord.",
    );
  }
}

export interface EntreeSituationCreancier {
  readonly principal: number;
  readonly interets: number;
  readonly echeanceInitiale: DateISO | null;
  readonly accord: AccordSuivi | null;
  readonly dateReference: DateISO;
}
export type StatutAccord = "respecte" | "en_retard" | "solde" | "rompu";
interface EcheanceRestanteAccord {
  readonly rang: number;
  readonly date: DateISO;
  readonly montantRestant: number;
}
export interface SituationCreancier {
  /** Principal + intérêts. */
  readonly encoursInitial: number;
  readonly accord: null | {
    readonly statut: StatutAccord;
    readonly montantConvenu: number;
    /** max(0, encours − convenu). */
    readonly remise: number;
    readonly totalPaye: number;
    /** max(0, convenu − payé). */
    readonly resteAPayer: number;
    /** Échéances datées STRICTEMENT avant la date de référence. */
    readonly echeancesEchues: number;
    readonly montantEchu: number;
    /** max(0, montantEchu − totalPaye). */
    readonly retard: number;
    readonly prochaineNonSoldee: null | EcheanceRestanteAccord;
    /** Imputation FIFO, > 0, ordre des rangs. */
    readonly echeancesRestantes: readonly EcheanceRestanteAccord[];
  };
  /** Sans accord : encoursInitial ; accord en vigueur : resteAPayer ; rompu : max(0, encoursInitial − totalPaye). */
  readonly encoursRestant: number;
  /** Sans accord : encoursInitial si échéance initiale < référence, sinon 0 ; accord en vigueur : retard ; rompu : encoursRestant. */
  readonly echu: number;
}

const plancher = (valeur: bigint): bigint => (valeur > 0n ? valeur : 0n);

/** Situation d'un créancier à une date de référence (recalculée à chaque lecture, jamais stockée). */
export function situationCreancier(e: EntreeSituationCreancier): SituationCreancier {
  const principal = exigerEntier(e.principal, 0, MONTANT_RED_MAX, "MONTANT_INVALIDE", "Principal");
  const interets = exigerEntier(e.interets, 0, MONTANT_RED_MAX, "MONTANT_INVALIDE", "Intérêts");
  const reference = jourDe(e.dateReference, "Date de référence");
  const encours = BigInt(principal) + BigInt(interets);

  if (e.accord === null) {
    const echue =
      e.echeanceInitiale !== null && jourDe(e.echeanceInitiale, "Échéance initiale") < reference;
    return {
      encoursInitial: versNombreSur(encours),
      accord: null,
      encoursRestant: versNombreSur(encours),
      echu: echue ? versNombreSur(encours) : 0,
    };
  }

  const accord = e.accord;
  const convenu = BigInt(
    exigerEntier(accord.montantConvenu, 1, MONTANT_RED_MAX, "MONTANT_INVALIDE", "Montant convenu"),
  );
  const paye = totalPaiements(accord);
  const echeances = [...accord.echeances].sort((a, b) => a.rang - b.rang);

  let echeancesEchues = 0;
  let montantEchu = 0n;
  let cumul = 0n;
  const restantes: EcheanceRestanteAccord[] = [];
  for (const echeance of echeances) {
    const montant = BigInt(
      exigerEntier(echeance.montant, 1, MONTANT_RED_MAX, "MONTANT_INVALIDE", "Montant d'échéance"),
    );
    if (jourDe(echeance.date, "Date d'échéance") < reference) {
      echeancesEchues += 1;
      montantEchu += montant;
    }
    cumul += montant;
    // Imputation FIFO : le restant dû de l'échéance est borné à son montant.
    const restant = plancher(cumul - paye);
    const borne = restant < montant ? restant : montant;
    if (borne > 0n) {
      restantes.push({
        rang: echeance.rang,
        date: echeance.date,
        montantRestant: versNombreSur(borne),
      });
    }
  }
  const resteAPayer = plancher(convenu - paye);
  const retard = plancher(montantEchu - paye);
  const statut: StatutAccord = accord.rompu
    ? "rompu"
    : resteAPayer === 0n
      ? "solde"
      : retard > 0n
        ? "en_retard"
        : "respecte";
  const enVigueur = statut !== "rompu" && statut !== "solde";
  const encoursRompu = plancher(encours - paye);
  return {
    encoursInitial: versNombreSur(encours),
    accord: {
      statut,
      montantConvenu: versNombreSur(convenu),
      remise: versNombreSur(plancher(encours - convenu)),
      totalPaye: versNombreSur(paye),
      resteAPayer: versNombreSur(resteAPayer),
      echeancesEchues,
      montantEchu: versNombreSur(montantEchu),
      retard: versNombreSur(retard),
      prochaineNonSoldee: enVigueur ? (restantes[0] ?? null) : null,
      echeancesRestantes: enVigueur ? restantes : [],
    },
    encoursRestant: versNombreSur(statut === "rompu" ? encoursRompu : resteAPayer),
    echu: versNombreSur(statut === "rompu" ? encoursRompu : retard),
  };
}

export interface LignePassif {
  readonly creancierId: string;
  readonly categorie: CategorieCreancierRed;
  readonly garanti: boolean;
  readonly encours: number;
  readonly echu: number;
}
export interface SynthesePassif {
  readonly nombre: number;
  readonly totalEncours: number;
  readonly totalEchu: number;
  /** Encours garantis / total, pb ; null si total nul. */
  readonly partGarantiePb: number | null;
  /** Trois plus gros encours / total, pb. */
  readonly concentrationTop3Pb: number | null;
  /** Catégories non vides, ordre de CATEGORIES_CREANCIER_RED. */
  readonly parCategorie: readonly {
    readonly categorie: CategorieCreancierRed;
    readonly nombre: number;
    readonly encours: number;
    readonly echu: number;
    readonly partPb: number | null;
  }[];
}

/** Synthèse du passif : totaux, part garantie, concentration, répartition par catégorie. */
export function synthesePassif(lignes: readonly LignePassif[]): SynthesePassif {
  for (const ligne of lignes) {
    if (!(CATEGORIES_CREANCIER_RED as readonly string[]).includes(ligne.categorie)) {
      throw new ErreurRedressement("ENTREE_INVALIDE", "Catégorie de créancier inconnue.");
    }
    exigerEntier(ligne.encours, 0, MONTANT_RED_MAX, "MONTANT_INVALIDE", "Encours");
    exigerEntier(ligne.echu, 0, MONTANT_RED_MAX, "MONTANT_INVALIDE", "Montant échu");
  }
  const total = somme(lignes.map((l) => BigInt(l.encours)));
  const parts = (montant: bigint): number | null =>
    total === 0n ? null : rapportPb(montant, total);
  const plusGros = [...lignes].sort((a, b) => b.encours - a.encours).slice(0, 3);
  const parCategorie = CATEGORIES_CREANCIER_RED.flatMap((categorie) => {
    const dedans = lignes.filter((l) => l.categorie === categorie);
    if (dedans.length === 0) return [];
    const encours = somme(dedans.map((l) => BigInt(l.encours)));
    return [
      {
        categorie,
        nombre: dedans.length,
        encours: versNombreSur(encours),
        echu: versNombreSur(somme(dedans.map((l) => BigInt(l.echu)))),
        partPb: parts(encours),
      },
    ];
  });
  return {
    nombre: lignes.length,
    totalEncours: versNombreSur(total),
    totalEchu: versNombreSur(somme(lignes.map((l) => BigInt(l.echu)))),
    partGarantiePb: parts(somme(lignes.filter((l) => l.garanti).map((l) => BigInt(l.encours)))),
    concentrationTop3Pb: parts(somme(plusGros.map((l) => BigInt(l.encours)))),
    parCategorie,
  };
}
