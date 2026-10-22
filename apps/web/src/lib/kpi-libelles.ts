/**
 * Libellés et mise en forme des chiffres du moteur KPI. Voir `kpi.ts`, point d'entrée du module.
 */
import type {
  FrequenceKpiApi,
  NatureKpiApi,
  PerspectiveKpi,
  SensLectureKpiApi,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import { formaterDate, formaterNombre, formaterPourcentage, VALEUR_ABSENTE } from "./format";
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

export function libelleStatutKpi(statut: string | null | undefined): LibelleTonalite {
  return statut && statut in STATUT_KPI
    ? STATUT_KPI[statut as StatutKpi]
    : { libelle: "Statut inconnu", tonalite: "neutre" };
}

export const SENS_LIBELLES: Record<SensLectureKpiApi, string> = {
  plus_haut_mieux: "Plus haut = mieux",
  plus_bas_mieux: "Plus bas = mieux",
};

export const NATURE_LIBELLES: Record<NatureKpiApi, string> = {
  flux: "Flux : somme des mesures de la période",
  stock: "Stock : dernière valeur de la période",
};

export const FREQUENCE_LIBELLES: Record<FrequenceKpiApi, string> = {
  hebdomadaire: "Hebdomadaire",
  mensuelle: "Mensuelle",
  trimestrielle: "Trimestrielle",
  semestrielle: "Semestrielle",
  annuelle: "Annuelle",
};

export const PERSPECTIVE_LIBELLES: Record<PerspectiveKpi, string> = {
  finances: "Finances",
  clients: "Clients",
  processus: "Processus internes",
  apprentissage: "Apprentissage et croissance",
};

export const SANS_PERSPECTIVE = "Sans perspective";

export const libellePerspective = (p: PerspectiveKpi | null | undefined) =>
  p ? (PERSPECTIVE_LIBELLES[p] ?? SANS_PERSPECTIVE) : SANS_PERSPECTIVE;

export const METHODE_PROJECTION_LIBELLES: Record<MethodeProjectionKpi, string> = {
  prorata: "prorata temporel du cumul de la période",
  regression: "tendance linéaire des mesures",
  reconduction: "reconduction de la dernière valeur",
  aucune: "aucune mesure exploitable",
};

export const ORIGINE_LIBELLES: Record<MesureKpi["origine"], string> = {
  cabinet: "Cabinet",
  portail: "Portail client",
};

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

const rangOrdinal = (n: number) => (n === 1 ? "1er" : `${n}e`);

/**
 * Clé de période de l'API → libellé : « 2026-03 » → « mars 2026 », « 2026-W41 » →
 * « semaine 41 de 2026 », « 2026-T1 » → « 1er trimestre 2026 », « 2026-S2 » →
 * « 2e semestre 2026 », « 2026 » → « année 2026 ». Clé inconnue : rendue telle quelle.
 */
export function libellePeriode(cle: string | null | undefined): string {
  if (!cle) return VALEUR_ABSENTE;
  let m = /^(\d{4})-W(\d{2})$/.exec(cle);
  if (m) return `semaine ${Number(m[2])} de ${m[1]}`;
  m = /^(\d{4})-(\d{2})$/.exec(cle);
  if (m) {
    const mois = MOIS[Number(m[2]) - 1];
    return mois ? `${mois} ${m[1]}` : cle;
  }
  m = /^(\d{4})-T([1-4])$/.exec(cle);
  if (m) return `${rangOrdinal(Number(m[2]))} trimestre ${m[1]}`;
  m = /^(\d{4})-S([12])$/.exec(cle);
  if (m) return `${rangOrdinal(Number(m[2]))} semestre ${m[1]}`;
  if (/^\d{4}$/.test(cle)) return `année ${cle}`;
  return cle;
}

/** Libellé court d'axe de graphique : « mars 26 », « S41 26 », « T1 26 », « S2 26 », « 2026 ». */
export function libellePeriodeCourt(cle: string): string {
  let m = /^(\d{4})-W(\d{2})$/.exec(cle);
  if (m) return `S${Number(m[2])} ${m[1]!.slice(2)}`;
  m = /^(\d{4})-(\d{2})$/.exec(cle);
  if (m) {
    const mois = MOIS_COURTS[Number(m[2]) - 1];
    return mois ? `${mois} ${m[1]!.slice(2)}` : cle;
  }
  m = /^(\d{4})-([TS])([1-4])$/.exec(cle);
  if (m) return `${m[2]}${m[3]} ${m[1]!.slice(2)}`;
  return cle;
}

// --- Mise en forme des chiffres du moteur ------------------------------------------------------

const NBSP = "\u00a0";

/** Valeur d'un KPI avec son unité : « 1 250,5 kFCFA » (six décimales au plus, comme l'API). */
export function formaterValeurKpi(valeur: number | null | undefined, unite: string): string {
  const n = formaterNombre(valeur, 6);
  if (n === VALEUR_ABSENTE) return n;
  return unite ? `${n}${NBSP}${unite}` : n;
}

/** Taux d'atteinte ou score (fraction) → « 87,5 % ». */
export const formaterTauxKpi = (taux: number | null | undefined) => formaterPourcentage(taux, 1);

function signe(v: number, options: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat("fr-FR", { ...options, signDisplay: "exceptZero" }).format(v);
}

/**
 * Écart à la cible (calculé par le moteur) : « +120 kFCFA (+12 %), favorable ». « Favorable »
 * suit le sens de lecture du KPI (écart orienté positif ou nul).
 */
export function texteEcart(e: EcartKpiVue | null | undefined, unite: string): string {
  if (!e || !Number.isFinite(e.ecart)) return VALEUR_ABSENTE;
  const brut = `${signe(e.ecart, { maximumFractionDigits: 6 })}${unite ? `${NBSP}${unite}` : ""}`;
  const relatif =
    e.ecart_relatif === null || !Number.isFinite(e.ecart_relatif)
      ? ""
      : ` (${signe(e.ecart_relatif, { style: "percent", maximumFractionDigits: 1 })})`;
  return `${brut}${relatif}, ${e.ecart_oriente >= 0 ? "favorable" : "défavorable"}`;
}

/** Atteinte : « 87,5 % de la cible » ; cible nulle : atteinte binaire (respectée ou non). */
export function texteAtteinte(a: AtteinteKpiVue | null | undefined): string {
  if (!a) return VALEUR_ABSENTE;
  if (a.mode === "binaire") {
    return a.taux >= 1 ? "Cible nulle respectée (100 %)" : "Cible nulle non respectée (0 %)";
  }
  const borne =
    a.borne === "plafond" ? " (plafonné)" : a.borne === "plancher" ? " (plancher atteint)" : "";
  return `${formaterTauxKpi(a.taux)} de la cible${borne}`;
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
export function descriptionTendance(t: TendanceKpiVue | null | undefined): DescriptionTendance {
  if (!t || t.direction === "indeterminee" || t.evolution === "indeterminee") {
    return {
      fleche: "?",
      texte: "Tendance indéterminée : moins de deux périodes closes mesurées",
      tonalite: "neutre",
    };
  }
  const sur = `, sur ${t.points} période${t.points > 1 ? "s" : ""} mesurée${t.points > 1 ? "s" : ""}`;
  if (t.direction === "stable" || t.evolution === "stable") {
    return { fleche: "→", texte: `Stable${sur}`, tonalite: "neutre" };
  }
  const direction = t.direction === "hausse" ? "En hausse" : "En baisse";
  const amelioration = t.evolution === "amelioration";
  return {
    fleche: FLECHES[t.direction],
    texte: `${direction} : ${amelioration ? "amélioration" : "dégradation"}${sur}`,
    tonalite: amelioration ? "succes" : "danger",
  };
}

/** Projection à la fin de la période en cours, avec sa méthode (moteur). */
export function texteProjection(p: ProjectionKpiVue | null | undefined, unite: string): string {
  if (!p || p.valeur_projetee === null) {
    return "Projection indisponible : aucune mesure exploitable dans la période en cours.";
  }
  const methode = METHODE_PROJECTION_LIBELLES[p.methode] ?? p.methode;
  return `${formaterValeurKpi(p.valeur_projetee, unite)} en fin de période (${methode}, ${p.jours_ecoules} jour${p.jours_ecoules > 1 ? "s" : ""} écoulé${p.jours_ecoules > 1 ? "s" : ""} sur ${p.jours_total})`;
}

/** Seuils de statut du KPI (ou ceux du moteur), écrits : « vert dès 95 %, orange dès 80 % ». */
export function texteSeuilsStatut(def: Pick<DefinitionKpi, "seuil_vert" | "seuil_orange">): string {
  const propres = def.seuil_vert !== null && def.seuil_orange !== null;
  const vert = propres ? (def.seuil_vert as number) : SEUILS_STATUT_DEFAUT.vert;
  const orange = propres ? (def.seuil_orange as number) : SEUILS_STATUT_DEFAUT.orange;
  return `Vert à partir de ${formaterTauxKpi(vert)} de la cible, orange de ${formaterTauxKpi(orange)} à ${formaterTauxKpi(vert)}, rouge en dessous de ${formaterTauxKpi(orange)}${propres ? " (seuils propres à ce KPI)" : " (seuils par défaut)"}.`;
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
): DescriptionAlerte {
  const periode = libellePeriode(texteLu(alerte.periode));
  const valeur = (v: unknown) => formaterValeurKpi(nombreLu(v), unite);
  switch (alerte.code) {
    case "DEGRADATION_CONSECUTIVE": {
      const n = nombreLu(alerte.periodes);
      return {
        titre: "Dégradation continue",
        texte: `La valeur se dégrade depuis ${n ?? VALEUR_ABSENTE} périodes consécutives, jusqu'à ${periode} (alerte à partir de ${nombreLu(alerte.seuil) ?? VALEUR_ABSENTE}).`,
        tonalite: "danger",
      };
    }
    case "MESURE_EN_RETARD": {
      const jours = nombreLu(alerte.jours_de_retard);
      const manquantes = nombreLu(alerte.periodes_manquantes) ?? 1;
      const suite =
        manquantes > 1
          ? ` ${manquantes} périodes sont sans mesure, jusqu'à ${libellePeriode(texteLu(alerte.derniere_periode_due))}.`
          : "";
      return {
        titre: "Mesure en retard",
        texte: `Aucune mesure pour ${libellePeriode(texteLu(alerte.periode_attendue))}, attendue au plus tard le ${formaterDate(texteLu(alerte.echeance))} (${jours ?? VALEUR_ABSENTE} jour${jours !== null && jours > 1 ? "s" : ""} de retard).${suite}`,
        tonalite: "attention",
      };
    }
    case "SEUIL_HAUT":
      return {
        titre: "Seuil d'alerte haut dépassé",
        texte: `${capitaliser(periode)} : ${valeur(alerte.valeur)}, au-dessus du seuil de ${valeur(alerte.seuil)}.`,
        tonalite: "danger",
      };
    case "SEUIL_BAS":
      return {
        titre: "Seuil d'alerte bas franchi",
        texte: `${capitaliser(periode)} : ${valeur(alerte.valeur)}, en dessous du seuil de ${valeur(alerte.seuil)}.`,
        tonalite: "danger",
      };
    case "VARIATION": {
      const relative = nombreLu(alerte.variation_relative);
      const variation =
        relative === null
          ? "depuis une valeur nulle"
          : signe(relative, { style: "percent", maximumFractionDigits: 1 });
      return {
        titre: "Variation inhabituelle",
        texte: `${capitaliser(periode)} : ${valeur(alerte.valeur)} contre ${valeur(alerte.precedente)} la période précédente (${variation}), au-delà de la variation admise de ${formaterTauxKpi(nombreLu(alerte.seuil))}.`,
        tonalite: "attention",
      };
    }
    default:
      return {
        titre: "Alerte",
        texte: `Alerte signalée par le moteur pour ${periode}.`,
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
