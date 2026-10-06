/**
 * Échéancier de facturation (FIN-06) pour les quatre modes de MIS-10 :
 * forfait (acomptes et jalons), régie sur temps validés, forfait avec part
 * variable, abonnement périodique.
 *
 * Les pourcentages d'un forfait doivent sommer exactement à 100 (comparaison
 * en fractions exactes : 33,33 + 33,33 + 33,34 = 100). Les montants sont
 * répartis sans perte : le reste d'arrondi va au dernier jalon.
 */
import { comparerRationnels, sommeRationnels, versRationnel } from "./calcul-exact";
import { ajouterMois, joursDepuisEpoque, type DateISO } from "./dates";
import { ErreurFinance } from "./erreurs";
import {
  appliquerPourcentage,
  montant,
  multiplier,
  repartir,
  sommer,
  soustraire,
  verifierMemeDevise,
  zero,
  type Montant,
} from "./monnaie";
import { verifierJours } from "./rentabilite";

export interface JalonFacturation {
  readonly libelle: string;
  /** Part du forfait en points (30 pour 30 %). */
  readonly pourcentage: number;
  readonly date: DateISO;
}

export interface TempsValide {
  /** Date de la période de facturation (ex. fin de mois). */
  readonly periode: DateISO;
  readonly jours: number;
  readonly tauxJournalier: Montant;
}

export type Periodicite = "mensuelle" | "trimestrielle" | "semestrielle" | "annuelle";

export type DefinitionEcheancier =
  | {
      readonly mode: "forfait";
      readonly montant: Montant;
      readonly jalons: readonly JalonFacturation[];
    }
  | { readonly mode: "regie"; readonly temps: readonly TempsValide[] }
  | {
      readonly mode: "forfait_variable";
      readonly partFixe: Montant;
      readonly jalons: readonly JalonFacturation[];
      readonly partVariable: {
        readonly libelle: string;
        readonly montantMaximum: Montant;
        /** Atteinte des objectifs en points, de 0 à 100. */
        readonly atteinte: number;
        readonly date: DateISO;
      };
    }
  | {
      readonly mode: "abonnement";
      readonly libelle: string;
      readonly montantPeriodique: Montant;
      readonly dateDebut: DateISO;
      readonly nombrePeriodes: number;
      readonly periodicite: Periodicite;
    };

export interface Echeance {
  readonly libelle: string;
  readonly date: DateISO;
  readonly montant: Montant;
}

const MOIS_PAR_PERIODE: Readonly<Record<Periodicite, number>> = {
  mensuelle: 1,
  trimestrielle: 3,
  semestrielle: 6,
  annuelle: 12,
};

function verifierJalons(jalons: readonly JalonFacturation[]): void {
  const pourcentages = jalons.map((j) => versRationnel(j.pourcentage, "pourcentage"));
  jalons.forEach((j) => joursDepuisEpoque(j.date));
  const cent = { num: 100n, den: 1n };
  const somme = sommeRationnels(pourcentages);
  if (pourcentages.some((p) => p.num <= 0n) || comparerRationnels(somme, cent) !== 0) {
    throw new ErreurFinance(
      "POURCENTAGES_INVALIDES",
      "Les jalons doivent avoir des pourcentages positifs sommant exactement à 100.",
    );
  }
}

/** Forfait par acomptes et jalons. Exemple : 10 000 000 FCFA en 30/40/30. */
export function echeancierForfait(total: Montant, jalons: readonly JalonFacturation[]): Echeance[] {
  verifierJalons(jalons);
  const montants = repartir(
    total,
    jalons.map((j) => j.pourcentage),
  );
  return jalons.map((j, i) => ({
    libelle: j.libelle,
    date: j.date,
    montant: montants[i] as Montant,
  }));
}

/** Régie : une échéance par période, Σ arrondi(jours × taux) des temps validés. */
export function echeancierRegie(temps: readonly TempsValide[]): Echeance[] {
  temps.forEach((t) => verifierJours(t.jours, `Régie, période du ${t.periode}`));
  const periodes = [...new Set(temps.map((t) => t.periode))].sort(
    (a, b) => joursDepuisEpoque(a) - joursDepuisEpoque(b),
  );
  return periodes.map((periode) => {
    const lignes = temps.filter((t) => t.periode === periode);
    const premiere = lignes[0] as TempsValide;
    return {
      libelle: `Régie — période du ${periode}`,
      date: periode,
      montant: sommer(
        lignes.map((t) => multiplier(t.tauxJournalier, t.jours)),
        premiere.tauxJournalier.devise,
      ),
    };
  });
}

/** Forfait avec part variable : jalons sur la part fixe + arrondi(maximum × atteinte %). */
export function echeancierForfaitVariable(
  definition: Extract<DefinitionEcheancier, { mode: "forfait_variable" }>,
): Echeance[] {
  const { partVariable } = definition;
  verifierMemeDevise(definition.partFixe, partVariable.montantMaximum);
  const atteinte = versRationnel(partVariable.atteinte, "atteinte");
  if (atteinte.num < 0n || comparerRationnels(atteinte, { num: 100n, den: 1n }) > 0) {
    throw new ErreurFinance(
      "ECHEANCIER_INVALIDE",
      `Atteinte hors de [0 ; 100] (${partVariable.atteinte}).`,
    );
  }
  joursDepuisEpoque(partVariable.date);
  return [
    ...echeancierForfait(definition.partFixe, definition.jalons),
    {
      libelle: partVariable.libelle,
      date: partVariable.date,
      montant: appliquerPourcentage(partVariable.montantMaximum, partVariable.atteinte),
    },
  ];
}

/** Abonnement : `nombrePeriodes` échéances égales à partir de `dateDebut`. */
export function echeancierAbonnement(
  definition: Extract<DefinitionEcheancier, { mode: "abonnement" }>,
): Echeance[] {
  const { nombrePeriodes, periodicite } = definition;
  if (!Number.isInteger(nombrePeriodes) || nombrePeriodes < 1) {
    throw new ErreurFinance(
      "ECHEANCIER_INVALIDE",
      `Nombre de périodes invalide (${nombrePeriodes}).`,
    );
  }
  return Array.from({ length: nombrePeriodes }, (_, k) => ({
    libelle: `${definition.libelle} — période ${k + 1}/${nombrePeriodes}`,
    date: ajouterMois(definition.dateDebut, k * MOIS_PAR_PERIODE[periodicite]),
    montant: montant(definition.montantPeriodique.valeur, definition.montantPeriodique.devise),
  }));
}

/** Calcule l'échéancier d'une mission selon son mode de facturation (MIS-10). */
export function calculerEcheancier(definition: DefinitionEcheancier): Echeance[] {
  switch (definition.mode) {
    case "forfait":
      return echeancierForfait(definition.montant, definition.jalons);
    case "regie":
      return echeancierRegie(definition.temps);
    case "forfait_variable":
      return echeancierForfaitVariable(definition);
    case "abonnement":
      return echeancierAbonnement(definition);
  }
}

export interface ControleEcheancier {
  readonly conforme: boolean;
  readonly total: Montant;
  /** Total − budget signé si positif, zéro sinon. */
  readonly depassement: Montant;
}

/** Vérifie que le total de l'échéancier ne dépasse pas le budget signé. */
export function controlerEcheancierBudget(
  echeances: readonly Echeance[],
  budgetSigne: Montant,
): ControleEcheancier {
  const total = sommer(
    echeances.map((e) => e.montant),
    budgetSigne.devise,
  );
  const ecart = soustraire(total, budgetSigne);
  return {
    conforme: ecart.valeur <= 0,
    total,
    depassement: ecart.valeur > 0 ? ecart : zero(budgetSigne.devise),
  };
}
