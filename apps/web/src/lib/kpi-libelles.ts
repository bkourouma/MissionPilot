/**
 * Libellés et mise en forme des chiffres du moteur KPI. Voir `kpi.ts`, point d'entrée du module.
 */
import {
  creerTraduire,
  LOCALES_INTL,
  type FrequenceKpiApi,
  type Langue,
  type NatureKpiApi,
  type PerspectiveKpi,
  type SensLectureKpiApi,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import {
  formaterDate,
  formaterNombre,
  formaterPourcentage,
  libelleUnite,
  VALEUR_ABSENTE,
} from "./format";
import type {
  AlerteEnregistree,
  AtteinteKpiVue,
  DefinitionKpi,
  DirectionKpi,
  EcartKpiVue,
  MesureKpi,
  MethodeProjectionKpi,
  ProjectionKpiVue,
  StatutKpi,
  TendanceKpiVue,
} from "./kpi-types";
import { SEUILS_STATUT_DEFAUT } from "./kpi-types";

// --- Libellés -------------------------------------------------------------------------------

interface LibelleTonalite {
  libelle: string;
  tonalite: TonaliteStatut;
}

/** Statut : libellé TOUJOURS écrit (la couleur et l'icône ne portent jamais seules le sens). */
export const STATUT_KPI: Record<StatutKpi, LibelleTonalite> = {
  vert: { libelle: "Vert : cible atteinte", tonalite: "succes" },
  orange: { libelle: "Orange : à surveiller", tonalite: "attention" },
  rouge: { libelle: "Rouge : en retard sur la cible", tonalite: "danger" },
  non_mesure: { libelle: "Non mesuré", tonalite: "neutre" },
  sans_cible: { libelle: "Sans cible", tonalite: "neutre" },
};

export const STATUT_KPI_EN: Record<StatutKpi, LibelleTonalite> = {
  vert: { libelle: "Green: target met", tonalite: "succes" },
  orange: { libelle: "Orange: to watch", tonalite: "attention" },
  rouge: { libelle: "Red: behind target", tonalite: "danger" },
  non_mesure: { libelle: "Not measured", tonalite: "neutre" },
  sans_cible: { libelle: "No target", tonalite: "neutre" },
};

export function libelleStatutKpi(
  statut: string | null | undefined,
  langue: Langue = "fr",
): LibelleTonalite {
  const table = langue === "en" ? STATUT_KPI_EN : STATUT_KPI;
  return statut && statut in table
    ? table[statut as StatutKpi]
    : { libelle: langue === "en" ? "Unknown status" : "Statut inconnu", tonalite: "neutre" };
}

export const SENS_LIBELLES: Record<SensLectureKpiApi, string> = {
  plus_haut_mieux: "Plus haut = mieux",
  plus_bas_mieux: "Plus bas = mieux",
};

export const SENS_LIBELLES_EN: Record<SensLectureKpiApi, string> = {
  plus_haut_mieux: "Higher = better",
  plus_bas_mieux: "Lower = better",
};

export const NATURE_LIBELLES: Record<NatureKpiApi, string> = {
  flux: "Flux : somme des mesures de la période",
  stock: "Stock : dernière valeur de la période",
};

export const NATURE_LIBELLES_EN: Record<NatureKpiApi, string> = {
  flux: "Flow: sum of the period's measurements",
  stock: "Stock: last value of the period",
};

export const FREQUENCE_LIBELLES: Record<FrequenceKpiApi, string> = {
  hebdomadaire: "Hebdomadaire",
  mensuelle: "Mensuelle",
  trimestrielle: "Trimestrielle",
  semestrielle: "Semestrielle",
  annuelle: "Annuelle",
};

export const FREQUENCE_LIBELLES_EN: Record<FrequenceKpiApi, string> = {
  hebdomadaire: "Weekly",
  mensuelle: "Monthly",
  trimestrielle: "Quarterly",
  semestrielle: "Semi-annual",
  annuelle: "Annual",
};

export const PERSPECTIVE_LIBELLES: Record<PerspectiveKpi, string> = {
  finances: "Finances",
  clients: "Clients",
  processus: "Processus internes",
  apprentissage: "Apprentissage et croissance",
};

export const PERSPECTIVE_LIBELLES_EN: Record<PerspectiveKpi, string> = {
  finances: "Finance",
  clients: "Clients",
  processus: "Internal processes",
  apprentissage: "Learning and growth",
};

export const SANS_PERSPECTIVE = "Sans perspective";
export const SANS_PERSPECTIVE_EN = "No perspective";

export const libellePerspective = (p: PerspectiveKpi | null | undefined, langue: Langue = "fr") =>
  langue === "en"
    ? p
      ? (PERSPECTIVE_LIBELLES_EN[p] ?? SANS_PERSPECTIVE_EN)
      : SANS_PERSPECTIVE_EN
    : p
      ? (PERSPECTIVE_LIBELLES[p] ?? SANS_PERSPECTIVE)
      : SANS_PERSPECTIVE;

/** Libellé d'un sens de lecture, d'une nature ou d'une fréquence dans la langue demandée. */
export const libelleSens = (c: SensLectureKpiApi, langue: Langue = "fr") =>
  (langue === "en" ? SENS_LIBELLES_EN : SENS_LIBELLES)[c];
export const libelleNature = (c: NatureKpiApi, langue: Langue = "fr") =>
  (langue === "en" ? NATURE_LIBELLES_EN : NATURE_LIBELLES)[c];
export const libelleFrequence = (c: FrequenceKpiApi, langue: Langue = "fr") =>
  (langue === "en" ? FREQUENCE_LIBELLES_EN : FREQUENCE_LIBELLES)[c];

export const METHODE_PROJECTION_LIBELLES: Record<MethodeProjectionKpi, string> = {
  prorata: "prorata temporel du cumul de la période",
  regression: "tendance linéaire des mesures",
  reconduction: "reconduction de la dernière valeur",
  aucune: "aucune mesure exploitable",
};

export const METHODE_PROJECTION_LIBELLES_EN: Record<MethodeProjectionKpi, string> = {
  prorata: "time-proportional share of the period's cumulative total",
  regression: "linear trend of the measurements",
  reconduction: "last value carried forward",
  aucune: "no usable measurement",
};

export const libelleMethodeProjection = (m: MethodeProjectionKpi, langue: Langue = "fr") =>
  (langue === "en" ? METHODE_PROJECTION_LIBELLES_EN : METHODE_PROJECTION_LIBELLES)[m] ?? m;

export const ORIGINE_LIBELLES: Record<MesureKpi["origine"], string> = {
  cabinet: "Cabinet",
  portail: "Portail client",
};

export const ORIGINE_LIBELLES_EN: Record<MesureKpi["origine"], string> = {
  cabinet: "Firm",
  portail: "Client portal",
};

export const libelleOrigine = (o: MesureKpi["origine"], langue: Langue = "fr") =>
  (langue === "en" ? ORIGINE_LIBELLES_EN : ORIGINE_LIBELLES)[o];

const MOIS = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
];
const MOIS_EN = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const MOIS_COURTS = [
  "janv.",
  "févr.",
  "mars",
  "avr.",
  "mai",
  "juin",
  "juil.",
  "août",
  "sept.",
  "oct.",
  "nov.",
  "déc.",
];
const MOIS_COURTS_EN = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const rangOrdinal = (n: number) => (n === 1 ? "1er" : `${n}e`);
const rangOrdinalEn = (n: number) => (n === 1 ? "1st" : n === 2 ? "2nd" : `${n}th`);

/**
 * Clé de période de l'API → libellé : « 2026-03 » → « mars 2026 », « 2026-W41 » →
 * « semaine 41 de 2026 », « 2026-T1 » → « 1er trimestre 2026 », « 2026-S2 » →
 * « 2e semestre 2026 », « 2026 » → « année 2026 ». Clé inconnue : rendue telle quelle.
 */
export function libellePeriode(cle: string | null | undefined, langue: Langue = "fr"): string {
  if (!cle) return VALEUR_ABSENTE;
  const en = langue === "en";
  let m = /^(\d{4})-W(\d{2})$/.exec(cle);
  if (m) return en ? `week ${Number(m[2])} of ${m[1]}` : `semaine ${Number(m[2])} de ${m[1]}`;
  m = /^(\d{4})-(\d{2})$/.exec(cle);
  if (m) {
    const mois = (en ? MOIS_EN : MOIS)[Number(m[2]) - 1];
    return mois ? `${mois} ${m[1]}` : cle;
  }
  m = /^(\d{4})-T([1-4])$/.exec(cle);
  if (m) {
    return en
      ? `${rangOrdinalEn(Number(m[2]))} quarter ${m[1]}`
      : `${rangOrdinal(Number(m[2]))} trimestre ${m[1]}`;
  }
  m = /^(\d{4})-S([12])$/.exec(cle);
  if (m) {
    return en
      ? `${rangOrdinalEn(Number(m[2]))} half ${m[1]}`
      : `${rangOrdinal(Number(m[2]))} semestre ${m[1]}`;
  }
  if (/^\d{4}$/.test(cle)) return en ? `year ${cle}` : `année ${cle}`;
  return cle;
}

/** Libellé court d'axe de graphique : « mars 26 », « S41 26 », « T1 26 », « S2 26 », « 2026 ». */
export function libellePeriodeCourt(cle: string, langue: Langue = "fr"): string {
  const en = langue === "en";
  let m = /^(\d{4})-W(\d{2})$/.exec(cle);
  if (m) return `${en ? "W" : "S"}${Number(m[2])} ${m[1]!.slice(2)}`;
  m = /^(\d{4})-(\d{2})$/.exec(cle);
  if (m) {
    const mois = (en ? MOIS_COURTS_EN : MOIS_COURTS)[Number(m[2]) - 1];
    return mois ? `${mois} ${m[1]!.slice(2)}` : cle;
  }
  m = /^(\d{4})-([TS])([1-4])$/.exec(cle);
  if (m) return `${en ? (m[2] === "T" ? "Q" : "H") : m[2]}${m[3]} ${m[1]!.slice(2)}`;
  return cle;
}

// --- Mise en forme des chiffres du moteur ------------------------------------------------------

const NBSP = "\u00a0";

/** Valeur d'un KPI avec son unité : « 1 250,5 kFCFA » (six décimales au plus, comme l'API). */
export function formaterValeurKpi(
  valeur: number | null | undefined,
  unite: string,
  langue: Langue = "fr",
): string {
  const n = formaterNombre(valeur, 6, langue);
  if (n === VALEUR_ABSENTE) return n;
  return unite ? `${n}${NBSP}${libelleUnite(unite)}` : n;
}

/** Taux d'atteinte ou score (fraction) → « 87,5 % ». */
export const formaterTauxKpi = (taux: number | null | undefined, langue: Langue = "fr") =>
  formaterPourcentage(taux, 1, langue);

function signe(v: number, options: Intl.NumberFormatOptions, langue: Langue = "fr"): string {
  return new Intl.NumberFormat(LOCALES_INTL[langue], {
    ...options,
    signDisplay: "exceptZero",
  }).format(v);
}

/**
 * Écart à la cible (calculé par le moteur) : « +120 kFCFA (+12 %), favorable ». « Favorable »
 * suit le sens de lecture du KPI (écart orienté positif ou nul).
 */
export function texteEcart(
  e: EcartKpiVue | null | undefined,
  unite: string,
  langue: Langue = "fr",
): string {
  if (!e || !Number.isFinite(e.ecart)) return VALEUR_ABSENTE;
  const t = creerTraduire(langue);
  const brut = `${signe(e.ecart, { maximumFractionDigits: 6 }, langue)}${unite ? `${NBSP}${libelleUnite(unite)}` : ""}`;
  const relatif =
    e.ecart_relatif === null || !Number.isFinite(e.ecart_relatif)
      ? ""
      : ` (${signe(e.ecart_relatif, { style: "percent", maximumFractionDigits: 1 }, langue)})`;
  return `${brut}${relatif}, ${e.ecart_oriente >= 0 ? t("favorable", "favorable") : t("défavorable", "unfavorable")}`;
}

/** Atteinte : « 87,5 % de la cible » ; cible nulle : atteinte binaire (respectée ou non). */
export function texteAtteinte(a: AtteinteKpiVue | null | undefined, langue: Langue = "fr"): string {
  if (!a) return VALEUR_ABSENTE;
  const t = creerTraduire(langue);
  if (a.mode === "binaire") {
    return a.taux >= 1
      ? t("Cible nulle respectée (100 %)", "Zero target met (100%)")
      : t("Cible nulle non respectée (0 %)", "Zero target not met (0%)");
  }
  const borne =
    a.borne === "plafond"
      ? t(" (plafonné)", " (capped)")
      : a.borne === "plancher"
        ? t(" (plancher atteint)", " (floor reached)")
        : "";
  return `${formaterTauxKpi(a.taux, langue)}${t(" de la cible", " of target")}${borne}`;
}

export interface DescriptionTendance {
  /** Flèche décorative (masquée aux lecteurs d'écran : le texte porte le sens). */
  fleche: "↑" | "↓" | "→" | "?";
  texte: string;
  tonalite: TonaliteStatut;
}

const FLECHES: Record<DirectionKpi, DescriptionTendance["fleche"]> = {
  hausse: "↑",
  baisse: "↓",
  stable: "→",
  indeterminee: "?",
};

/** Tendance du moteur → flèche ET texte (« En hausse : amélioration, sur 4 périodes »). */
export function descriptionTendance(
  tendance: TendanceKpiVue | null | undefined,
  langue: Langue = "fr",
): DescriptionTendance {
  const t = creerTraduire(langue);
  if (!tendance || tendance.direction === "indeterminee" || tendance.evolution === "indeterminee") {
    return {
      fleche: "?",
      texte: t(
        "Tendance indéterminée : moins de deux périodes closes mesurées",
        "Trend undetermined: fewer than two closed periods measured",
      ),
      tonalite: "neutre",
    };
  }
  const n = tendance.points;
  const sur = t(
    `, sur ${n} période${n > 1 ? "s" : ""} mesurée${n > 1 ? "s" : ""}`,
    `, over ${n} measured period${n > 1 ? "s" : ""}`,
  );
  if (tendance.direction === "stable" || tendance.evolution === "stable") {
    return { fleche: "→", texte: `${t("Stable", "Stable")}${sur}`, tonalite: "neutre" };
  }
  const direction = tendance.direction === "hausse" ? t("En hausse", "Up") : t("En baisse", "Down");
  const amelioration = tendance.evolution === "amelioration";
  return {
    fleche: FLECHES[tendance.direction],
    texte: `${direction} : ${amelioration ? t("amélioration", "improvement") : t("dégradation", "deterioration")}${sur}`,
    tonalite: amelioration ? "succes" : "danger",
  };
}

/** Projection à la fin de la période en cours, avec sa méthode (moteur). */
export function texteProjection(
  p: ProjectionKpiVue | null | undefined,
  unite: string,
  langue: Langue = "fr",
): string {
  const t = creerTraduire(langue);
  if (!p || p.valeur_projetee === null) {
    return t(
      "Projection indisponible : aucune mesure exploitable dans la période en cours.",
      "Projection unavailable: no usable measurement in the current period.",
    );
  }
  const methode = libelleMethodeProjection(p.methode, langue);
  const s = p.jours_ecoules > 1 ? "s" : "";
  return t(
    `${formaterValeurKpi(p.valeur_projetee, unite, langue)} en fin de période (${methode}, ${p.jours_ecoules} jour${s} écoulé${s} sur ${p.jours_total})`,
    `${formaterValeurKpi(p.valeur_projetee, unite, langue)} at period end (${methode}, ${p.jours_ecoules} day${s} elapsed of ${p.jours_total})`,
  );
}

/** Seuils de statut du KPI (ou ceux du moteur), écrits : « vert dès 95 %, orange dès 80 % ». */
export function texteSeuilsStatut(
  def: Pick<DefinitionKpi, "seuil_vert" | "seuil_orange">,
  langue: Langue = "fr",
): string {
  const t = creerTraduire(langue);
  const propres = def.seuil_vert !== null && def.seuil_orange !== null;
  const vert = propres ? (def.seuil_vert as number) : SEUILS_STATUT_DEFAUT.vert;
  const orange = propres ? (def.seuil_orange as number) : SEUILS_STATUT_DEFAUT.orange;
  const v = formaterTauxKpi(vert, langue);
  const o = formaterTauxKpi(orange, langue);
  return t(
    `Vert à partir de ${v} de la cible, orange de ${o} à ${v}, rouge en dessous de ${o}${propres ? " (seuils propres à ce KPI)" : " (seuils par défaut)"}.`,
    `Green from ${v} of target, orange from ${o} to ${v}, red below ${o}${propres ? " (thresholds specific to this KPI)" : " (default thresholds)"}.`,
  );
}

export interface DescriptionAlerte {
  titre: string;
  texte: string;
  tonalite: "attention" | "danger";
}

const nombreLu = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const texteLu = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** Alerte du moteur (tableau de bord) ou enregistrée → titre et phrase française. */
export function descriptionAlerte(
  alerte: { code: string; periode?: string | null } & Record<string, unknown>,
  unite: string,
  langue: Langue = "fr",
): DescriptionAlerte {
  const t = creerTraduire(langue);
  const periode = libellePeriode(texteLu(alerte.periode), langue);
  const valeur = (v: unknown) => formaterValeurKpi(nombreLu(v), unite, langue);
  switch (alerte.code) {
    case "DEGRADATION_CONSECUTIVE": {
      const n = nombreLu(alerte.periodes);
      const seuil = nombreLu(alerte.seuil) ?? VALEUR_ABSENTE;
      return {
        titre: t("Dégradation continue", "Continuous deterioration"),
        texte: t(
          `La valeur se dégrade depuis ${n ?? VALEUR_ABSENTE} périodes consécutives, jusqu'à ${periode} (alerte à partir de ${seuil}).`,
          `The value has been deteriorating for ${n ?? VALEUR_ABSENTE} consecutive periods, up to ${periode} (alert from ${seuil}).`,
        ),
        tonalite: "danger",
      };
    }
    case "MESURE_EN_RETARD": {
      const jours = nombreLu(alerte.jours_de_retard);
      const manquantes = nombreLu(alerte.periodes_manquantes) ?? 1;
      const derniere = libellePeriode(texteLu(alerte.derniere_periode_due), langue);
      const suite =
        manquantes > 1
          ? t(
              ` ${manquantes} périodes sont sans mesure, jusqu'à ${derniere}.`,
              ` ${manquantes} periods have no measurement, up to ${derniere}.`,
            )
          : "";
      const attendue = libellePeriode(texteLu(alerte.periode_attendue), langue);
      const echeance = formaterDate(texteLu(alerte.echeance), "UTC", langue);
      const retard = jours !== null && jours > 1 ? "s" : "";
      return {
        titre: t("Mesure en retard", "Measurement overdue"),
        texte: t(
          `Aucune mesure pour ${attendue}, attendue au plus tard le ${echeance} (${jours ?? VALEUR_ABSENTE} jour${retard} de retard).${suite}`,
          `No measurement for ${attendue}, due by ${echeance} (${jours ?? VALEUR_ABSENTE} day${retard} overdue).${suite}`,
        ),
        tonalite: "attention",
      };
    }
    case "SEUIL_HAUT":
      return {
        titre: t("Seuil d'alerte haut dépassé", "Upper alert threshold exceeded"),
        texte: t(
          `${capitaliser(periode)} : ${valeur(alerte.valeur)}, au-dessus du seuil de ${valeur(alerte.seuil)}.`,
          `${capitaliser(periode)}: ${valeur(alerte.valeur)}, above the threshold of ${valeur(alerte.seuil)}.`,
        ),
        tonalite: "danger",
      };
    case "SEUIL_BAS":
      return {
        titre: t("Seuil d'alerte bas franchi", "Lower alert threshold crossed"),
        texte: t(
          `${capitaliser(periode)} : ${valeur(alerte.valeur)}, en dessous du seuil de ${valeur(alerte.seuil)}.`,
          `${capitaliser(periode)}: ${valeur(alerte.valeur)}, below the threshold of ${valeur(alerte.seuil)}.`,
        ),
        tonalite: "danger",
      };
    case "VARIATION": {
      const relative = nombreLu(alerte.variation_relative);
      const variation =
        relative === null
          ? t("depuis une valeur nulle", "from a zero value")
          : signe(relative, { style: "percent", maximumFractionDigits: 1 }, langue);
      const admise = formaterTauxKpi(nombreLu(alerte.seuil), langue);
      return {
        titre: t("Variation inhabituelle", "Unusual variation"),
        texte: t(
          `${capitaliser(periode)} : ${valeur(alerte.valeur)} contre ${valeur(alerte.precedente)} la période précédente (${variation}), au-delà de la variation admise de ${admise}.`,
          `${capitaliser(periode)}: ${valeur(alerte.valeur)} versus ${valeur(alerte.precedente)} the previous period (${variation}), beyond the allowed variation of ${admise}.`,
        ),
        tonalite: "attention",
      };
    }
    default:
      return {
        titre: t("Alerte", "Alert"),
        texte: t(
          `Alerte signalée par le moteur pour ${periode}.`,
          `Alert raised by the engine for ${periode}.`,
        ),
        tonalite: "attention",
      };
  }
}

/** Alerte enregistrée (détails en objet) → même forme qu'une alerte du tableau de bord. */
export function alerteDepuisEnregistrement(
  a: AlerteEnregistree,
): { code: string; periode: string } & Record<string, unknown> {
  return { ...(a.details ?? {}), code: a.code, periode: a.periode };
}

function capitaliser(t: string): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}
