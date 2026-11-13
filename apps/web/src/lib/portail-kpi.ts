/**
 * Saisie des KPI depuis l'espace client (KPI-02) : contrats de `/api/portail/kpi`, chemins,
 * libellés et traduction des refus. Logique pure, testée dans `portail-kpi.test.ts`.
 *
 * Règles (DECISIONS.md, V2) : seuls les KPI dont l'utilisateur est contributeur DÉSIGNÉ par le
 * cabinet existent pour lui (droit « portail.kpi.saisir ») ; il ne corrige que ses propres
 * mesures ; la mission du KPI doit être ouverte. Les contrôles de saisie reprennent ceux du
 * cabinet (`kpi-saisie.ts`) pour éviter un aller-retour refusé ; l'API reste seule juge. Ni
 * statut, ni atteinte, ni alerte : le portail ne montre que la définition, la cible en vigueur
 * et les mesures. Aucune saisie n'est gardée dans le navigateur.
 */
import {
  creerTraduire,
  type FrequenceKpiApi,
  type Langue,
  type NatureKpiApi,
  type SensLectureKpiApi,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import { ErreurApi } from "./api";
import { MESSAGES_KPI, MESSAGES_KPI_EN } from "./kpi";
import { CHEMIN_PORTAIL } from "./portail-routes";

// --- Contrats de l'API ---------------------------------------------------------------------

/** KPI à renseigner (`GET /api/portail/kpi` et `/kpi/:id`). */
export interface KpiPortail {
  id: string;
  libelle: string;
  description: string | null;
  unite: string;
  sens: SensLectureKpiApi;
  nature: NatureKpiApi;
  frequence: FrequenceKpiApi;
  debut_suivi: string;
  fin_suivi: string | null;
  actif: boolean;
  cible_actuelle: number | null;
  /** Clé de la période en cours (ex. « 2026-05 »). */
  periode_en_cours: string;
}

/** Mesure (`GET /api/portail/kpi/:id/mesures`), en ajout seul. */
export interface MesurePortail {
  id: string;
  date_mesure: string;
  periode: string;
  /** null : ligne d'annulation. */
  valeur: number | null;
  annulation: boolean;
  remplace_id: string | null;
  /** Ni annulée, ni remplacée, et pas une ligne d'annulation. */
  active: boolean;
  motif: string | null;
  commentaire: string | null;
  justificatif: string | null;
  origine: "cabinet" | "portail";
  saisie_par_moi: boolean;
  saisie_le: string;
}

// --- Chemins -------------------------------------------------------------------------------

/** Rubrique des KPI de l'espace client. */
export const CHEMIN_KPI_PORTAIL = `${CHEMIN_PORTAIL}/kpi`;
export const API_KPI_PORTAIL = "/api/portail/kpi";

export const hrefKpiPortail = (id: string) => `${CHEMIN_KPI_PORTAIL}/${encodeURIComponent(id)}`;
export const cheminApiKpiPortail = (id: string) => `${API_KPI_PORTAIL}/${encodeURIComponent(id)}`;

/** Taille d'une page de l'historique des mesures. */
export const TAILLE_PAGE_MESURES_PORTAIL = 20;

export function cheminApiMesuresPortail(id: string, curseur: string | null = null): string {
  const r = new URLSearchParams({ limite: String(TAILLE_PAGE_MESURES_PORTAIL) });
  if (curseur) r.set("curseur", curseur);
  return `${cheminApiKpiPortail(id)}/mesures?${r.toString()}`;
}

/** Saisie d'une mesure (POST) sur le KPI. */
export const cheminApiSaisieMesure = (id: string) => `${cheminApiKpiPortail(id)}/mesures`;

/** Correction d'une de ses mesures (POST). */
export const cheminApiCorrectionMesure = (mesureId: string) =>
  `${API_KPI_PORTAIL}/mesures/${encodeURIComponent(mesureId)}/corrections`;

// --- Libellés ------------------------------------------------------------------------------

const FREQUENCES: Record<FrequenceKpiApi, string> = {
  hebdomadaire: "Chaque semaine",
  mensuelle: "Chaque mois",
  trimestrielle: "Chaque trimestre",
  semestrielle: "Chaque semestre",
  annuelle: "Chaque année",
};

const NATURES: Record<NatureKpiApi, string> = {
  flux: "Les mesures d'une même période s'additionnent (ex. chiffre d'affaires du mois).",
  stock: "La dernière valeur de la période fait foi (ex. trésorerie en fin de mois).",
};

const SENS: Record<SensLectureKpiApi, string> = {
  plus_haut_mieux: "Plus la valeur est haute, mieux c'est",
  plus_bas_mieux: "Plus la valeur est basse, mieux c'est",
};

const FREQUENCES_EN: Record<FrequenceKpiApi, string> = {
  hebdomadaire: "Every week",
  mensuelle: "Every month",
  trimestrielle: "Every quarter",
  semestrielle: "Every half-year",
  annuelle: "Every year",
};

const NATURES_EN: Record<NatureKpiApi, string> = {
  flux: "Measurements of the same period add up (e.g. monthly revenue).",
  stock: "The last value of the period prevails (e.g. cash at month end).",
};

const SENS_EN: Record<SensLectureKpiApi, string> = {
  plus_haut_mieux: "The higher the value, the better",
  plus_bas_mieux: "The lower the value, the better",
};

export const libelleFrequence = (f: string, langue: Langue = "fr"): string =>
  (langue === "en" ? FREQUENCES_EN : FREQUENCES)[f as FrequenceKpiApi] ??
  creerTraduire(langue)("Fréquence à préciser", "Frequency to be specified");

export const libelleNature = (n: string, langue: Langue = "fr"): string =>
  (langue === "en" ? NATURES_EN : NATURES)[n as NatureKpiApi] ?? "";

export const libelleSens = (s: string, langue: Langue = "fr"): string =>
  (langue === "en" ? SENS_EN : SENS)[s as SensLectureKpiApi] ?? "";

export interface EtatSaisieKpi {
  /** Une saisie est-elle possible (KPI actif et suivi commencé) ? */
  saisissable: boolean;
  /** Pourquoi pas, sinon. */
  raison: string | null;
}

/** Le KPI accepte-t-il une saisie à cette date ? (mission clôturée : l'API répond 409) */
export function etatSaisieKpi(
  k: Pick<KpiPortail, "actif" | "debut_suivi">,
  aujourdhui: string,
  langue: Langue = "fr",
): EtatSaisieKpi {
  const t = creerTraduire(langue);
  if (!k.actif) {
    return {
      saisissable: false,
      raison: t(
        "Ce KPI est suspendu par votre cabinet : aucune saisie n'est possible pour le moment.",
        "This KPI is suspended by your firm: no entry is possible for now.",
      ),
    };
  }
  if (k.debut_suivi > aujourdhui) {
    return {
      saisissable: false,
      raison: t(
        "Le suivi de ce KPI n'a pas encore commencé : aucune mesure ne peut encore être datée.",
        "Tracking of this KPI has not started yet: no measurement can be dated yet.",
      ),
    };
  }
  return { saisissable: true, raison: null };
}

export interface EtatMesurePortail {
  libelle: string;
  tonalite: TonaliteStatut;
}

/** Statut d'une ligne de l'historique. */
export function etatMesurePortail(
  m: Pick<MesurePortail, "active" | "annulation">,
  langue: Langue = "fr",
): EtatMesurePortail {
  const t = creerTraduire(langue);
  if (m.annulation) return { libelle: t("Annulation", "Cancellation"), tonalite: "neutre" };
  if (m.active) return { libelle: t("Valeur retenue", "Retained value"), tonalite: "succes" };
  return { libelle: t("Remplacée", "Replaced"), tonalite: "neutre" };
}

/** Auteur affiché : le portail n'expose que « moi », l'entreprise ou le cabinet. */
export function auteurMesure(
  m: Pick<MesurePortail, "origine" | "saisie_par_moi">,
  langue: Langue = "fr",
): string {
  const t = creerTraduire(langue);
  if (m.origine === "cabinet") return t("Saisie par le cabinet", "Entered by the firm");
  return m.saisie_par_moi
    ? t("Saisie par vous", "Entered by you")
    : t(
        "Saisie par un autre membre de votre entreprise",
        "Entered by another member of your company",
      );
}

/** Peut-on corriger cette ligne ? (sa propre mesure active, KPI saisissable ; l'API juge) */
export function mesureCorrigeable(
  m: Pick<MesurePortail, "active" | "saisie_par_moi" | "origine">,
  saisissable: boolean,
): boolean {
  return saisissable && m.active && m.saisie_par_moi && m.origine === "portail";
}

// --- Erreurs -------------------------------------------------------------------------------

const MESSAGE_INTROUVABLE =
  "Ce KPI ou cette mesure n'est plus ouvert à votre saisie : rechargez la page ou contactez votre interlocuteur au cabinet.";
const MESSAGE_INTROUVABLE_EN =
  "This KPI or measurement is no longer open to your input: reload the page or contact your contact at the firm.";

/** Message affichable (français par défaut, sans jargon) pour un refus de saisie ou de correction. */
export function messagePortailKpi(e: unknown, langue: Langue = "fr"): string | null {
  if (!(e instanceof ErreurApi)) return null;
  const specifique = (langue === "en" ? MESSAGES_KPI_EN : MESSAGES_KPI)[e.code];
  if (specifique && e.code !== "KPI_DEBUT_SUIVI_TROP_ANCIEN") return specifique;
  if (e.statut === 404) return langue === "en" ? MESSAGE_INTROUVABLE_EN : MESSAGE_INTROUVABLE;
  if (e.statut === 403) {
    return creerTraduire(langue)(
      "Vous ne pouvez pas modifier cette mesure : elle n'est pas de vous.",
      "You cannot edit this measurement: it is not yours.",
    );
  }
  // Conflits explicites de l'API (mission clôturée, mesure déjà corrigée) : message en français.
  if (e.statut === 409) return e.message;
  return null;
}
