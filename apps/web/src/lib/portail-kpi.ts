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
import type { FrequenceKpiApi, NatureKpiApi, SensLectureKpiApi } from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import { ErreurApi } from "./api";
import { MESSAGES_KPI } from "./kpi";
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

export const libelleFrequence = (f: string): string =>
  FREQUENCES[f as FrequenceKpiApi] ?? "Fréquence à préciser";

export const libelleNature = (n: string): string => NATURES[n as NatureKpiApi] ?? "";

export const libelleSens = (s: string): string => SENS[s as SensLectureKpiApi] ?? "";

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
): EtatSaisieKpi {
  if (!k.actif) {
    return {
      saisissable: false,
      raison:
        "Ce KPI est suspendu par votre cabinet : aucune saisie n'est possible pour le moment.",
    };
  }
  if (k.debut_suivi > aujourdhui) {
    return {
      saisissable: false,
      raison:
        "Le suivi de ce KPI n'a pas encore commencé : aucune mesure ne peut encore être datée.",
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
): EtatMesurePortail {
  if (m.annulation) return { libelle: "Annulation", tonalite: "neutre" };
  if (m.active) return { libelle: "Valeur retenue", tonalite: "succes" };
  return { libelle: "Remplacée", tonalite: "neutre" };
}

/** Auteur affiché : le portail n'expose que « moi », l'entreprise ou le cabinet. */
export function auteurMesure(m: Pick<MesurePortail, "origine" | "saisie_par_moi">): string {
  if (m.origine === "cabinet") return "Saisie par le cabinet";
  return m.saisie_par_moi ? "Saisie par vous" : "Saisie par un autre membre de votre entreprise";
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

/** Message affichable (français, sans jargon) pour un refus de saisie ou de correction. */
export function messagePortailKpi(e: unknown): string | null {
  if (!(e instanceof ErreurApi)) return null;
  const specifique = MESSAGES_KPI[e.code];
  if (specifique && e.code !== "KPI_DEBUT_SUIVI_TROP_ANCIEN") return specifique;
  if (e.statut === 404) return MESSAGE_INTROUVABLE;
  if (e.statut === 403) return "Vous ne pouvez pas modifier cette mesure : elle n'est pas de vous.";
  // Conflits explicites de l'API (mission clôturée, mesure déjà corrigée) : message en français.
  if (e.statut === 409) return e.message;
  return null;
}
