/**
 * Plan vivant (PLA-18) : re-prévision trimestrielle et écarts expliqués.
 *
 * Le plan validé n'est JAMAIS modifié : le moteur compare l'exercice PRÉVU
 * (un `ExercicePrevisionnel` du scénario de base d'un `ResultatPlanFinancier`,
 * avec sa trésorerie d'ouverture `fluxTresorerie.tresorerieOuverture`) à des
 * réalisés trimestriels, et rend une re-prévision annuelle, des écarts et une
 * décomposition de l'écart d'EBE. Fonctions pures et déterministes, entiers
 * de la devise, arithmétique BigInt exacte, aucun flottant dans les résultats.
 *
 * Arrondis (documentés) :
 * - répartition du prévu annuel : parts des trimestres 1 à 3 = annuel × pᵢ /
 *   1000 arrondi VERS ZÉRO, le reste sur le 4ᵉ trimestre (somme exacte) ;
 * - trésorerie prévue de fin de trimestre : ouverture + (clôture − ouverture)
 *   × cumul des pᵢ / 1000, arrondi au plus proche, demi s'éloignant de zéro ;
 *   le 4ᵉ trimestre vaut exactement la clôture prévue ;
 * - flux re-prévu du reste : reste prévu × facteur / 1000, même arrondi ;
 * - écart relatif : écart × 10000 / |prévu|, même arrondi (points de base,
 *   1/10000 = centième de pour cent).
 *
 * Re-prévision annuelle des flux = réalisé cumulé + reste prévu × facteur.
 * `reste_du_plan` : facteur 1. `tendance` : facteur = cumul réalisé / cumul
 * prévu du chiffre d'affaires (pour mille entier, borné à [500 ; 1500], 1000
 * si le cumul prévu est nul), appliqué au reste prévu des trois flux.
 *
 * Trésorerie de clôture re-prévue : PROJECTION SIMPLIFIÉE = trésorerie de
 * clôture prévue + (trésorerie réelle de fin du dernier trimestre réalisé −
 * trésorerie prévue au même trimestre) + (EBE re-prévu du reste − EBE prévu du
 * reste). Elle ne remplace pas un recalcul du modèle financier. Une valeur
 * dont une donnée nécessaire n'est pas saisie sur TOUS les trimestres réalisés
 * (résultat net, trésorerie) est `null`, jamais 0.
 *
 * Explication de l'écart d'EBE cumulé (rationnels exacts) : avec m_p = EBE_p /
 * CA_p, effet volume = (CA_r − CA_p) × m_p et effet de marge = CA_r × (m_r −
 * m_p) = EBE_r − CA_r × m_p ; l'effet volume est arrondi, l'effet de marge
 * reçoit le reste pour que la somme soit EXACTEMENT l'écart d'EBE. Le moteur
 * ne produit aucune prose : la liste ordonnée de `faits` (code stable,
 * libellé court, montant) est la liste blanche des chiffres que l'IA pourra
 * commenter.
 */
import { diviserArrondi } from "../finance/calcul-exact";
import { ErreurPlan } from "./erreurs";
import { versEntier } from "./exact";
import type { ExercicePrevisionnel } from "./modele";

export const TRIMESTRES_PAR_AN = 4;
export const METHODES_REPREVISION = ["reste_du_plan", "tendance"] as const;
export type MethodeReprevision = (typeof METHODES_REPREVISION)[number];
export const METHODE_REPREVISION_DEFAUT: MethodeReprevision = "reste_du_plan";
/** Répartition saisonnière par défaut, pour mille. */
export const REPARTITION_REPREVISION_DEFAUT: RepartitionTrimestres = [250, 250, 250, 250];
export const SEUIL_ECART_POUR_MILLE_DEFAUT = 100;
export const SEUIL_ECART_POUR_MILLE = { min: 1, max: 1000 } as const;
/** Bornes du facteur de la méthode « tendance », pour mille. */
export const FACTEUR_TENDANCE_MIN = 500;
export const FACTEUR_TENDANCE_MAX = 1500;
export const MOTEUR_REPREVISION = "engines/plan-strategique/reprevision@1";

export type RepartitionTrimestres = readonly [number, number, number, number];

export interface RealiseTrimestre {
  /** 1 à 4, consécutifs à partir du 1er. */
  readonly trimestre: number;
  readonly chiffreAffaires: number;
  readonly excedentBrutExploitation: number;
  readonly resultatNet: number | null;
  /** Trésorerie de fin de trimestre ; null si non saisie. */
  readonly tresorerieFin: number | null;
}

export interface EntreeReprevision {
  readonly exercice: ExercicePrevisionnel;
  readonly realises: readonly RealiseTrimestre[];
  readonly repartition?: RepartitionTrimestres;
  readonly methode?: MethodeReprevision;
  readonly seuilEcartPourMille?: number;
}

export interface PrevuTrimestre {
  readonly trimestre: number;
  readonly chiffreAffaires: number;
  readonly excedentBrutExploitation: number;
  readonly resultatNet: number;
  readonly tresorerieFin: number;
}

export interface EcartMesure {
  readonly prevu: number;
  /** Réalisé (ou re-prévu pour l'écart annuel) ; null si non saisi. */
  readonly reel: number | null;
  /** reel − prevu ; null si reel est absent. */
  readonly ecart: number | null;
  /** Écart relatif en points de base (1/10000) ; null si prévu nul ou réel absent. */
  readonly ecartRelatifPointsDeBase: number | null;
  /** |écart relatif| ≥ seuil ; faux si l'écart relatif n'existe pas. */
  readonly significatif: boolean;
}

export interface EcartsTrimestre {
  readonly trimestre: number;
  readonly chiffreAffaires: EcartMesure;
  readonly excedentBrutExploitation: EcartMesure;
  readonly resultatNet: EcartMesure;
  readonly tresorerieFin: EcartMesure;
}

/** Cumul depuis le 1er trimestre jusqu'au trimestre indiqué (flux uniquement). */
export interface EcartsCumules {
  readonly trimestre: number;
  readonly chiffreAffaires: EcartMesure;
  readonly excedentBrutExploitation: EcartMesure;
  readonly resultatNet: EcartMesure;
}

export interface MesuresAnnuelles {
  readonly chiffreAffaires: number;
  readonly excedentBrutExploitation: number;
  readonly resultatNet: number;
  readonly tresorerieCloture: number;
}

export interface ReprevisionAnnuelle {
  readonly chiffreAffaires: number;
  readonly excedentBrutExploitation: number;
  /** null si le résultat net n'est pas saisi sur tous les trimestres réalisés. */
  readonly resultatNet: number | null;
  /** Projection simplifiée ; null si la trésorerie n'est pas saisie partout. */
  readonly tresorerieCloture: number | null;
}

export interface EcartsAnnuels {
  readonly chiffreAffaires: EcartMesure;
  readonly excedentBrutExploitation: EcartMesure;
  readonly resultatNet: EcartMesure;
  readonly tresorerieCloture: EcartMesure;
}

export interface ExplicationEcartEbe {
  readonly chiffreAffairesPrevu: number;
  readonly chiffreAffairesReel: number;
  readonly ebePrevu: number;
  readonly ebeReel: number;
  readonly ecartEbe: number;
  readonly effetVolume: number;
  readonly effetMarge: number;
  /** Taux de marge d'EBE prévu, points de base. */
  readonly tauxMargePrevuPointsDeBase: number;
  /** Taux de marge d'EBE réel, points de base ; null si le chiffre d'affaires réel est nul. */
  readonly tauxMargeReelPointsDeBase: number | null;
}

export interface FaitReprevision {
  readonly code: string;
  readonly libelle: string;
  readonly montant: number;
}

export interface ResultatReprevision {
  readonly moteur: typeof MOTEUR_REPREVISION;
  readonly methode: MethodeReprevision;
  readonly seuilEcartPourMille: number;
  readonly repartition: RepartitionTrimestres;
  readonly trimestresRealises: number;
  /** Facteur appliqué au reste prévu des flux, pour mille (1000 = reste du plan). */
  readonly facteurPourMille: number;
  readonly prevuTrimestres: readonly PrevuTrimestre[];
  readonly prevuAnnuel: MesuresAnnuelles;
  readonly reprevision: ReprevisionAnnuelle;
  readonly ecartsTrimestres: readonly EcartsTrimestre[];
  readonly ecartsCumules: readonly EcartsCumules[];
  readonly ecartsAnnuels: EcartsAnnuels;
  /** null si le chiffre d'affaires prévu cumulé est nul. */
  readonly explicationEbe: ExplicationEcartEbe | null;
  readonly faits: readonly FaitReprevision[];
}

function invalide(message: string, chemin = ""): never {
  throw new ErreurPlan("REPREVISION_INVALIDE", message, chemin);
}

function montant(valeur: unknown, nom: string, chemin: string): bigint {
  if (typeof valeur !== "number" || !Number.isSafeInteger(valeur)) {
    invalide(`${nom} : montant entier attendu.`, chemin);
  }
  return BigInt(valeur);
}

function montantOuNull(valeur: unknown, nom: string, chemin: string): bigint | null {
  return valeur === null ? null : montant(valeur, nom, chemin);
}

function valeurAbsolue(n: bigint): bigint {
  return n < 0n ? -n : n;
}

function somme(valeurs: readonly bigint[]): bigint {
  return valeurs.reduce((s, v) => s + v, 0n);
}

/** Parts des trimestres 1 à 3 arrondies vers zéro, le reste sur le 4ᵉ. */
function repartir(annuel: bigint, repartition: RepartitionTrimestres): bigint[] {
  const parts = repartition.slice(0, 3).map((p) => (annuel * BigInt(p)) / 1000n);
  return [...parts, annuel - somme(parts)];
}

function ecartMesure(prevu: bigint, reel: bigint | null, seuilPourMille: number): EcartMesure {
  if (reel === null) {
    return {
      prevu: versEntier(prevu),
      reel: null,
      ecart: null,
      ecartRelatifPointsDeBase: null,
      significatif: false,
    };
  }
  const ecart = reel - prevu;
  const relatif =
    prevu === 0n ? null : versEntier(diviserArrondi(ecart * 10000n, valeurAbsolue(prevu)));
  return {
    prevu: versEntier(prevu),
    reel: versEntier(reel),
    ecart: versEntier(ecart),
    ecartRelatifPointsDeBase: relatif,
    significatif: relatif !== null && Math.abs(relatif) >= seuilPourMille * 10,
  };
}

function validerParametres(entree: EntreeReprevision) {
  const { exercice, realises } = entree;
  if (!exercice?.compteResultat || !exercice.fluxTresorerie) {
    invalide("Exercice prévisionnel absent ou incomplet.", "exercice");
  }
  const methode = entree.methode ?? METHODE_REPREVISION_DEFAUT;
  if (!METHODES_REPREVISION.includes(methode)) {
    invalide(`Méthode de re-prévision inconnue : « ${String(methode)} ».`, "methode");
  }
  const seuil = entree.seuilEcartPourMille ?? SEUIL_ECART_POUR_MILLE_DEFAUT;
  if (
    !Number.isInteger(seuil) ||
    seuil < SEUIL_ECART_POUR_MILLE.min ||
    seuil > SEUIL_ECART_POUR_MILLE.max
  ) {
    invalide(
      `Seuil d'écart : entier de ${SEUIL_ECART_POUR_MILLE.min} à ${SEUIL_ECART_POUR_MILLE.max} pour mille attendu.`,
      "seuilEcartPourMille",
    );
  }
  const repartition = entree.repartition ?? REPARTITION_REPREVISION_DEFAUT;
  if (
    !Array.isArray(repartition) ||
    repartition.length !== TRIMESTRES_PAR_AN ||
    repartition.some((p) => !Number.isInteger(p) || p < 0 || p > 1000)
  ) {
    invalide("Répartition : quatre entiers de 0 à 1000 pour mille attendus.", "repartition");
  }
  if (repartition.reduce((s, p) => s + p, 0) !== 1000) {
    invalide("Répartition : la somme des quatre parts doit valoir 1000 pour mille.", "repartition");
  }
  if (!Array.isArray(realises) || realises.length < 1 || realises.length > TRIMESTRES_PAR_AN) {
    invalide(`Réalisés : de 1 à ${TRIMESTRES_PAR_AN} trimestres attendus.`, "realises");
  }
  realises.forEach((r, i) => {
    if (r?.trimestre !== i + 1) {
      invalide(
        `Réalisés : trimestres consécutifs à partir du 1er attendus (trimestre ${i + 1}).`,
        `realises[${i}].trimestre`,
      );
    }
  });
  return { methode, seuil, repartition: repartition as RepartitionTrimestres };
}

/** Compare le prévu annuel à des réalisés trimestriels et re-prévoit l'exercice. */
export function reprevoirExercice(entree: EntreeReprevision): ResultatReprevision {
  const { methode, seuil, repartition } = validerParametres(entree);
  const { exercice, realises } = entree;
  const cr = exercice.compteResultat;
  const annuelCA = montant(cr.chiffreAffaires, "Chiffre d'affaires prévu", "exercice");
  const annuelEBE = montant(cr.excedentBrutExploitation, "EBE prévu", "exercice");
  const annuelRN = montant(cr.resultatNet, "Résultat net prévu", "exercice");
  const ouverture = montant(
    exercice.fluxTresorerie.tresorerieOuverture,
    "Trésorerie d'ouverture",
    "exercice",
  );
  const cloture = montant(
    exercice.fluxTresorerie.tresorerieCloture,
    "Trésorerie de clôture",
    "exercice",
  );

  const reels = realises.map((r, i) => {
    const chemin = `realises[${i}]`;
    return {
      ca: montant(r.chiffreAffaires, "Chiffre d'affaires réalisé", `${chemin}.chiffreAffaires`),
      ebe: montant(r.excedentBrutExploitation, "EBE réalisé", `${chemin}.excedentBrutExploitation`),
      rn: montantOuNull(r.resultatNet, "Résultat net réalisé", `${chemin}.resultatNet`),
      treso: montantOuNull(r.tresorerieFin, "Trésorerie réalisée", `${chemin}.tresorerieFin`),
    };
  });
  const k = reels.length;

  // Prévu par trimestre.
  const partsCA = repartir(annuelCA, repartition);
  const partsEBE = repartir(annuelEBE, repartition);
  const partsRN = repartir(annuelRN, repartition);
  let cumulRepartition = 0;
  const tresoPrevue = repartition.map((p) => {
    cumulRepartition += p;
    return ouverture + diviserArrondi((cloture - ouverture) * BigInt(cumulRepartition), 1000n);
  });
  const prevuTrimestres: PrevuTrimestre[] = partsCA.map((ca, i) => ({
    trimestre: i + 1,
    chiffreAffaires: versEntier(ca),
    excedentBrutExploitation: versEntier(partsEBE[i] as bigint),
    resultatNet: versEntier(partsRN[i] as bigint),
    tresorerieFin: versEntier(tresoPrevue[i] as bigint),
  }));

  // Écarts par trimestre et en cumul.
  const ecartsTrimestres: EcartsTrimestre[] = [];
  const ecartsCumules: EcartsCumules[] = [];
  let cumPrevu = { ca: 0n, ebe: 0n, rn: 0n };
  let cumReel = { ca: 0n, ebe: 0n, rn: 0n as bigint | null };
  reels.forEach((r, i) => {
    const pca = partsCA[i] as bigint;
    const pebe = partsEBE[i] as bigint;
    const prn = partsRN[i] as bigint;
    ecartsTrimestres.push({
      trimestre: i + 1,
      chiffreAffaires: ecartMesure(pca, r.ca, seuil),
      excedentBrutExploitation: ecartMesure(pebe, r.ebe, seuil),
      resultatNet: ecartMesure(prn, r.rn, seuil),
      tresorerieFin: ecartMesure(tresoPrevue[i] as bigint, r.treso, seuil),
    });
    cumPrevu = { ca: cumPrevu.ca + pca, ebe: cumPrevu.ebe + pebe, rn: cumPrevu.rn + prn };
    cumReel = {
      ca: cumReel.ca + r.ca,
      ebe: cumReel.ebe + r.ebe,
      rn: cumReel.rn === null || r.rn === null ? null : cumReel.rn + r.rn,
    };
    ecartsCumules.push({
      trimestre: i + 1,
      chiffreAffaires: ecartMesure(cumPrevu.ca, cumReel.ca, seuil),
      excedentBrutExploitation: ecartMesure(cumPrevu.ebe, cumReel.ebe, seuil),
      resultatNet: ecartMesure(cumPrevu.rn, cumReel.rn, seuil),
    });
  });

  // Re-prévision annuelle.
  let facteur = 1000;
  if (methode === "tendance" && cumPrevu.ca !== 0n) {
    const brut = diviserArrondi(cumReel.ca * 1000n, cumPrevu.ca);
    facteur = Number(
      brut < BigInt(FACTEUR_TENDANCE_MIN)
        ? FACTEUR_TENDANCE_MIN
        : brut > BigInt(FACTEUR_TENDANCE_MAX)
          ? FACTEUR_TENDANCE_MAX
          : brut,
    );
  }
  const resteReprevu = (reste: bigint): bigint => diviserArrondi(reste * BigInt(facteur), 1000n);
  const resteCA = annuelCA - cumPrevu.ca;
  const resteEBE = annuelEBE - cumPrevu.ebe;
  const resteRN = annuelRN - cumPrevu.rn;
  const caReprevu = cumReel.ca + resteReprevu(resteCA);
  const ebeReprevu = cumReel.ebe + resteReprevu(resteEBE);
  const rnReprevu = cumReel.rn === null ? null : cumReel.rn + resteReprevu(resteRN);
  const derniereTreso = reels[k - 1]?.treso ?? null;
  const toutesTresos = reels.every((r) => r.treso !== null);
  const tresoReprevue =
    toutesTresos && derniereTreso !== null
      ? cloture +
        (derniereTreso - (tresoPrevue[k - 1] as bigint)) +
        (resteReprevu(resteEBE) - resteEBE)
      : null;

  const ecartsAnnuels: EcartsAnnuels = {
    chiffreAffaires: ecartMesure(annuelCA, caReprevu, seuil),
    excedentBrutExploitation: ecartMesure(annuelEBE, ebeReprevu, seuil),
    resultatNet: ecartMesure(annuelRN, rnReprevu, seuil),
    tresorerieCloture: ecartMesure(cloture, tresoReprevue, seuil),
  };

  // Explication de l'écart d'EBE cumulé.
  let explicationEbe: ExplicationEcartEbe | null = null;
  if (cumPrevu.ca !== 0n) {
    const ecartEbe = cumReel.ebe - cumPrevu.ebe;
    const effetVolume = diviserArrondi((cumReel.ca - cumPrevu.ca) * cumPrevu.ebe, cumPrevu.ca);
    explicationEbe = {
      chiffreAffairesPrevu: versEntier(cumPrevu.ca),
      chiffreAffairesReel: versEntier(cumReel.ca),
      ebePrevu: versEntier(cumPrevu.ebe),
      ebeReel: versEntier(cumReel.ebe),
      ecartEbe: versEntier(ecartEbe),
      effetVolume: versEntier(effetVolume),
      effetMarge: versEntier(ecartEbe - effetVolume),
      tauxMargePrevuPointsDeBase: versEntier(diviserArrondi(cumPrevu.ebe * 10000n, cumPrevu.ca)),
      tauxMargeReelPointsDeBase:
        cumReel.ca === 0n ? null : versEntier(diviserArrondi(cumReel.ebe * 10000n, cumReel.ca)),
    };
  }

  // Faits structurés (montants non nuls de calcul uniquement : jamais d'invention).
  const faits: FaitReprevision[] = [];
  const ajouter = (code: string, libelle: string, valeur: number | null) => {
    if (valeur !== null) faits.push({ code, libelle, montant: valeur });
  };
  const dernierCumul = ecartsCumules[k - 1] as EcartsCumules;
  const dernierTrimestre = ecartsTrimestres[k - 1] as EcartsTrimestre;
  ajouter(
    "ECART_CA_CUMULE",
    "Écart de chiffre d'affaires cumulé",
    dernierCumul.chiffreAffaires.ecart,
  );
  ajouter("ECART_EBE_CUMULE", "Écart d'EBE cumulé", dernierCumul.excedentBrutExploitation.ecart);
  ajouter("EFFET_VOLUME_EBE", "Effet volume sur l'EBE cumulé", explicationEbe?.effetVolume ?? null);
  ajouter("EFFET_MARGE_EBE", "Effet de marge sur l'EBE cumulé", explicationEbe?.effetMarge ?? null);
  ajouter(
    "ECART_RESULTAT_NET_CUMULE",
    "Écart de résultat net cumulé",
    dernierCumul.resultatNet.ecart,
  );
  ajouter(
    "ECART_TRESORERIE_FIN_TRIMESTRE",
    "Écart de trésorerie en fin de dernier trimestre réalisé",
    dernierTrimestre.tresorerieFin.ecart,
  );
  ajouter(
    "ECART_ANNUEL_CA",
    "Écart annuel de chiffre d'affaires",
    ecartsAnnuels.chiffreAffaires.ecart,
  );
  ajouter("ECART_ANNUEL_EBE", "Écart annuel d'EBE", ecartsAnnuels.excedentBrutExploitation.ecart);
  ajouter(
    "ECART_ANNUEL_RESULTAT_NET",
    "Écart annuel de résultat net",
    ecartsAnnuels.resultatNet.ecart,
  );
  ajouter(
    "ECART_ANNUEL_TRESORERIE_CLOTURE",
    "Écart annuel de trésorerie de clôture (projection simplifiée)",
    ecartsAnnuels.tresorerieCloture.ecart,
  );

  return {
    moteur: MOTEUR_REPREVISION,
    methode,
    seuilEcartPourMille: seuil,
    repartition: [...repartition] as unknown as RepartitionTrimestres,
    trimestresRealises: k,
    facteurPourMille: facteur,
    prevuTrimestres,
    prevuAnnuel: {
      chiffreAffaires: versEntier(annuelCA),
      excedentBrutExploitation: versEntier(annuelEBE),
      resultatNet: versEntier(annuelRN),
      tresorerieCloture: versEntier(cloture),
    },
    reprevision: {
      chiffreAffaires: versEntier(caReprevu),
      excedentBrutExploitation: versEntier(ebeReprevu),
      resultatNet: rnReprevu === null ? null : versEntier(rnReprevu),
      tresorerieCloture: tresoReprevue === null ? null : versEntier(tresoReprevue),
    },
    ecartsTrimestres,
    ecartsCumules,
    ecartsAnnuels,
    explicationEbe,
    faits,
  };
}
