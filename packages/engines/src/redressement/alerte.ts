/**
 * Score d'alerte précoce (RED-10) : fonction pure de ratios, de tendances et d'incidents de
 * paiement, avec des seuils versionnés par secteur fixés par les experts du cabinet.
 *
 * Chaque critère vaut 0 (vert), 1 (orange) ou 2 (rouge) point, pondéré par son poids ; le score
 * est la part des points obtenus sur le maximum des critères évalués (0 à 100). Sous la part
 * minimale évaluée, le score est « insuffisant » (jamais un zéro rassurant). Inégalités
 * STRICTES : une valeur égale au seuil reste du côté « sain ».
 *
 * Le moteur ne qualifie RIEN : le score est un indicateur, jamais une situation juridique. Les
 * seuils par défaut sont PROVISOIRES (conventions, sans source : SPEC-3a §13.1) ; chaque score
 * est conservé avec ses entrées et un instantané des seuils (`seuils_source`).
 */
import { exigerEntier, quotientArrondi } from "./commun";
import { ErreurRedressement } from "./erreurs";
import type { CleRatioRedressement, RatiosExercice, TendancesRedressement } from "./ratios";

export const VERSION_MOTEUR_ALERTE = 1;

export const CRITERES_ALERTE = [
  "liquidite_generale",
  "liquidite_immediate",
  "autonomie_financiere",
  "endettement",
  "couverture_charges_financieres",
  "marge_nette",
  "bfr_jours",
  "croissance_ca",
  "variation_marge_brute",
  "rejets_bancaires_12m",
  "retards_fournisseurs_90j",
  "arrieres_fiscaux_sociaux",
] as const;
export type CritereAlerte = (typeof CRITERES_ALERTE)[number];
export type SensCritereAlerte = "bas_pire" | "haut_pire";

/** Intrinsèque au critère : les experts fixent les seuils, pas le sens. */
export const SENS_CRITERE_ALERTE: Readonly<Record<CritereAlerte, SensCritereAlerte>> = {
  liquidite_generale: "bas_pire",
  liquidite_immediate: "bas_pire",
  autonomie_financiere: "bas_pire",
  endettement: "haut_pire",
  couverture_charges_financieres: "bas_pire",
  marge_nette: "bas_pire",
  bfr_jours: "haut_pire",
  croissance_ca: "bas_pire",
  variation_marge_brute: "bas_pire",
  rejets_bancaires_12m: "haut_pire",
  retards_fournisseurs_90j: "haut_pire",
  arrieres_fiscaux_sociaux: "haut_pire",
};

export interface SeuilCritereAlerte {
  /** Entier (pb, jours, nombre d'incidents, 0/1). */
  readonly orange: number;
  readonly rouge: number;
  /** Entier 0..100. */
  readonly poids: number;
}
export interface NiveauxAlerte {
  readonly modere: number;
  readonly eleve: number;
  readonly critique: number;
}
export interface SeuilsAlerte {
  readonly criteres: Readonly<Record<CritereAlerte, SeuilCritereAlerte>>;
  readonly niveaux: NiveauxAlerte;
  /** Part du poids total qui doit être évaluée (défaut 50). */
  readonly partMinimaleEvalueePct: number;
}

/** Valeurs PROVISOIRES du secteur « général » : SPEC-3a §13.1, « convention, sans source ». */
export const SEUILS_ALERTE_DEFAUT: SeuilsAlerte = {
  criteres: {
    liquidite_generale: { orange: 12_000, rouge: 10_000, poids: 15 },
    liquidite_immediate: { orange: 2_000, rouge: 1_000, poids: 10 },
    autonomie_financiere: { orange: 2_500, rouge: 1_000, poids: 10 },
    endettement: { orange: 10_000, rouge: 20_000, poids: 10 },
    couverture_charges_financieres: { orange: 30_000, rouge: 15_000, poids: 10 },
    marge_nette: { orange: 200, rouge: 0, poids: 10 },
    bfr_jours: { orange: 60, rouge: 90, poids: 5 },
    croissance_ca: { orange: 0, rouge: -1_000, poids: 10 },
    variation_marge_brute: { orange: 0, rouge: -500, poids: 5 },
    rejets_bancaires_12m: { orange: 0, rouge: 2, poids: 5 },
    retards_fournisseurs_90j: { orange: 0, rouge: 4, poids: 5 },
    arrieres_fiscaux_sociaux: { orange: 0, rouge: 0, poids: 5 },
  },
  niveaux: { modere: 25, eleve: 50, critique: 75 },
  partMinimaleEvalueePct: 50,
};

const SEUIL_MAX = 1_000_000;

/** Valide des seuils (`SEUILS_INVALIDES`) : critères, bornes, sens, poids (somme 100), niveaux. */
export function validerSeuilsAlerte(s: SeuilsAlerte): void {
  const invalide = (message: string, critere?: string): never => {
    throw new ErreurRedressement(
      "SEUILS_INVALIDES",
      message,
      critere === undefined ? [] : [critere],
    );
  };
  const presents = Object.keys(s.criteres ?? {});
  if (
    presents.length !== CRITERES_ALERTE.length ||
    CRITERES_ALERTE.some((c) => !presents.includes(c))
  ) {
    return invalide("Les douze critères d'alerte, et eux seuls, sont attendus.");
  }
  let totalPoids = 0;
  for (const critere of CRITERES_ALERTE) {
    const seuil = s.criteres[critere];
    for (const borne of [seuil.orange, seuil.rouge]) {
      if (!Number.isSafeInteger(borne) || borne < -SEUIL_MAX || borne > SEUIL_MAX) {
        return invalide("Seuil entier entre -1 000 000 et 1 000 000 attendu.", critere);
      }
    }
    if (SENS_CRITERE_ALERTE[critere] === "bas_pire" && seuil.rouge > seuil.orange) {
      return invalide("Pour ce critère, le seuil rouge ne dépasse pas le seuil orange.", critere);
    }
    if (SENS_CRITERE_ALERTE[critere] === "haut_pire" && seuil.rouge < seuil.orange) {
      return invalide(
        "Pour ce critère, le seuil rouge n'est pas inférieur au seuil orange.",
        critere,
      );
    }
    if (!Number.isSafeInteger(seuil.poids) || seuil.poids < 0 || seuil.poids > 100) {
      return invalide("Poids entier entre 0 et 100 attendu.", critere);
    }
    totalPoids += seuil.poids;
  }
  if (totalPoids !== 100) return invalide("La somme des poids doit valoir 100.");
  const { modere, eleve, critique } = s.niveaux ?? ({} as Partial<NiveauxAlerte>);
  if (
    !Number.isSafeInteger(modere) ||
    !Number.isSafeInteger(eleve) ||
    !Number.isSafeInteger(critique) ||
    (modere as number) < 1 ||
    (modere as number) >= (eleve as number) ||
    (eleve as number) >= (critique as number) ||
    (critique as number) > 100
  ) {
    return invalide("Niveaux entiers croissants entre 1 et 100 attendus.");
  }
  if (
    !Number.isSafeInteger(s.partMinimaleEvalueePct) ||
    s.partMinimaleEvalueePct < 10 ||
    s.partMinimaleEvalueePct > 100
  ) {
    return invalide("Part minimale évaluée : entier entre 10 et 100 attendu.");
  }
}

export interface IncidentsPaiement {
  /** Entier 0..999 ; null = non renseigné. */
  readonly rejetsBancaires12m: number | null;
  /** Entier 0..999. */
  readonly retardsFournisseurs90j: number | null;
  readonly arrieresFiscauxSociaux: boolean | null;
}
export interface EntreesAlerte {
  /** Dernier exercice accepté. */
  readonly ratios: RatiosExercice | null;
  readonly tendances: TendancesRedressement | null;
  readonly incidents: IncidentsPaiement;
}

export type StatutCritereAlerte = "vert" | "orange" | "rouge" | "non_evalue";
export type MotifCritereAlerte =
  "signal_critique" | "sans_objet" | "non_calculable" | "non_renseigne";
export interface ResultatCritereAlerte {
  readonly critere: CritereAlerte;
  readonly valeur: number | null;
  readonly statut: StatutCritereAlerte;
  /** Vert 0, orange 1, rouge 2, non évalué null. */
  readonly points: 0 | 1 | 2 | null;
  readonly poids: number;
  readonly motif: MotifCritereAlerte | null;
}
export type NiveauAlerte = "insuffisant" | "faible" | "modere" | "eleve" | "critique";
export interface ScoreAlerte {
  /** VERSION_MOTEUR_ALERTE. */
  readonly version: number;
  /** Entier 0..100 ; null si niveau « insuffisant ». */
  readonly score: number | null;
  readonly niveau: NiveauAlerte;
  /** Ordre de CRITERES_ALERTE. */
  readonly criteres: readonly ResultatCritereAlerte[];
  /** Σ poids × points. */
  readonly pointsPonderes: number;
  readonly poidsEvalue: number;
  /** 100. */
  readonly poidsTotal: number;
  readonly criteresRouges: readonly CritereAlerte[];
  readonly criteresOranges: readonly CritereAlerte[];
}

/** `score < modere` → faible ; `< eleve` → modere ; `< critique` → eleve ; sinon critique. */
export function niveauDepuisScore(
  score: number,
  niveaux: NiveauxAlerte,
): Exclude<NiveauAlerte, "insuffisant"> {
  if (score < niveaux.modere) return "faible";
  if (score < niveaux.eleve) return "modere";
  if (score < niveaux.critique) return "eleve";
  return "critique";
}

const CRITERES_RATIO: Readonly<Partial<Record<CritereAlerte, CleRatioRedressement>>> = {
  liquidite_generale: "liquidite_generale",
  liquidite_immediate: "liquidite_immediate",
  autonomie_financiere: "autonomie_financiere",
  endettement: "endettement",
  couverture_charges_financieres: "couverture_charges_financieres",
  marge_nette: "marge_nette",
  bfr_jours: "bfr_jours",
};

const POINTS_STATUT = { vert: 0, orange: 1, rouge: 2 } as const;

function statutDepuisValeur(
  valeur: number,
  sens: SensCritereAlerte,
  seuil: SeuilCritereAlerte,
): "vert" | "orange" | "rouge" {
  if (sens === "bas_pire") {
    if (valeur < seuil.rouge) return "rouge";
    return valeur < seuil.orange ? "orange" : "vert";
  }
  if (valeur > seuil.rouge) return "rouge";
  return valeur > seuil.orange ? "orange" : "vert";
}

function validerIncidents(incidents: IncidentsPaiement): void {
  for (const nombre of [incidents.rejetsBancaires12m, incidents.retardsFournisseurs90j]) {
    if (nombre !== null) exigerEntier(nombre, 0, 999, "ENTREE_INVALIDE", "Nombre d'incidents");
  }
  const { arrieresFiscauxSociaux: arrieres } = incidents;
  if (arrieres !== null && typeof arrieres !== "boolean") {
    throw new ErreurRedressement("ENTREE_INVALIDE", "Arriérés : booléen ou non renseigné attendu.");
  }
}

/** Score d'alerte précoce : valide ses seuils et ses entrées avant tout calcul. */
export function calculerScoreAlerte(
  entrees: EntreesAlerte,
  seuils: SeuilsAlerte = SEUILS_ALERTE_DEFAUT,
): ScoreAlerte {
  validerSeuilsAlerte(seuils);
  validerIncidents(entrees.incidents);
  const { ratios, tendances, incidents } = entrees;

  const evaluer = (critere: CritereAlerte): ResultatCritereAlerte => {
    const seuil = seuils.criteres[critere];
    const sens = SENS_CRITERE_ALERTE[critere];
    const resultat = (
      valeur: number | null,
      statut: StatutCritereAlerte,
      motif: MotifCritereAlerte | null,
    ): ResultatCritereAlerte => ({
      critere,
      valeur,
      statut,
      points: statut === "non_evalue" ? null : POINTS_STATUT[statut],
      poids: seuil.poids,
      motif,
    });
    const depuisValeur = (valeur: number): ResultatCritereAlerte =>
      resultat(valeur, statutDepuisValeur(valeur, sens, seuil), null);
    const nonEvalue = (motif: MotifCritereAlerte): ResultatCritereAlerte =>
      resultat(null, "non_evalue", motif);

    const cleRatio = CRITERES_RATIO[critere];
    if (cleRatio !== undefined) {
      if (ratios === null) return nonEvalue("non_calculable");
      const ratio = ratios.ratios[cleRatio];
      if (ratio.statut === "calcule" && ratio.valeur !== null) return depuisValeur(ratio.valeur);
      if (ratio.statut === "sans_objet") return resultat(null, "vert", "sans_objet");
      if (ratio.statut === "non_significatif") return resultat(null, "rouge", "signal_critique");
      return nonEvalue("non_calculable");
    }
    switch (critere) {
      case "croissance_ca":
        return tendances?.croissanceCaPb == null
          ? nonEvalue("non_calculable")
          : depuisValeur(tendances.croissanceCaPb);
      case "variation_marge_brute":
        return tendances?.variationMargeBrutePb == null
          ? nonEvalue("non_calculable")
          : depuisValeur(tendances.variationMargeBrutePb);
      case "rejets_bancaires_12m":
        return incidents.rejetsBancaires12m === null
          ? nonEvalue("non_renseigne")
          : depuisValeur(incidents.rejetsBancaires12m);
      case "retards_fournisseurs_90j":
        return incidents.retardsFournisseurs90j === null
          ? nonEvalue("non_renseigne")
          : depuisValeur(incidents.retardsFournisseurs90j);
      default:
        return incidents.arrieresFiscauxSociaux === null
          ? nonEvalue("non_renseigne")
          : depuisValeur(incidents.arrieresFiscauxSociaux ? 1 : 0);
    }
  };

  const criteres = CRITERES_ALERTE.map(evaluer);
  const poidsTotal = criteres.reduce((s, c) => s + c.poids, 0);
  const evalues = criteres.filter((c) => c.points !== null);
  const poidsEvalue = evalues.reduce((s, c) => s + c.poids, 0);
  const pointsPonderes = evalues.reduce((s, c) => s + c.poids * (c.points ?? 0), 0);
  const criteresRouges = criteres.filter((c) => c.statut === "rouge").map((c) => c.critere);
  const criteresOranges = criteres.filter((c) => c.statut === "orange").map((c) => c.critere);

  if (poidsEvalue * 100 < seuils.partMinimaleEvalueePct * poidsTotal) {
    return {
      version: VERSION_MOTEUR_ALERTE,
      score: null,
      niveau: "insuffisant",
      criteres,
      pointsPonderes,
      poidsEvalue,
      poidsTotal,
      criteresRouges,
      criteresOranges,
    };
  }
  const score = Number(quotientArrondi(BigInt(100 * pointsPonderes), BigInt(2 * poidsEvalue)));
  return {
    version: VERSION_MOTEUR_ALERTE,
    score,
    niveau: niveauDepuisScore(score, seuils.niveaux),
    criteres,
    pointsPonderes,
    poidsEvalue,
    poidsTotal,
    criteresRouges,
    criteresOranges,
  };
}
