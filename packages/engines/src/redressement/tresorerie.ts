/**
 * Trésorerie à 13 semaines (RED-06, RED-11) : prévision par catégorie, réalisé hebdomadaire,
 * soldes retenus, écarts, semaines de tension et besoin de financement.
 *
 * Le moteur est exact (entiers, sommes en `BigInt`) et ne qualifie rien : une « semaine de
 * tension » est un constat de solde projeté sous le seuil choisi, jamais une situation
 * juridique. La prévision « glisse » : à partir des semaines réalisées, le solde retenu est
 * le dernier solde constaté (ou l'ouverture plus le flux réalisé), et la prévision repart de
 * là. Écarts : toujours réalisé − prévu.
 */
import { type DateISO, dateISODepuisJourUTC } from "../commun/dates";
import { MONTANT_RED_MAX, exigerEntier, jourDe, jourDeLundi, versNombreSur } from "./commun";
import { ErreurRedressement } from "./erreurs";
import type { CategorieCreancierRed } from "./creanciers";

export const SEMAINES_TRESORERIE = 13;
const LIGNES_MAX = 600;

export const CATEGORIES_ENCAISSEMENT_RED = [
  "clients",
  "autres_encaissements",
  "financement",
  "cessions",
] as const;
export const CATEGORIES_DECAISSEMENT_RED = [
  "fournisseurs",
  "salaires",
  "fiscal_social",
  "loyers_charges",
  "service_dette",
  "investissements",
  "autres_decaissements",
] as const;
export type CategorieEncaissementRed = (typeof CATEGORIES_ENCAISSEMENT_RED)[number];
export type CategorieDecaissementRed = (typeof CATEGORIES_DECAISSEMENT_RED)[number];
export type SensFluxTresorerie = "encaissement" | "decaissement";

const CATEGORIES_PAR_SENS: Readonly<Record<SensFluxTresorerie, readonly string[]>> = {
  encaissement: CATEGORIES_ENCAISSEMENT_RED,
  decaissement: CATEGORIES_DECAISSEMENT_RED,
};

export interface LigneTresorerie {
  /** 1..13. */
  readonly semaine: number;
  readonly sens: SensFluxTresorerie;
  /** Doit appartenir à la liste du sens. */
  readonly categorie: string;
  /** Entier 1..10^13. */
  readonly montant: number;
}
export interface FluxRealise {
  readonly encaissement?: Readonly<Partial<Record<CategorieEncaissementRed, number>>>;
  readonly decaissement?: Readonly<Partial<Record<CategorieDecaissementRed, number>>>;
}
export interface RealiseSemaine {
  /** 1..13 (index dans la fenêtre de la version). */
  readonly semaine: number;
  readonly flux: FluxRealise;
  /** Solde bancaire de fin de semaine, ancre du solde retenu. */
  readonly soldeConstate: number | null;
}
export interface EntreeTresorerie {
  /** Lundi de la semaine 1. */
  readonly dateDebut: DateISO;
  /** Peut être négatif. */
  readonly soldeInitial: number;
  /** Entier ≥ 0. */
  readonly seuilTension: number;
  /** Au plus 600. */
  readonly lignes: readonly LigneTresorerie[];
  /** Doivent former le préfixe 1..k. */
  readonly realises: readonly RealiseSemaine[];
}
export interface EcartCategorie {
  readonly sens: SensFluxTresorerie;
  readonly categorie: string;
  readonly prevu: number;
  readonly realise: number | null;
  /** Réalisé − prévu. */
  readonly ecart: number | null;
}
export interface SemaineTresorerie {
  readonly semaine: number;
  /** Lundi. */
  readonly debut: DateISO;
  /** Dimanche. */
  readonly fin: DateISO;
  readonly encaissementsPrevus: number;
  readonly decaissementsPrevus: number;
  readonly fluxNetPrevu: number;
  /** Prévision pure, réalisés ignorés. */
  readonly soldeOuverturePrevu: number;
  readonly soldeCloturePrevu: number;
  readonly realise: null | {
    readonly encaissements: number;
    readonly decaissements: number;
    readonly fluxNet: number;
    readonly soldeConstate: number | null;
  };
  /** Réalisé − prévu. */
  readonly ecartEncaissements: number | null;
  /** Réalisé − prévu (positif = dépense en plus). */
  readonly ecartDecaissements: number | null;
  /** Réalisé − prévu (négatif = défavorable). */
  readonly ecartFluxNet: number | null;
  /** Solde constaté − (ouverture retenue + flux net réalisé). */
  readonly ecartRapprochement: number | null;
  readonly soldeOuvertureRetenu: number;
  /** Constaté, sinon ouverture retenue + flux (réalisés puis prévus). */
  readonly soldeClotureRetenu: number;
  /** soldeClotureRetenu < seuilTension. */
  readonly tension: boolean;
  readonly parCategorie: readonly EcartCategorie[];
}
export interface ResultatTresorerie {
  /** 13 semaines. */
  readonly semaines: readonly SemaineTresorerie[];
  /** Première semaine du minimum. */
  readonly soldeMinimum: { readonly semaine: number; readonly montant: number };
  readonly semainesTension: readonly number[];
  readonly premiereSemaineTension: number | null;
  /** max(0, seuilTension − soldeMinimum.montant). */
  readonly besoinFinancement: number;
  readonly derniereSemaineRealisee: number | null;
  /** Σ des écarts nets des semaines réalisées. */
  readonly ecartCumuleFluxNet: number;
  readonly totaux: {
    readonly encaissementsPrevus: number;
    readonly decaissementsPrevus: number;
    readonly fluxNetPrevu: number;
  };
}

const sensDe = (valeur: unknown): SensFluxTresorerie => {
  if (valeur !== "encaissement" && valeur !== "decaissement") {
    throw new ErreurRedressement("TRESORERIE_INVALIDE", "Sens de flux inconnu.");
  }
  return valeur;
};

/** Montants d'un réalisé, validés : `[sens, catégorie, montant]` dans l'ordre des listes. */
function lignesDeFlux(flux: FluxRealise): [SensFluxTresorerie, string, bigint][] {
  const resultat: [SensFluxTresorerie, string, bigint][] = [];
  for (const sens of ["encaissement", "decaissement"] as const) {
    const bloc: Readonly<Record<string, number | undefined>> | undefined = flux[sens];
    if (bloc === undefined) continue;
    for (const [categorie, montant] of Object.entries(bloc)) {
      if (!CATEGORIES_PAR_SENS[sens].includes(categorie)) {
        throw new ErreurRedressement("TRESORERIE_INVALIDE", "Catégorie de flux inconnue.");
      }
      exigerEntier(montant, 0, MONTANT_RED_MAX, "TRESORERIE_INVALIDE", "Montant réalisé");
    }
    for (const categorie of CATEGORIES_PAR_SENS[sens]) {
      const montant = bloc[categorie];
      if (montant !== undefined) resultat.push([sens, categorie, BigInt(montant)]);
    }
  }
  return resultat;
}

/** Totaux (encaissements, décaissements) d'un réalisé de semaine. */
export function totaliserFluxRealise(flux: FluxRealise): {
  encaissements: number;
  decaissements: number;
} {
  let encaissements = 0n;
  let decaissements = 0n;
  for (const [sens, , montant] of lignesDeFlux(flux)) {
    if (sens === "encaissement") encaissements += montant;
    else decaissements += montant;
  }
  return {
    encaissements: versNombreSur(encaissements),
    decaissements: versNombreSur(decaissements),
  };
}

const jourVersDate = (jour: number): DateISO => dateISODepuisJourUTC(jour);

/** Projette la trésorerie sur 13 semaines à partir d'une prévision et des réalisés. */
export function projeterTresorerie(entree: EntreeTresorerie): ResultatTresorerie {
  const jourDebut = jourDeLundi(entree.dateDebut, "Début de la fenêtre");
  const soldeInitial = BigInt(
    exigerEntier(
      entree.soldeInitial,
      -MONTANT_RED_MAX,
      MONTANT_RED_MAX,
      "TRESORERIE_INVALIDE",
      "Solde initial",
    ),
  );
  const seuil = BigInt(
    exigerEntier(
      entree.seuilTension,
      0,
      MONTANT_RED_MAX,
      "TRESORERIE_INVALIDE",
      "Seuil de tension",
    ),
  );
  if (entree.lignes.length > LIGNES_MAX) {
    throw new ErreurRedressement(
      "TRESORERIE_INVALIDE",
      "Trop de lignes de prévision (600 au plus).",
    );
  }

  // Prévu : (semaine, sens, catégorie) → montant.
  const prevu = new Map<string, bigint>();
  const cle = (semaine: number, sens: SensFluxTresorerie, categorie: string): string =>
    `${semaine}|${sens}|${categorie}`;
  for (const ligne of entree.lignes) {
    exigerEntier(ligne.semaine, 1, SEMAINES_TRESORERIE, "SEMAINE_INVALIDE", "Semaine");
    const sens = sensDe(ligne.sens);
    if (!CATEGORIES_PAR_SENS[sens].includes(ligne.categorie)) {
      throw new ErreurRedressement("TRESORERIE_INVALIDE", "Catégorie hors de la liste du sens.");
    }
    exigerEntier(ligne.montant, 1, MONTANT_RED_MAX, "TRESORERIE_INVALIDE", "Montant d'une ligne");
    const k = cle(ligne.semaine, sens, ligne.categorie);
    prevu.set(k, (prevu.get(k) ?? 0n) + BigInt(ligne.montant));
  }

  // Réalisés : préfixe contigu 1..k, sans doublon.
  const realises = [...entree.realises].sort((a, b) => a.semaine - b.semaine);
  realises.forEach((r, index) => {
    exigerEntier(r.semaine, 1, SEMAINES_TRESORERIE, "SEMAINE_INVALIDE", "Semaine réalisée");
    if (r.semaine !== index + 1) {
      throw new ErreurRedressement(
        "REALISE_NON_CONTIGU",
        "Les semaines réalisées forment le préfixe 1..k, sans trou ni doublon.",
      );
    }
    if (r.soldeConstate !== null) {
      exigerEntier(
        r.soldeConstate,
        -MONTANT_RED_MAX,
        MONTANT_RED_MAX,
        "TRESORERIE_INVALIDE",
        "Solde constaté",
      );
    }
  });
  const k = realises.length;

  const semaines: SemaineTresorerie[] = [];
  let ouverturePrevue = soldeInitial;
  let ouvertureRetenue = soldeInitial;
  let totalEnc = 0n;
  let totalDec = 0n;
  let ecartCumule = 0n;

  for (let numero = 1; numero <= SEMAINES_TRESORERIE; numero++) {
    let encPrevu = 0n;
    let decPrevu = 0n;
    const categoriesPrevues = new Map<string, bigint>(); // `${sens}|${categorie}` → prévu
    for (const sens of ["encaissement", "decaissement"] as const) {
      for (const categorie of CATEGORIES_PAR_SENS[sens]) {
        const montant = prevu.get(cle(numero, sens, categorie)) ?? 0n;
        categoriesPrevues.set(`${sens}|${categorie}`, montant);
        if (sens === "encaissement") encPrevu += montant;
        else decPrevu += montant;
      }
    }
    const netPrevu = encPrevu - decPrevu;
    const cloturePrevue = ouverturePrevue + netPrevu;
    totalEnc += encPrevu;
    totalDec += decPrevu;

    const realise = numero <= k ? (realises[numero - 1] as RealiseSemaine) : null;
    let encRealise = 0n;
    let decRealise = 0n;
    const categoriesRealisees = new Map<string, bigint>();
    if (realise !== null) {
      for (const [sens, categorie, montant] of lignesDeFlux(realise.flux)) {
        categoriesRealisees.set(`${sens}|${categorie}`, montant);
        if (sens === "encaissement") encRealise += montant;
        else decRealise += montant;
      }
    }
    const netRealise = encRealise - decRealise;
    const constate =
      realise === null || realise.soldeConstate === null ? null : BigInt(realise.soldeConstate);
    const clotureRetenue =
      constate ?? ouvertureRetenue + (realise === null ? netPrevu : netRealise);

    const parCategorie: EcartCategorie[] = [];
    for (const [categorieCle, montantPrevu] of categoriesPrevues) {
      const montantRealise = categoriesRealisees.get(categorieCle);
      const realiseNonNul = montantRealise !== undefined && montantRealise !== 0n;
      if (montantPrevu === 0n && !realiseNonNul) continue;
      const [sens, categorie] = categorieCle.split("|") as [SensFluxTresorerie, string];
      parCategorie.push({
        sens,
        categorie,
        prevu: versNombreSur(montantPrevu),
        realise: realise === null ? null : versNombreSur(montantRealise ?? 0n),
        ecart: realise === null ? null : versNombreSur((montantRealise ?? 0n) - montantPrevu),
      });
    }

    if (realise !== null) ecartCumule += netRealise - netPrevu;
    const jourSemaine = jourDebut + 7 * (numero - 1);
    semaines.push({
      semaine: numero,
      debut: jourVersDate(jourSemaine),
      fin: jourVersDate(jourSemaine + 6),
      encaissementsPrevus: versNombreSur(encPrevu),
      decaissementsPrevus: versNombreSur(decPrevu),
      fluxNetPrevu: versNombreSur(netPrevu),
      soldeOuverturePrevu: versNombreSur(ouverturePrevue),
      soldeCloturePrevu: versNombreSur(cloturePrevue),
      realise:
        realise === null
          ? null
          : {
              encaissements: versNombreSur(encRealise),
              decaissements: versNombreSur(decRealise),
              fluxNet: versNombreSur(netRealise),
              soldeConstate: constate === null ? null : versNombreSur(constate),
            },
      ecartEncaissements: realise === null ? null : versNombreSur(encRealise - encPrevu),
      ecartDecaissements: realise === null ? null : versNombreSur(decRealise - decPrevu),
      ecartFluxNet: realise === null ? null : versNombreSur(netRealise - netPrevu),
      ecartRapprochement:
        constate === null ? null : versNombreSur(constate - (ouvertureRetenue + netRealise)),
      soldeOuvertureRetenu: versNombreSur(ouvertureRetenue),
      soldeClotureRetenu: versNombreSur(clotureRetenue),
      tension: clotureRetenue < seuil,
      parCategorie,
    });
    ouverturePrevue = cloturePrevue;
    ouvertureRetenue = clotureRetenue;
  }

  let minimum = semaines[0] as SemaineTresorerie;
  for (const s of semaines) if (s.soldeClotureRetenu < minimum.soldeClotureRetenu) minimum = s;
  const semainesTension = semaines.filter((s) => s.tension).map((s) => s.semaine);
  const manque = seuil - BigInt(minimum.soldeClotureRetenu);
  return {
    semaines,
    soldeMinimum: { semaine: minimum.semaine, montant: minimum.soldeClotureRetenu },
    semainesTension,
    premiereSemaineTension: semainesTension[0] ?? null,
    besoinFinancement: versNombreSur(manque > 0n ? manque : 0n),
    derniereSemaineRealisee: k === 0 ? null : k,
    ecartCumuleFluxNet: versNombreSur(ecartCumule),
    totaux: {
      encaissementsPrevus: versNombreSur(totalEnc),
      decaissementsPrevus: versNombreSur(totalDec),
      fluxNetPrevu: versNombreSur(totalEnc - totalDec),
    },
  };
}

export interface EcheanceRestante {
  readonly echeanceId: string;
  readonly creancierId: string;
  readonly categorieCreancier: CategorieCreancierRed;
  readonly date: DateISO;
  /** Montant restant dû sur l'échéance (> 0). */
  readonly montant: number;
}
export interface LigneProposee extends LigneTresorerie {
  readonly echeanceId: string;
  readonly creancierId: string;
}
export interface PropositionEcheances {
  readonly lignes: readonly LigneProposee[];
  /** Échéances datées avant `dateDebut` (arriérés : à placer à la main). */
  readonly anterieures: number;
  /** Échéances au-delà de la semaine 13. */
  readonly ulterieures: number;
}

const CATEGORIE_FLUX_PAR_CREANCIER: Readonly<
  Record<CategorieCreancierRed, CategorieDecaissementRed>
> = {
  banque: "service_dette",
  fournisseur: "fournisseurs",
  fiscal: "fiscal_social",
  social: "fiscal_social",
  bailleur: "loyers_charges",
  autre: "autres_decaissements",
};

/** Convertit des échéances restantes d'accords en lignes proposées (n'écrit rien). */
export function echeancesVersLignes(
  echeances: readonly EcheanceRestante[],
  dateDebut: DateISO,
): PropositionEcheances {
  const jourDebut = jourDeLundi(dateDebut, "Début de la fenêtre");
  const lignes: LigneProposee[] = [];
  let anterieures = 0;
  let ulterieures = 0;
  for (const e of echeances) {
    const jour = jourDe(e.date, "Date d'échéance");
    exigerEntier(e.montant, 1, MONTANT_RED_MAX, "TRESORERIE_INVALIDE", "Montant d'échéance");
    const categorie = CATEGORIE_FLUX_PAR_CREANCIER[e.categorieCreancier];
    if (categorie === undefined) {
      throw new ErreurRedressement("TRESORERIE_INVALIDE", "Catégorie de créancier inconnue.");
    }
    if (jour < jourDebut) {
      anterieures += 1;
      continue;
    }
    const semaine = Math.floor((jour - jourDebut) / 7) + 1;
    if (semaine > SEMAINES_TRESORERIE) {
      ulterieures += 1;
      continue;
    }
    lignes.push({
      semaine,
      sens: "decaissement",
      categorie,
      montant: e.montant,
      echeanceId: e.echeanceId,
      creancierId: e.creancierId,
    });
  }
  lignes.sort(
    (a, b) =>
      a.semaine - b.semaine ||
      (a.echeanceId < b.echeanceId ? -1 : a.echeanceId > b.echeanceId ? 1 : 0),
  );
  return { lignes, anterieures, ulterieures };
}
