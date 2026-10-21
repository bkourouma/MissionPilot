/**
 * Suivi post-mission (RED-09, lot 2) : après la clôture du dossier, des jalons de suivi (par défaut
 * à 6 et 12 mois), des relevés des ratios du client et des ALERTES INTERNES au cabinet en cas de
 * retard ou de dégradation.
 *
 * Fonctions pures : aucune horloge (la date de référence est un paramètre), arithmétique entière,
 * aucune IA. Les alertes sont CALCULÉES À LA LECTURE, jamais stockées. Une dégradation est un
 * constat arithmétique (variation d'un ratio entre la référence de clôture et un relevé), jamais
 * une qualification juridique de la situation du client.
 *
 * Valeurs PROVISOIRES (à calibrer avec les consultants) : seuils de dégradation, délais de retard
 * et d'approche des jalons ci-dessous.
 */
import { diviserArrondi } from "../finance/calcul-exact";
import { ajouterMois } from "../finance/dates";
import { exigerEntier, jourDe } from "./commun";
import { ErreurRedressement } from "./erreurs";
import { CLES_RATIO_REDRESSEMENT, type CleRatioRedressement } from "./ratios";

/* ----- Constantes ----- */

/** Échéances par défaut, en mois après la date de clôture du dossier. */
export const MOIS_JALONS_PAR_DEFAUT = [6, 12] as const;
export const JALONS_SUIVI_MAX = 12;
export const MOIS_JALON_MAX = 60;
export const LIBELLE_JALON_MAX = 120;
/** Au plus 8 événements (réalisé, reports) par jalon. */
export const EVENEMENTS_JALON_MAX = 8;
export const RELEVES_PAR_JALON_MAX = 10;

/** PROVISOIRE : dégradation d'un ratio à partir de laquelle une information est émise (pb). */
export const SEUIL_DEGRADATION_INFORMATION_PB = 500;
/** PROVISOIRE : dégradation d'un ratio à partir de laquelle une attention est émise (pb). */
export const SEUIL_DEGRADATION_ATTENTION_PB = 1_500;
/** PROVISOIRE : retard (jours) à partir duquel un jalon échu passe de l'information à l'attention. */
export const RETARD_ATTENTION_JOURS = 30;
/** PROVISOIRE : un jalon à venir dans ce nombre de jours (inclus) est signalé. */
export const JALON_PROCHE_JOURS = 15;

/** Ratios suivis : les ratios en points de base du moteur de ratios (hors BFR, exprimé en jours). */
export const CLES_RATIO_SUIVI = CLES_RATIO_REDRESSEMENT.filter(
  (c) => c !== "bfr_jours",
) as readonly Exclude<CleRatioRedressement, "bfr_jours">[];
export type CleRatioSuivi = (typeof CLES_RATIO_SUIVI)[number];
export type RatiosSuivi = Readonly<Partial<Record<CleRatioSuivi, number>>>;

/** Borne d'une valeur de ratio saisie ou relevée (pb) : 10^8, comme les seuils de covenant. */
export const RATIO_SUIVI_PB_MAX = 100_000_000;

export const LIBELLES_RATIO_SUIVI: Record<CleRatioSuivi, string> = {
  liquidite_generale: "Liquidité générale",
  liquidite_reduite: "Liquidité réduite",
  liquidite_immediate: "Liquidité immédiate",
  autonomie_financiere: "Autonomie financière",
  solvabilite_generale: "Solvabilité générale",
  endettement: "Endettement",
  marge_brute: "Marge brute",
  marge_nette: "Marge nette",
  couverture_charges_financieres: "Couverture des charges financières",
};

/** Sens favorable d'un ratio : une baisse de l'endettement est une amélioration. */
const SENS_FAVORABLE: Record<CleRatioSuivi, "hausse" | "baisse"> = {
  liquidite_generale: "hausse",
  liquidite_reduite: "hausse",
  liquidite_immediate: "hausse",
  autonomie_financiere: "hausse",
  solvabilite_generale: "hausse",
  endettement: "baisse",
  marge_brute: "hausse",
  marge_nette: "hausse",
  couverture_charges_financieres: "hausse",
};

/* ----- Échéances des jalons ----- */

export interface EcheanceJalon {
  readonly rang: number;
  readonly mois: number;
  readonly libelle: string;
  /** AAAA-MM-JJ : date de clôture + `mois` mois (jour ramené à la fin du mois si besoin). */
  readonly datePrevue: string;
}

export function libelleJalonParDefaut(mois: number): string {
  return `Suivi à ${mois} mois`;
}

/**
 * Échéances des jalons à partir de la date de clôture : `mois` strictement croissants, de 1 à 60,
 * 1 à 12 jalons. `libelles` (facultatif, même longueur) personnalise les libellés.
 */
export function calculerEcheancesJalons(
  dateCloture: string,
  mois: readonly number[] = MOIS_JALONS_PAR_DEFAUT,
  libelles: readonly (string | null | undefined)[] = [],
): EcheanceJalon[] {
  jourDe(dateCloture, "Date de clôture");
  if (!Array.isArray(mois) || mois.length < 1 || mois.length > JALONS_SUIVI_MAX) {
    throw new ErreurRedressement(
      "ENTREE_INVALIDE",
      `Entre 1 et ${JALONS_SUIVI_MAX} jalons de suivi sont attendus.`,
    );
  }
  let precedent = 0;
  return mois.map((m, index) => {
    exigerEntier(m, 1, MOIS_JALON_MAX, "ENTREE_INVALIDE", "Échéance d'un jalon (mois)");
    if (m <= precedent) {
      throw new ErreurRedressement(
        "ENTREE_INVALIDE",
        "Les échéances des jalons sont strictement croissantes.",
      );
    }
    precedent = m;
    const libelle = libelles[index];
    if (typeof libelle === "string" && (libelle.length < 1 || libelle.length > LIBELLE_JALON_MAX)) {
      throw new ErreurRedressement(
        "ENTREE_INVALIDE",
        `Libellé d'un jalon : 1 à ${LIBELLE_JALON_MAX} caractères.`,
      );
    }
    return {
      rang: index + 1,
      mois: m,
      libelle: typeof libelle === "string" ? libelle : libelleJalonParDefaut(m),
      datePrevue: ajouterMois(dateCloture, m),
    };
  });
}

/* ----- État d'un jalon ----- */

export type TypeEvenementJalon = "realise" | "reporte";
export interface EvenementJalon {
  readonly type: TypeEvenementJalon;
  /** Réalisé : date de réalisation ; reporté : nouvelle date prévue. */
  readonly dateEffet: string;
}

export type StatutJalon = "a_venir" | "echu" | "realise";

export interface ReleveSuiviEntree {
  readonly id: string;
  readonly dateReleve: string;
  readonly ratios: RatiosSuivi;
}

export interface JalonSuiviEntree {
  readonly id: string;
  readonly rang: number;
  readonly libelle: string;
  /** Date prévue initiale. */
  readonly datePrevue: string;
  /** Événements dans l'ordre chronologique d'enregistrement. */
  readonly evenements: readonly EvenementJalon[];
  /** Relevés dans l'ordre chronologique d'enregistrement. */
  readonly releves: readonly ReleveSuiviEntree[];
}

export interface EtatJalon {
  readonly statut: StatutJalon;
  /** Date prévue courante (celle du dernier report, sinon l'initiale). */
  readonly datePrevueCourante: string;
  readonly nombreReports: number;
  readonly realiseLe: string | null;
  /** Jours de retard à la date de référence (> 0 si échu), sinon 0. */
  readonly retardJours: number;
  /** Jours restants avant la date prévue (>= 0 si à venir), sinon 0. */
  readonly joursRestants: number;
}

/** État d'un jalon à la date de référence : « échu » si non réalisé APRÈS la date prévue courante. */
export function evaluerJalon(
  jalon: Pick<JalonSuiviEntree, "datePrevue" | "evenements">,
  dateReference: string,
): EtatJalon {
  const ref = jourDe(dateReference, "Date de référence");
  jourDe(jalon.datePrevue, "Date prévue");
  let datePrevueCourante = jalon.datePrevue;
  let realiseLe: string | null = null;
  let nombreReports = 0;
  for (const e of jalon.evenements) {
    jourDe(e.dateEffet, "Date d'un événement de jalon");
    if (e.type === "reporte") {
      datePrevueCourante = e.dateEffet;
      nombreReports += 1;
    } else {
      realiseLe = e.dateEffet;
    }
  }
  if (realiseLe !== null) {
    return {
      statut: "realise",
      datePrevueCourante,
      nombreReports,
      realiseLe,
      retardJours: 0,
      joursRestants: 0,
    };
  }
  const prevu = jourDe(datePrevueCourante);
  if (ref > prevu) {
    return {
      statut: "echu",
      datePrevueCourante,
      nombreReports,
      realiseLe: null,
      retardJours: ref - prevu,
      joursRestants: 0,
    };
  }
  return {
    statut: "a_venir",
    datePrevueCourante,
    nombreReports,
    realiseLe: null,
    retardJours: 0,
    joursRestants: prevu - ref,
  };
}

export type RaisonEvenementRefuse =
  | "jalon_deja_realise"
  | "report_non_posterieur"
  | "realisation_avant_cloture"
  | "trop_d_evenements";

/**
 * Contrôle d'un nouvel événement (mêmes règles que les déclencheurs de la base) : retourne la
 * raison du refus, ou null. Un jalon réalisé ne bouge plus ; un report vise une date strictement
 * postérieure à la date prévue courante ; une réalisation ne précède pas la clôture.
 */
export function controlerEvenementJalon(
  jalon: Pick<JalonSuiviEntree, "datePrevue" | "evenements">,
  evenement: EvenementJalon,
  dateCloture: string,
): RaisonEvenementRefuse | null {
  const etat = evaluerJalon(jalon, "2000-01-01");
  if (etat.statut === "realise") return "jalon_deja_realise";
  if (jalon.evenements.length >= EVENEMENTS_JALON_MAX) return "trop_d_evenements";
  const cible = jourDe(evenement.dateEffet, "Date de l'événement");
  if (evenement.type === "reporte") {
    return cible > jourDe(etat.datePrevueCourante) ? null : "report_non_posterieur";
  }
  return cible < jourDe(dateCloture, "Date de clôture") ? "realisation_avant_cloture" : null;
}

/* ----- Comparaison à la référence de clôture ----- */

export type SensVariation = "amelioration" | "stable" | "degradation";
export type GraviteAlerteSuiviRed = "information" | "attention";

export interface ComparaisonRatio {
  readonly cle: CleRatioSuivi;
  readonly referencePb: number;
  readonly relevePb: number;
  /** Relevé − référence, signée (pb). */
  readonly variationPb: number;
  readonly sens: SensVariation;
  /** Gravité si la dégradation atteint un seuil, sinon null. */
  readonly gravite: GraviteAlerteSuiviRed | null;
}

function validerRatios(ratios: RatiosSuivi, nom: string): void {
  for (const [cle, valeur] of Object.entries(ratios)) {
    if (!(CLES_RATIO_SUIVI as readonly string[]).includes(cle)) {
      throw new ErreurRedressement("ENTREE_INVALIDE", `${nom} : ratio inconnu.`, [cle]);
    }
    exigerEntier(valeur, -RATIO_SUIVI_PB_MAX, RATIO_SUIVI_PB_MAX, "ENTREE_INVALIDE", nom);
  }
}

/**
 * Compare un relevé à la référence de clôture, ratio par ratio (ceux présents des deux côtés,
 * dans l'ordre de `CLES_RATIO_SUIVI`). Le sens tient compte du sens favorable de chaque ratio.
 */
export function comparerReleve(reference: RatiosSuivi, releve: RatiosSuivi): ComparaisonRatio[] {
  validerRatios(reference, "Référence de clôture");
  validerRatios(releve, "Relevé");
  const resultat: ComparaisonRatio[] = [];
  for (const cle of CLES_RATIO_SUIVI) {
    const ref = reference[cle];
    const val = releve[cle];
    if (ref === undefined || val === undefined) continue;
    const variationPb = val - ref;
    const defavorable = SENS_FAVORABLE[cle] === "hausse" ? -variationPb : variationPb;
    const sens: SensVariation =
      defavorable > 0 ? "degradation" : defavorable < 0 ? "amelioration" : "stable";
    const gravite: GraviteAlerteSuiviRed | null =
      defavorable >= SEUIL_DEGRADATION_ATTENTION_PB
        ? "attention"
        : defavorable >= SEUIL_DEGRADATION_INFORMATION_PB
          ? "information"
          : null;
    resultat.push({ cle, referencePb: ref, relevePb: val, variationPb, sens, gravite });
  }
  return resultat;
}

/* ----- Alertes internes ----- */

export type TypeAlerteSuiviRed =
  "jalon_echu" | "degradation_ratio" | "jalon_sans_releve" | "jalon_proche";

export interface AlerteSuiviRed {
  readonly type: TypeAlerteSuiviRed;
  readonly gravite: GraviteAlerteSuiviRed;
  readonly jalonId: string;
  readonly jalonRang: number;
  /** Ratio concerné (dégradation), sinon null. */
  readonly ratio: CleRatioSuivi | null;
  readonly libelle: string;
}

export interface EntreeSuivi {
  readonly dateReference: string;
  readonly jalons: readonly JalonSuiviEntree[];
  /** Ratios de l'état de clôture (référence) ; vide si aucun état accepté à la création du suivi. */
  readonly referenceRatios: RatiosSuivi;
}

export interface JalonEvalue {
  readonly id: string;
  readonly rang: number;
  readonly etat: EtatJalon;
  /** Dernier relevé du jalon comparé à la référence ; vide sans relevé ou sans référence. */
  readonly comparaisons: readonly ComparaisonRatio[];
  readonly dernierReleveId: string | null;
}

export interface ResultatSuivi {
  readonly jalons: readonly JalonEvalue[];
  readonly alertes: readonly AlerteSuiviRed[];
  readonly synthese: {
    readonly nombre: number;
    readonly attention: number;
    readonly information: number;
  };
}

const ORDRE_GRAVITE: Record<GraviteAlerteSuiviRed, number> = { attention: 0, information: 1 };
const ORDRE_TYPE: Record<TypeAlerteSuiviRed, number> = {
  jalon_echu: 0,
  degradation_ratio: 1,
  jalon_sans_releve: 2,
  jalon_proche: 3,
};

/** Pluriel français : « 1 jour », « 2 jours ». */
const jours = (n: number): string => (n <= 1 ? `${n} jour` : `${n} jours`);

/** Nombre décimal « 1,05 » (arrondi au centième, demi s'éloignant de zéro) depuis des points de base. */
export function formaterPbDecimal(pb: number): string {
  const centiemes = diviserArrondi(BigInt(Math.abs(pb)), 100n);
  const entier = centiemes / 100n;
  const reste = (centiemes % 100n).toString().padStart(2, "0");
  return `${pb < 0 && centiemes !== 0n ? "-" : ""}${entier},${reste}`;
}

/** Dernier relevé par date de relevé, à date égale le plus récemment enregistré. */
function dernierReleve(releves: readonly ReleveSuiviEntree[]): ReleveSuiviEntree | null {
  let retenu: ReleveSuiviEntree | null = null;
  for (const r of releves) {
    if (retenu === null || jourDe(r.dateReleve, "Date d'un relevé") >= jourDe(retenu.dateReleve)) {
      retenu = r;
    }
  }
  return retenu;
}

const rangRatio = (c: CleRatioSuivi | null): number =>
  c === null ? -1 : CLES_RATIO_SUIVI.indexOf(c);

/**
 * Évalue le suivi à la date de référence : état de chaque jalon, comparaison de son dernier relevé
 * à la référence de clôture, alertes internes triées (gravité, rang du jalon, type, ratio).
 */
export function evaluerSuivi(entree: EntreeSuivi): ResultatSuivi {
  jourDe(entree.dateReference, "Date de référence");
  const alertes: AlerteSuiviRed[] = [];
  const jalons: JalonEvalue[] = [];
  for (const jalon of [...entree.jalons].sort((a, b) => a.rang - b.rang)) {
    const etat = evaluerJalon(jalon, entree.dateReference);
    const dernier = dernierReleve(jalon.releves);
    const comparaisons = dernier ? comparerReleve(entree.referenceRatios, dernier.ratios) : [];
    jalons.push({
      id: jalon.id,
      rang: jalon.rang,
      etat,
      comparaisons,
      dernierReleveId: dernier?.id ?? null,
    });
    const base = { jalonId: jalon.id, jalonRang: jalon.rang, ratio: null };
    if (etat.statut === "echu") {
      alertes.push({
        ...base,
        type: "jalon_echu",
        gravite: etat.retardJours >= RETARD_ATTENTION_JOURS ? "attention" : "information",
        libelle: `Le jalon « ${jalon.libelle} » est échu depuis ${jours(etat.retardJours)} et n'est pas marqué réalisé.`,
      });
    } else if (etat.statut === "a_venir" && etat.joursRestants <= JALON_PROCHE_JOURS) {
      alertes.push({
        ...base,
        type: "jalon_proche",
        gravite: "information",
        libelle: `Le jalon « ${jalon.libelle} » arrive à échéance dans ${jours(etat.joursRestants)}.`,
      });
    } else if (etat.statut === "realise" && dernier === null) {
      alertes.push({
        ...base,
        type: "jalon_sans_releve",
        gravite: "information",
        libelle: `Le jalon « ${jalon.libelle} » est réalisé sans relevé des indicateurs du client.`,
      });
    }
    for (const c of comparaisons) {
      if (c.gravite === null) continue;
      alertes.push({
        type: "degradation_ratio",
        gravite: c.gravite,
        jalonId: jalon.id,
        jalonRang: jalon.rang,
        ratio: c.cle,
        libelle: `${LIBELLES_RATIO_SUIVI[c.cle]} : ${formaterPbDecimal(c.relevePb)} au relevé du jalon « ${jalon.libelle} », contre ${formaterPbDecimal(c.referencePb)} à la clôture (écart défavorable de ${formaterPbDecimal(Math.abs(c.variationPb))}).`,
      });
    }
  }
  alertes.sort(
    (a, b) =>
      ORDRE_GRAVITE[a.gravite] - ORDRE_GRAVITE[b.gravite] ||
      a.jalonRang - b.jalonRang ||
      ORDRE_TYPE[a.type] - ORDRE_TYPE[b.type] ||
      rangRatio(a.ratio) - rangRatio(b.ratio),
  );
  const attention = alertes.filter((a) => a.gravite === "attention").length;
  return {
    jalons,
    alertes,
    synthese: { nombre: alertes.length, attention, information: alertes.length - attention },
  };
}

/** Extrait les ratios suivis (valeurs calculées uniquement) d'un exercice du moteur de ratios. */
export function ratiosSuiviDepuisExercice(ratios: {
  readonly [K in CleRatioRedressement]?: { readonly valeur: number | null };
}): RatiosSuivi {
  const sortie: Partial<Record<CleRatioSuivi, number>> = {};
  for (const cle of CLES_RATIO_SUIVI) {
    const valeur = ratios[cle]?.valeur;
    if (typeof valeur === "number") sortie[cle] = valeur;
  }
  return sortie;
}
