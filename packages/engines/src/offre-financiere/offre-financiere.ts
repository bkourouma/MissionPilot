/**
 * Offre financière d'un appel d'offres (AO-07, PRD complémentaire §9) : honoraires (jours par
 * expert × taux journalier), per diem, débours, taxes, totaux, conversion de devise.
 *
 * Règles de calcul (toutes exactes, montants en entiers d'unités mineures, voir
 * `finance/calcul-exact.ts`) :
 * 1. chaque ligne : montant = arrondi(quantité × prix unitaire), arrondi UNE fois au plus
 *    proche, demi s'éloignant de zéro ; jours et quantités ont au plus deux décimales ;
 * 2. sous-totaux = somme des montants de lignes (aucun arrondi supplémentaire) ;
 *    total HT = honoraires + per diem + débours ;
 * 3. chaque taxe = arrondi(base × taux %), base = honoraires ou total HT selon la taxe, taux
 *    en points à quatre décimales au plus ; total TTC = total HT + Σ taxes ;
 * 4. conversion facultative avec un taux figé (`finance/monnaie.ts`, `convertir`) du total HT
 *    et du total TTC, chacun arrondi une fois.
 * Jours par expert : somme exacte en centièmes de jour des lignes d'honoraires de même clé.
 * Les chiffres sortent de ce moteur seul : jamais d'un modèle de langage.
 */
import { versRationnel } from "../finance/calcul-exact";
import { ErreurFinance } from "../finance/erreurs";
import {
  additionner,
  appliquerPourcentage,
  convertir,
  figerTauxChange,
  montant,
  multiplierParRationnel,
  sommer,
  type Devise,
  type Montant,
} from "../finance/monnaie";

export interface LigneHonoraires {
  /** Clé de l'expert (identifiant de CV, de collaborateur ou libre) : regroupe les jours. */
  readonly cle: string;
  readonly libelle: string;
  /** Jours, deux décimales au plus (0,5 j). */
  readonly jours: number;
  /** Taux journalier en unités mineures. */
  readonly tauxJournalier: number;
}

export interface LigneQuantite {
  readonly libelle: string;
  /** Nombre (jours de per diem, quantité de débours), deux décimales au plus. */
  readonly quantite: number;
  /** Prix unitaire en unités mineures. */
  readonly prixUnitaire: number;
}

export type AssietteTaxe = "honoraires" | "total_ht";

export interface Taxe {
  readonly libelle: string;
  /** Taux en points (18 pour 18 %), quatre décimales au plus. */
  readonly taux: number;
  readonly assiette: AssietteTaxe;
}

export interface ConversionOffre {
  readonly deviseCible: Devise;
  /** 1 unité de la devise de l'offre = `taux` unités de la devise cible. */
  readonly taux: number;
  /** Date de fixation du taux (AAAA-MM-JJ). */
  readonly dateFixation: string;
}

export interface EntreeOffreFinanciere {
  readonly devise: Devise;
  readonly honoraires: readonly LigneHonoraires[];
  readonly perDiem: readonly LigneQuantite[];
  readonly debours: readonly LigneQuantite[];
  readonly taxes: readonly Taxe[];
  readonly conversion?: ConversionOffre | null;
}

export interface LigneCalculee {
  readonly libelle: string;
  readonly quantite: number;
  readonly prixUnitaire: number;
  readonly montant: number;
}

export interface LigneHonorairesCalculee extends LigneCalculee {
  readonly cle: string;
}

export interface JoursExpert {
  readonly cle: string;
  readonly libelle: string;
  /** Jours exacts en centièmes (1250 pour 12,5 j). */
  readonly joursCentiemes: number;
  readonly montant: number;
}

export interface TaxeCalculee extends Taxe {
  readonly base: number;
  readonly montant: number;
}

export interface ResultatOffreFinanciere {
  readonly devise: Devise;
  readonly honoraires: readonly LigneHonorairesCalculee[];
  readonly perDiem: readonly LigneCalculee[];
  readonly debours: readonly LigneCalculee[];
  readonly joursParExpert: readonly JoursExpert[];
  readonly totalJoursCentiemes: number;
  readonly sousTotalHonoraires: number;
  readonly sousTotalPerDiem: number;
  readonly sousTotalDebours: number;
  readonly totalHt: number;
  readonly taxes: readonly TaxeCalculee[];
  readonly totalTaxes: number;
  readonly totalTtc: number;
  readonly conversion: {
    readonly deviseCible: Devise;
    readonly taux: number;
    readonly dateFixation: string;
    readonly totalHt: number;
    readonly totalTtc: number;
  } | null;
}

export type CodeErreurOffreFinanciere =
  | "OFFRE_VIDE"
  | "TROP_DE_LIGNES"
  | "QUANTITE_INVALIDE"
  | "PRIX_INVALIDE"
  | "TAXE_INVALIDE"
  | "CONVERSION_INVALIDE"
  | "MONTANT_HORS_LIMITES";

export class ErreurOffreFinanciere extends Error {
  readonly code: CodeErreurOffreFinanciere;

  constructor(code: CodeErreurOffreFinanciere, message: string) {
    super(message);
    this.name = "ErreurOffreFinanciere";
    this.code = code;
  }
}

/** Lignes au plus par catégorie (honoraires, per diem, débours) et taxes au plus. */
export const LIGNES_MAX = 200;
export const TAXES_MAX = 10;
/** Quantité maximale d'une ligne (jours, nombre) : borne de cohérence. */
export const QUANTITE_MAX = 100_000;

/** Nombre décimal positif à `decimales` décimales au plus → entier mis à l'échelle. */
function aLEchelle(x: number, decimales: number, max: number): number | null {
  if (!Number.isFinite(x) || x < 0 || x > max) return null;
  const r = versRationnel(x);
  const echelle = 10n ** BigInt(decimales);
  if ((r.num * echelle) % r.den !== 0n) return null;
  return Number((r.num * echelle) / r.den);
}

function centiemes(x: number, quoi: string): number {
  const n = aLEchelle(x, 2, QUANTITE_MAX);
  if (n === null) {
    throw new ErreurOffreFinanciere(
      "QUANTITE_INVALIDE",
      `${quoi} : nombre positif à deux décimales au plus attendu (reçu ${x}).`,
    );
  }
  return n;
}

function prix(valeur: number, devise: Devise, quoi: string): Montant {
  if (!Number.isSafeInteger(valeur) || valeur < 0) {
    throw new ErreurOffreFinanciere(
      "PRIX_INVALIDE",
      `${quoi} : entier positif d'unités mineures attendu (reçu ${valeur}).`,
    );
  }
  return montant(valeur, devise);
}

function ligne(devise: Devise, l: LigneQuantite, quoi: string): LigneCalculee {
  const q = centiemes(l.quantite, `${quoi} « ${l.libelle} »`);
  const pu = prix(l.prixUnitaire, devise, `${quoi} « ${l.libelle} »`);
  const m = multiplierParRationnel(pu, { num: BigInt(q), den: 100n });
  return {
    libelle: l.libelle,
    quantite: l.quantite,
    prixUnitaire: l.prixUnitaire,
    montant: m.valeur,
  };
}

function verifierNombre(n: number, max: number, quoi: string): void {
  if (n > max) {
    throw new ErreurOffreFinanciere("TROP_DE_LIGNES", `${quoi} : ${max} au plus (reçu ${n}).`);
  }
}

function joursParExpert(lignes: readonly LigneHonorairesCalculee[]): JoursExpert[] {
  const parCle = new Map<string, { libelle: string; joursCentiemes: number; montant: number }>();
  for (const l of lignes) {
    const deja = parCle.get(l.cle) ?? { libelle: l.libelle, joursCentiemes: 0, montant: 0 };
    deja.joursCentiemes += centiemes(l.quantite, "Jours");
    deja.montant += l.montant;
    parCle.set(l.cle, deja);
  }
  return [...parCle.entries()].map(([cle, v]) => ({ cle, ...v }));
}

function calculerTaxes(
  taxes: readonly Taxe[],
  bases: Record<AssietteTaxe, Montant>,
): TaxeCalculee[] {
  verifierNombre(taxes.length, TAXES_MAX, "Taxes");
  return taxes.map((t) => {
    if (aLEchelle(t.taux, 4, 100) === null) {
      throw new ErreurOffreFinanciere(
        "TAXE_INVALIDE",
        `Taxe « ${t.libelle} » : taux de 0 à 100 points, quatre décimales au plus (reçu ${t.taux}).`,
      );
    }
    const base = bases[t.assiette];
    return { ...t, base: base.valeur, montant: appliquerPourcentage(base, t.taux).valeur };
  });
}

function calculerConversion(c: ConversionOffre, devise: Devise, ht: Montant, ttc: Montant) {
  try {
    const taux = figerTauxChange(devise, c.deviseCible, c.taux, c.dateFixation);
    return {
      deviseCible: c.deviseCible,
      taux: c.taux,
      dateFixation: c.dateFixation,
      totalHt: convertir(ht, taux).valeur,
      totalTtc: convertir(ttc, taux).valeur,
    };
  } catch (e) {
    if (e instanceof ErreurFinance && e.code !== "MONTANT_INVALIDE") {
      throw new ErreurOffreFinanciere("CONVERSION_INVALIDE", e.message);
    }
    throw e;
  }
}

/** Calcule une offre financière complète ; lève `ErreurOffreFinanciere` sur une entrée invalide. */
export function calculerOffreFinanciere(e: EntreeOffreFinanciere): ResultatOffreFinanciere {
  if (e.honoraires.length + e.perDiem.length + e.debours.length === 0) {
    throw new ErreurOffreFinanciere(
      "OFFRE_VIDE",
      "Une offre financière compte au moins une ligne.",
    );
  }
  verifierNombre(e.honoraires.length, LIGNES_MAX, "Lignes d'honoraires");
  verifierNombre(e.perDiem.length, LIGNES_MAX, "Lignes de per diem");
  verifierNombre(e.debours.length, LIGNES_MAX, "Lignes de débours");
  try {
    const honoraires = e.honoraires.map((h) => ({
      cle: h.cle,
      ...ligne(
        e.devise,
        { libelle: h.libelle, quantite: h.jours, prixUnitaire: h.tauxJournalier },
        "Jours",
      ),
    }));
    const perDiem = e.perDiem.map((l) => ligne(e.devise, l, "Per diem"));
    const debours = e.debours.map((l) => ligne(e.devise, l, "Débours"));
    const somme = (lignes: readonly { montant: number }[]) =>
      sommer(
        lignes.map((l) => montant(l.montant, e.devise)),
        e.devise,
      );
    const sHon = somme(honoraires);
    const sPd = somme(perDiem);
    const sDeb = somme(debours);
    const totalHt = additionner(additionner(sHon, sPd), sDeb);
    const taxes = calculerTaxes(e.taxes, { honoraires: sHon, total_ht: totalHt });
    const totalTaxes = somme(taxes);
    const totalTtc = additionner(totalHt, totalTaxes);
    const parExpert = joursParExpert(honoraires);
    return {
      devise: e.devise,
      honoraires,
      perDiem,
      debours,
      joursParExpert: parExpert,
      totalJoursCentiemes: parExpert.reduce((n, x) => n + x.joursCentiemes, 0),
      sousTotalHonoraires: sHon.valeur,
      sousTotalPerDiem: sPd.valeur,
      sousTotalDebours: sDeb.valeur,
      totalHt: totalHt.valeur,
      taxes,
      totalTaxes: totalTaxes.valeur,
      totalTtc: totalTtc.valeur,
      conversion: e.conversion
        ? calculerConversion(e.conversion, e.devise, totalHt, totalTtc)
        : null,
    };
  } catch (err) {
    if (err instanceof ErreurFinance && err.code === "MONTANT_INVALIDE") {
      throw new ErreurOffreFinanciere(
        "MONTANT_HORS_LIMITES",
        "Un montant de l'offre dépasse la limite de calcul exact.",
      );
    }
    throw err;
  }
}

/** Jours en centièmes → nombre de jours (1250 → 12,5), pour l'affichage. */
export function joursDepuisCentiemes(c: number): number {
  return c / 100;
}
