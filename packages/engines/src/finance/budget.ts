/**
 * Budget de mission (FIN-01) et versions de budget (FIN-03).
 *
 * Une version contient des lignes de quatre natures : honoraires (jours ×
 * taux de vente, ou forfait), coûts internes (jours × coût journalier
 * chargé), débours (refacturables ou non) et sous-traitance.
 *
 * Invariant : « le budget signé ne change jamais en silence ». Une version
 * figée (le budget initial l'est à la signature) refuse toute modification
 * avec l'erreur `BUDGET_FIGE` ; on crée une révision à la place, avec motif.
 */
import { differenceExacte, sommeExacte } from "./calcul-exact";
import { joursDepuisEpoque, type DateIso } from "./dates";
import { ErreurFinance } from "./erreurs";
import {
  multiplier,
  sommer,
  soustraire,
  verifierMemeDevise,
  zero,
  type Devise,
  type Montant,
} from "./monnaie";
import { calculerMarge, verifierJours } from "./rentabilite";

export type NatureLigneBudget = "honoraires" | "cout_interne" | "debours" | "sous_traitance";

export type ValeurLigneBudget =
  | { readonly type: "jours"; readonly jours: number; readonly prixJournalier: Montant }
  | { readonly type: "forfait"; readonly montant: Montant };

export interface LigneBudget {
  readonly id: string;
  readonly libelle: string;
  readonly nature: NatureLigneBudget;
  readonly grade?: string;
  readonly valeur: ValeurLigneBudget;
  /** Débours seulement : refacturé au client (neutre pour la marge). */
  readonly refacturable?: boolean;
}

export type TypeVersionBudget = "initial" | "revise" | "atterrissage";

export interface VersionBudget {
  readonly id: string;
  readonly numero: number;
  readonly type: TypeVersionBudget;
  readonly devise: Devise;
  readonly figee: boolean;
  readonly dateFigeage?: DateIso;
  readonly motif?: string;
  readonly lignes: readonly LigneBudget[];
}

export interface SyntheseBudget {
  readonly devise: Devise;
  readonly honoraires: Montant;
  readonly coutsInternes: Montant;
  readonly deboursRefacturables: Montant;
  readonly deboursNonRefacturables: Montant;
  readonly sousTraitance: Montant;
  readonly marge: Montant;
  readonly tauxMarge: number | null;
  /** Jours vendus (lignes d'honoraires au temps). */
  readonly joursVendus: number;
  /** Jours de production (lignes de coûts internes au temps). */
  readonly joursProduction: number;
}

/** Montant d'une ligne : arrondi(jours × prix journalier) ou forfait. */
export function montantLigne(ligne: LigneBudget, devise: Devise): Montant {
  const v = ligne.valeur;
  if (v.type === "jours") verifierJours(v.jours, `Ligne « ${ligne.libelle} »`);
  const resultat = v.type === "forfait" ? v.montant : multiplier(v.prixJournalier, v.jours);
  verifierMemeDevise(resultat, zero(devise));
  return resultat;
}

export function joursLigne(ligne: LigneBudget): number {
  return ligne.valeur.type === "jours" ? ligne.valeur.jours : 0;
}

function totalNature(version: VersionBudget, filtre: (l: LigneBudget) => boolean): Montant {
  return sommer(
    version.lignes.filter(filtre).map((l) => montantLigne(l, version.devise)),
    version.devise,
  );
}

function joursNature(version: VersionBudget, nature: NatureLigneBudget): number {
  return sommeExacte(version.lignes.filter((l) => l.nature === nature).map(joursLigne));
}

/**
 * Synthèse d'une version. Exemple : 20 j × 400 000 FCFA d'honoraires
 * (8 000 000), 20 j × 250 000 de coûts (5 000 000), 300 000 de débours non
 * refacturés, 700 000 de sous-traitance → marge 2 000 000 FCFA, 0,25.
 */
export function calculerBudget(version: VersionBudget): SyntheseBudget {
  const est = (nature: NatureLigneBudget) => (l: LigneBudget) => l.nature === nature;
  const honoraires = totalNature(version, est("honoraires"));
  const coutsInternes = totalNature(version, est("cout_interne"));
  const deboursRefacturables = totalNature(
    version,
    (l) => l.nature === "debours" && l.refacturable === true,
  );
  const deboursNonRefacturables = totalNature(
    version,
    (l) => l.nature === "debours" && l.refacturable !== true,
  );
  const sousTraitance = totalNature(version, est("sous_traitance"));
  const { marge, taux } = calculerMarge({
    honoraires,
    coutsInternes,
    deboursNonRefactures: deboursNonRefacturables,
    sousTraitance,
  });
  return {
    devise: version.devise,
    honoraires,
    coutsInternes,
    deboursRefacturables,
    deboursNonRefacturables,
    sousTraitance,
    marge,
    tauxMarge: taux,
    joursVendus: joursNature(version, "honoraires"),
    joursProduction: joursNature(version, "cout_interne"),
  };
}

function refuserSiFigee(version: VersionBudget): void {
  if (version.figee) {
    throw new ErreurFinance(
      "BUDGET_FIGE",
      `La version ${version.numero} (${version.type}) du budget est figée : créer une révision motivée.`,
    );
  }
}

/** Fige une version (signature du budget initial, validation d'une révision). */
export function figerVersion(version: VersionBudget, dateFigeage: DateIso): VersionBudget {
  refuserSiFigee(version);
  joursDepuisEpoque(dateFigeage);
  return { ...version, figee: true, dateFigeage };
}

/** Remplace les lignes d'une version non figée ; lève `BUDGET_FIGE` sinon. */
export function modifierLignesBudget(
  version: VersionBudget,
  lignes: readonly LigneBudget[],
): VersionBudget {
  refuserSiFigee(version);
  lignes.forEach((l) => montantLigne(l, version.devise));
  return { ...version, lignes };
}

export interface DemandeRevision {
  readonly id: string;
  readonly type: "revise" | "atterrissage";
  readonly motif: string;
  /** Nouvelles lignes ; par défaut, copie des lignes de la source. */
  readonly lignes?: readonly LigneBudget[];
}

/** Crée une nouvelle version (non figée) à partir d'une source, sans la modifier. */
export function creerRevision(source: VersionBudget, demande: DemandeRevision): VersionBudget {
  if (demande.motif.trim() === "") {
    throw new ErreurFinance("VERSION_INVALIDE", "Une révision de budget exige un motif (FIN-03).");
  }
  const brouillon: VersionBudget = {
    id: demande.id,
    numero: source.numero + 1,
    type: demande.type,
    devise: source.devise,
    figee: false,
    motif: demande.motif,
    lignes: source.lignes,
  };
  return demande.lignes === undefined ? brouillon : modifierLignesBudget(brouillon, demande.lignes);
}

export type StatutEcartLigne = "ajoutee" | "supprimee" | "modifiee" | "inchangee";

export interface EcartLigneBudget {
  readonly id: string;
  readonly libelle: string;
  readonly nature: NatureLigneBudget;
  readonly statut: StatutEcartLigne;
  readonly joursAvant: number;
  readonly joursApres: number;
  readonly ecartJours: number;
  readonly montantAvant: Montant;
  readonly montantApres: Montant;
  readonly ecartMontant: Montant;
}

export interface ComparaisonVersions {
  readonly lignes: readonly EcartLigneBudget[];
  readonly ecartHonoraires: Montant;
  readonly ecartCoutsInternes: Montant;
  readonly ecartMarge: Montant;
  readonly ecartJoursVendus: number;
}

function statutEcart(
  avant: LigneBudget | undefined,
  apres: LigneBudget | undefined,
  ecart: number,
  ecartJours: number,
): StatutEcartLigne {
  if (avant === undefined) return "ajoutee";
  if (apres === undefined) return "supprimee";
  return ecart !== 0 || ecartJours !== 0 ? "modifiee" : "inchangee";
}

function ecartLigne(
  avant: LigneBudget | undefined,
  apres: LigneBudget | undefined,
  devise: Devise,
): EcartLigneBudget {
  const reference = (apres ?? avant) as LigneBudget;
  const montantAvant = avant === undefined ? zero(devise) : montantLigne(avant, devise);
  const montantApres = apres === undefined ? zero(devise) : montantLigne(apres, devise);
  const joursAvant = avant === undefined ? 0 : joursLigne(avant);
  const joursApres = apres === undefined ? 0 : joursLigne(apres);
  const ecartMontant = soustraire(montantApres, montantAvant);
  const ecartJours = differenceExacte(joursApres, joursAvant);
  return {
    id: reference.id,
    libelle: reference.libelle,
    nature: reference.nature,
    statut: statutEcart(avant, apres, ecartMontant.valeur, ecartJours),
    joursAvant,
    joursApres,
    ecartJours,
    montantAvant,
    montantApres,
    ecartMontant,
  };
}

/**
 * Compare deux versions ligne à ligne (par `id`) : lignes de `avant` dans leur
 * ordre, puis lignes ajoutées dans `apres`. Écarts = après − avant.
 */
export function comparerVersions(avant: VersionBudget, apres: VersionBudget): ComparaisonVersions {
  verifierMemeDevise(zero(avant.devise), zero(apres.devise));
  const index = new Map(apres.lignes.map((l) => [l.id, l]));
  const idsAvant = new Set(avant.lignes.map((l) => l.id));
  const lignes = [
    ...avant.lignes.map((l) => ecartLigne(l, index.get(l.id), avant.devise)),
    ...apres.lignes
      .filter((l) => !idsAvant.has(l.id))
      .map((l) => ecartLigne(undefined, l, avant.devise)),
  ];
  const a = calculerBudget(avant);
  const b = calculerBudget(apres);
  return {
    lignes,
    ecartHonoraires: soustraire(b.honoraires, a.honoraires),
    ecartCoutsInternes: soustraire(b.coutsInternes, a.coutsInternes),
    ecartMarge: soustraire(b.marge, a.marge),
    ecartJoursVendus: differenceExacte(b.joursVendus, a.joursVendus),
  };
}
