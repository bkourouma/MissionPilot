/**
 * Rentabilité et indicateurs de pilotage (FIN-11, FIN-12, table des
 * indicateurs du PRD).
 *
 * Les montants restent des entiers ; les taux sont rendus en fraction
 * (0,25 = 25 %) arrondie à 4 décimales, ou `null` quand le dénominateur est
 * nul (pas de division par zéro, pas de « NaN » affiché).
 */
import {
  differenceExacte,
  diviserArrondi,
  ratio,
  versRationnel,
  type Rationnel,
} from "./calcul-exact";
import { joursEntre, type DateIso } from "./dates";
import { ErreurFinance } from "./erreurs";
import {
  additionner,
  multiplier,
  sommer,
  soustraire,
  verifierMemeDevise,
  zero,
  type Devise,
  type Montant,
} from "./monnaie";

function rationnelDe(m: Montant): Rationnel {
  return { num: BigInt(m.valeur), den: 1n };
}

/** Composantes d'une marge de mission. */
export interface ComposantesMarge {
  readonly honoraires: Montant;
  readonly coutsInternes: Montant;
  readonly deboursNonRefactures: Montant;
  readonly sousTraitance: Montant;
}

export interface Marge {
  readonly marge: Montant;
  /** Marge / honoraires, `null` si les honoraires sont nuls. */
  readonly taux: number | null;
}

/**
 * Marge = honoraires − coûts internes − débours non refacturés − sous-traitance ;
 * taux = marge / honoraires. Exemple : 10 000 000 − 6 000 000 − 500 000 − 1 000 000
 * = 2 500 000 FCFA, soit 0,25 (25 %).
 */
export function calculerMarge(c: ComposantesMarge): Marge {
  const charges = sommer(
    [c.coutsInternes, c.deboursNonRefactures, c.sousTraitance],
    c.honoraires.devise,
  );
  const marge = soustraire(c.honoraires, charges);
  return { marge, taux: ratio(rationnelDe(marge), rationnelDe(c.honoraires)) };
}

/** Temps valorisé : jours × taux journalier. */
export interface TempsValorisable {
  readonly jours: number;
  readonly tauxJournalier: Montant;
}

/** Valeur des temps : Σ arrondi(jours × taux), arrondi ligne à ligne. */
export function valeurTemps(temps: readonly TempsValorisable[], devise: Devise): Montant {
  return sommer(
    temps.map((t) => multiplier(t.tauxJournalier, t.jours)),
    devise,
  );
}

/**
 * Taux de réalisation = honoraires facturés / valeur des temps au taux
 * standard. 0,9 signifie que 10 % de la valeur produite n'a pas été facturée.
 */
export function tauxRealisation(
  honorairesFactures: Montant,
  valeurTempsStandard: Montant,
): number | null {
  verifierMemeDevise(honorairesFactures, valeurTempsStandard);
  return ratio(rationnelDe(honorairesFactures), rationnelDe(valeurTempsStandard));
}

export interface Encours {
  /** Valeur des temps réalisés non encore facturés (≥ 0). */
  readonly encoursProduction: Montant;
  /** Facturé au-delà de la production, dit « facturé d'avance » (≥ 0). */
  readonly factureDAvance: Montant;
}

/**
 * Encours de production d'une mission (FIN-11). Choix : deux champs positifs
 * et exclusifs plutôt qu'un solde signé. Solde = production − facturé : s'il
 * est positif c'est de l'encours, sinon du facturé d'avance. Au niveau du
 * cabinet, `encoursPortefeuille` additionne chaque champ mission par mission,
 * sans compenser l'avance d'une mission avec l'encours d'une autre.
 */
export function encoursMission(valeurProduite: Montant, honorairesFactures: Montant): Encours {
  const solde = soustraire(valeurProduite, honorairesFactures);
  const nul = zero(solde.devise);
  if (solde.valeur >= 0) return { encoursProduction: solde, factureDAvance: nul };
  return {
    encoursProduction: nul,
    factureDAvance: { valeur: -solde.valeur, devise: solde.devise },
  };
}

export function encoursPortefeuille(encours: readonly Encours[], devise: Devise): Encours {
  return {
    encoursProduction: sommer(
      encours.map((e) => e.encoursProduction),
      devise,
    ),
    factureDAvance: sommer(
      encours.map((e) => e.factureDAvance),
      devise,
    ),
  };
}

/** Taux de facturabilité = jours facturables réalisés / jours disponibles. */
export function tauxFacturabilite(
  joursFacturables: number,
  joursDisponibles: number,
): number | null {
  return ratio(versRationnel(joursFacturables), versRationnel(joursDisponibles));
}

export interface FactureEncaissee {
  readonly dateEmission: DateIso;
  readonly dateEncaissement: DateIso;
  readonly montant: Montant;
}

/**
 * Délai moyen d'encaissement en jours (2 décimales), `null` sans facture.
 * `ponderation = "montant"` pondère chaque délai par le montant encaissé
 * (toutes les factures dans la même devise).
 */
export function delaiMoyenEncaissement(
  factures: readonly FactureEncaissee[],
  ponderation: "simple" | "montant" = "simple",
): number | null {
  const poids = factures.map((f) => (ponderation === "simple" ? 1n : BigInt(f.montant.valeur)));
  const premiere = factures[0];
  if (premiere !== undefined && ponderation === "montant") {
    factures.forEach((f) => verifierMemeDevise(premiere.montant, f.montant));
  }
  const totalPoids = poids.reduce((a, b) => a + b, 0n);
  const somme = factures.reduce(
    (s, f, i) => s + BigInt(joursEntre(f.dateEmission, f.dateEncaissement)) * (poids[i] ?? 0n),
    0n,
  );
  if (totalPoids === 0n) return null;
  return Number(diviserArrondi(somme * 100n, totalPoids)) / 100;
}

export interface CommandeMission {
  readonly honorairesSignes: Montant;
  /** Honoraires déjà produits (valeur des temps au prix de vente, ou avancement). */
  readonly honorairesProduits: Montant;
}

/** Carnet de commandes : Σ max(0, signé − produit) sur les missions. */
export function carnetCommandes(missions: readonly CommandeMission[], devise: Devise): Montant {
  return missions.reduce((total, m) => {
    const reste = soustraire(m.honorairesSignes, m.honorairesProduits);
    return reste.valeur > 0 ? additionner(total, reste) : total;
  }, zero(devise));
}

export interface EcartTerminaison {
  /** Atterrissage − budget en jours (positif = dépassement). */
  readonly ecartJours: number;
  readonly ecartMontant: Montant;
  /** Écart en jours / budget en jours, `null` si budget nul. */
  readonly ecartRelatifJours: number | null;
}

/** Écart à terminaison. Exemple du PRD : 52,5 − 50 = +2,5 j (+0,05). */
export function ecartTerminaison(
  budget: { readonly jours: number; readonly montant: Montant },
  atterrissage: { readonly jours: number; readonly montant: Montant },
): EcartTerminaison {
  const ecartJours = differenceExacte(atterrissage.jours, budget.jours);
  return {
    ecartJours,
    ecartMontant: soustraire(atterrissage.montant, budget.montant),
    ecartRelatifJours: ratio(versRationnel(ecartJours), versRationnel(budget.jours)),
  };
}

/** Consommation budgétaire = jours réalisés / jours budgétés. */
export function consommationBudgetaire(
  joursRealises: number,
  joursBudgetes: number,
): number | null {
  return ratio(versRationnel(joursRealises), versRationnel(joursBudgetes));
}

export type AxeRentabilite = "mission" | "client" | "type" | "associe";

export interface RentabiliteMission extends ComposantesMarge {
  readonly missionId: string;
  readonly clientId: string;
  readonly type: string;
  readonly associeId: string;
}

export interface RentabiliteAgregee extends ComposantesMarge, Marge {
  readonly cle: string;
  readonly nombreMissions: number;
}

const CLE_AXE: Readonly<Record<AxeRentabilite, (m: RentabiliteMission) => string>> = {
  mission: (m) => m.missionId,
  client: (m) => m.clientId,
  type: (m) => m.type,
  associe: (m) => m.associeId,
};

function cumuler(a: ComposantesMarge, b: ComposantesMarge): ComposantesMarge {
  return {
    honoraires: additionner(a.honoraires, b.honoraires),
    coutsInternes: additionner(a.coutsInternes, b.coutsInternes),
    deboursNonRefactures: additionner(a.deboursNonRefactures, b.deboursNonRefactures),
    sousTraitance: additionner(a.sousTraitance, b.sousTraitance),
  };
}

/**
 * Agrège la rentabilité par mission, client, type ou associé (FIN-12). Les
 * montants doivent être dans une même devise (convertir avant). Le taux de
 * marge d'un groupe est recalculé sur les sommes, jamais moyenné. Résultat
 * trié par clé.
 */
export function agregerRentabilite(
  missions: readonly RentabiliteMission[],
  axe: AxeRentabilite,
): RentabiliteAgregee[] {
  const groupes = new Map<string, { composantes: ComposantesMarge; nombre: number }>();
  for (const m of missions) {
    const cle = CLE_AXE[axe](m);
    const existant = groupes.get(cle);
    groupes.set(cle, {
      composantes: existant === undefined ? m : cumuler(existant.composantes, m),
      nombre: (existant?.nombre ?? 0) + 1,
    });
  }
  return [...groupes.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([cle, g]) => ({
      cle,
      nombreMissions: g.nombre,
      honoraires: g.composantes.honoraires,
      coutsInternes: g.composantes.coutsInternes,
      deboursNonRefactures: g.composantes.deboursNonRefactures,
      sousTraitance: g.composantes.sousTraitance,
      ...calculerMarge(g.composantes),
    }));
}

/** Vérifie qu'un nombre de jours est fini et positif ou nul. */
export function verifierJours(jours: number, contexte: string): void {
  if (!Number.isFinite(jours) || jours < 0) {
    throw new ErreurFinance(
      "NOMBRE_INVALIDE",
      `${contexte} : nombre de jours invalide (${jours}).`,
    );
  }
}
