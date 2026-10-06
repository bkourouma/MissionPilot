/**
 * Calcul d'une facture (FIN-07) et d'un avoir.
 *
 * Ordre et arrondis (tous au plus proche, demi s'éloignant de zéro) :
 * 1. ligne : brut = arrondi(quantité × prix unitaire) ; remise de ligne
 *    = arrondi(brut × %) ou montant fixe ; net de ligne = brut − remise ;
 * 2. remise globale = arrondi(Σ nets × %) ou montant fixe, répartie sur les
 *    lignes au prorata de leur net sans perte (reste sur la dernière ligne) ;
 *    HT de ligne = net − part de remise globale ; total HT = Σ HT de ligne ;
 * 3. TVA calculée UNE fois par taux sur la base Σ HT des lignes de ce taux :
 *    TVA(t) = arrondi(base(t) × t %). Pas d'arrondi ligne à ligne, donc pas
 *    d'écart cumulé ; total TVA = Σ TVA(t) ; TTC = HT + TVA ;
 * 4. chaque retenue à la source = arrondi(assiette × taux %), assiette = total
 *    HT ou TTC selon le paramètre ; net à payer = TTC − Σ retenues.
 * La somme des lignes est donc toujours égale au total.
 */
import { versRationnel, comparerRationnels } from "./calcul-exact";
import { ErreurFinance } from "./erreurs";
import {
  appliquerPourcentage,
  multiplier,
  oppose,
  repartir,
  sommer,
  soustraire,
  verifierMemeDevise,
  zero,
  type Devise,
  type Montant,
} from "./monnaie";

export type Remise =
  | { readonly type: "pourcentage"; readonly pourcentage: number }
  | { readonly type: "montant"; readonly montant: Montant };

export interface LigneFacture {
  readonly libelle: string;
  readonly quantite: number;
  readonly prixUnitaire: Montant;
  /** Taux de TVA en points (18 pour 18 %), 0 si exonéré. */
  readonly tauxTva: number;
  readonly remise?: Remise;
}

export interface Retenue {
  readonly libelle: string;
  /** Taux en points (7,5 pour 7,5 %). */
  readonly taux: number;
  readonly base: "HT" | "TTC";
}

export interface DonneesFacture {
  readonly devise: Devise;
  readonly lignes: readonly LigneFacture[];
  readonly remiseGlobale?: Remise;
  readonly retenues?: readonly Retenue[];
}

export interface LigneFactureCalculee {
  readonly libelle: string;
  readonly quantite: number;
  readonly prixUnitaire: Montant;
  readonly tauxTva: number;
  readonly montantBrut: Montant;
  readonly remiseLigne: Montant;
  readonly partRemiseGlobale: Montant;
  readonly montantHT: Montant;
}

export interface TvaParTaux {
  readonly taux: number;
  readonly base: Montant;
  readonly montant: Montant;
}

export interface RetenueCalculee extends Retenue {
  readonly assiette: Montant;
  readonly montant: Montant;
}

export interface FactureCalculee {
  readonly nature: "facture" | "avoir";
  readonly devise: Devise;
  readonly lignes: readonly LigneFactureCalculee[];
  readonly totalBrut: Montant;
  readonly totalRemises: Montant;
  readonly totalHT: Montant;
  readonly tva: readonly TvaParTaux[];
  readonly totalTva: Montant;
  readonly totalTTC: Montant;
  readonly retenues: readonly RetenueCalculee[];
  readonly totalRetenues: Montant;
  readonly netAPayer: Montant;
}

function verifierPourcentage(pourcentage: number, contexte: string): void {
  const r = versRationnel(pourcentage, contexte);
  if (r.num < 0n || comparerRationnels(r, { num: 100n, den: 1n }) > 0) {
    throw new ErreurFinance(
      "REMISE_INVALIDE",
      `${contexte} : pourcentage hors de [0 ; 100] (${pourcentage}).`,
    );
  }
}

/** Montant d'une remise sur une assiette ; une remise fixe va de 0 à l'assiette. */
export function montantRemise(assiette: Montant, remise: Remise | undefined): Montant {
  if (remise === undefined) return zero(assiette.devise);
  if (remise.type === "pourcentage") {
    verifierPourcentage(remise.pourcentage, "Remise");
    return appliquerPourcentage(assiette, remise.pourcentage);
  }
  verifierMemeDevise(assiette, remise.montant);
  if (remise.montant.valeur < 0 || remise.montant.valeur > Math.max(assiette.valeur, 0)) {
    throw new ErreurFinance(
      "REMISE_INVALIDE",
      "Une remise fixe doit être comprise entre 0 et le montant remisé.",
    );
  }
  return remise.montant;
}

function calculerLigneBrute(
  ligne: LigneFacture,
  devise: Devise,
): { brut: Montant; remise: Montant } {
  verifierMemeDevise(ligne.prixUnitaire, zero(devise));
  verifierPourcentage(ligne.tauxTva, `TVA de « ${ligne.libelle} »`);
  const brut = multiplier(ligne.prixUnitaire, ligne.quantite);
  return { brut, remise: montantRemise(brut, ligne.remise) };
}

function repartirRemiseGlobale(nets: readonly Montant[], remise: Montant): Montant[] {
  if (remise.valeur === 0) return nets.map(() => zero(remise.devise));
  if (nets.some((n) => n.valeur < 0)) {
    throw new ErreurFinance(
      "REMISE_INVALIDE",
      "Remise globale impossible avec des lignes négatives.",
    );
  }
  return repartir(
    remise,
    nets.map((n) => n.valeur),
  );
}

function calculerLignes(donnees: DonneesFacture): LigneFactureCalculee[] {
  const bruts = donnees.lignes.map((l) => calculerLigneBrute(l, donnees.devise));
  const nets = bruts.map((b) => soustraire(b.brut, b.remise));
  const remiseGlobale = montantRemise(sommer(nets, donnees.devise), donnees.remiseGlobale);
  const parts = repartirRemiseGlobale(nets, remiseGlobale);
  return donnees.lignes.map((l, i) => {
    const { brut, remise } = bruts[i] as { brut: Montant; remise: Montant };
    const part = parts[i] as Montant;
    return {
      libelle: l.libelle,
      quantite: l.quantite,
      prixUnitaire: l.prixUnitaire,
      tauxTva: l.tauxTva,
      montantBrut: brut,
      remiseLigne: remise,
      partRemiseGlobale: part,
      montantHT: soustraire(nets[i] as Montant, part),
    };
  });
}

/** TVA par taux, triée par taux croissant. */
export function calculerTvaParTaux(
  lignes: readonly LigneFactureCalculee[],
  devise: Devise,
): TvaParTaux[] {
  const taux = [...new Set(lignes.map((l) => l.tauxTva))].sort((a, b) => a - b);
  return taux.map((t) => {
    const base = sommer(
      lignes.filter((l) => l.tauxTva === t).map((l) => l.montantHT),
      devise,
    );
    return { taux: t, base, montant: appliquerPourcentage(base, t) };
  });
}

function calculerRetenues(
  retenues: readonly Retenue[],
  totalHT: Montant,
  totalTTC: Montant,
): RetenueCalculee[] {
  return retenues.map((r) => {
    verifierPourcentage(r.taux, `Retenue « ${r.libelle} »`);
    const assiette = r.base === "HT" ? totalHT : totalTTC;
    return { ...r, assiette, montant: appliquerPourcentage(assiette, r.taux) };
  });
}

/**
 * Calcule une facture. Exemple : 10 j × 450 000 FCFA, TVA 18 %, retenue 7,5 %
 * sur HT → HT 4 500 000, TVA 810 000, TTC 5 310 000, retenue 337 500,
 * net à payer 4 972 500 FCFA.
 */
export function calculerFacture(donnees: DonneesFacture): FactureCalculee {
  const d = donnees.devise;
  const lignes = calculerLignes(donnees);
  const totalBrut = sommer(
    lignes.map((l) => l.montantBrut),
    d,
  );
  const totalHT = sommer(
    lignes.map((l) => l.montantHT),
    d,
  );
  const tva = calculerTvaParTaux(lignes, d);
  const totalTva = sommer(
    tva.map((t) => t.montant),
    d,
  );
  const totalTTC = sommer([totalHT, totalTva], d);
  const retenues = calculerRetenues(donnees.retenues ?? [], totalHT, totalTTC);
  const totalRetenues = sommer(
    retenues.map((r) => r.montant),
    d,
  );
  return {
    nature: "facture",
    devise: d,
    lignes,
    totalBrut,
    totalRemises: soustraire(totalBrut, totalHT),
    totalHT,
    tva,
    totalTva,
    totalTTC,
    retenues,
    totalRetenues,
    netAPayer: soustraire(totalTTC, totalRetenues),
  };
}

function opposerLigne(l: LigneFactureCalculee): LigneFactureCalculee {
  return {
    ...l,
    quantite: l.quantite === 0 ? 0 : -l.quantite,
    montantBrut: oppose(l.montantBrut),
    remiseLigne: oppose(l.remiseLigne),
    partRemiseGlobale: oppose(l.partRemiseGlobale),
    montantHT: oppose(l.montantHT),
  };
}

/**
 * Avoir (note de crédit) annulant totalement une facture : facture négative
 * dont chaque montant est l'exact opposé de l'original (mêmes taux, mêmes
 * bases). L'arrondi étant symétrique, recalculer les mêmes lignes avec des
 * quantités négatives donne les mêmes montants (hors remise globale, refusée
 * sur des lignes négatives).
 */
export function creerAvoir(facture: FactureCalculee): FactureCalculee {
  return {
    ...facture,
    nature: "avoir",
    lignes: facture.lignes.map(opposerLigne),
    totalBrut: oppose(facture.totalBrut),
    totalRemises: oppose(facture.totalRemises),
    totalHT: oppose(facture.totalHT),
    tva: facture.tva.map((t) => ({
      taux: t.taux,
      base: oppose(t.base),
      montant: oppose(t.montant),
    })),
    totalTva: oppose(facture.totalTva),
    totalTTC: oppose(facture.totalTTC),
    retenues: facture.retenues.map((r) => ({
      ...r,
      assiette: oppose(r.assiette),
      montant: oppose(r.montant),
    })),
    totalRetenues: oppose(facture.totalRetenues),
    netAPayer: oppose(facture.netAPayer),
  };
}
