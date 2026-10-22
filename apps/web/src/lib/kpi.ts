/**
 * Pilotage par KPI d'une mission (service 4, KPI-01 à KPI-04) côté cabinet : contrats des
 * réponses de l'API, libellés, chemins, droits d'affichage, messages d'erreur et mise en
 * forme. Logique pure, testée dans `kpi.test.ts`.
 *
 * Tous les chiffres (statut, atteinte, écart, tendance, projection, score composite,
 * alertes) sont ceux du moteur de l'API (`packages/engines/src/kpi`) : ce module les met en
 * forme et ne les recalcule jamais. Rien n'est conservé dans le navigateur.
 *
 * Sous-modules : `kpi-types` (contrats, règles affichées), `kpi-libelles` (libellés et mise en
 * forme), `kpi-chemins` (chemins, curseur, date d'arrêté), `kpi-droits` (droits, personnes).
 */
import { PERSPECTIVES_KPI, type PerspectiveKpi } from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import { api, ErreurApi, messageErreur } from "./api";
import { cheminExportKpi, cheminSerieKpi } from "./kpi-chemins";
import { libellePerspective } from "./kpi-libelles";
import {
  FORMAT_EXPORT_KPI,
  MAX_CORRECTIONS_PAR_MESURE,
  type ExportKpi,
  type KpiTableau,
  type MesureKpi,
  type SerieKpiMission,
} from "./kpi-types";

export * from "./kpi-types";
export * from "./kpi-libelles";
export * from "./kpi-chemins";
export * from "./kpi-droits";

// --- Regroupements d'affichage ---------------------------------------------------------------

/** KPI du tableau de bord regroupés par perspective, dans l'ordre du tableau de bord prospectif. */
export function kpisParPerspective(
  kpis: readonly KpiTableau[],
): { perspective: PerspectiveKpi | null; libelle: string; kpis: KpiTableau[] }[] {
  return [...PERSPECTIVES_KPI, null]
    .map((perspective) => ({
      perspective,
      libelle: libellePerspective(perspective),
      kpis: kpis.filter((k) => (k.perspective ?? null) === perspective),
    }))
    .filter((g) => g.kpis.length > 0);
}

export interface EtatLigneMesure {
  libelle: string;
  tonalite: TonaliteStatut;
}

/**
 * État d'une ligne de l'historique (ajout seul) : active, corrigée, annulée ou ligne
 * d'annulation. `lignes` sert à retrouver la ligne qui l'a remplacée quand elle est chargée.
 */
export function etatLigneMesure(m: MesureKpi, lignes: readonly MesureKpi[]): EtatLigneMesure {
  if (m.annulation) return { libelle: "Annulation", tonalite: "neutre" };
  if (m.active) {
    return m.remplace_id
      ? { libelle: "Active (correction)", tonalite: "succes" }
      : { libelle: "Active", tonalite: "succes" };
  }
  const remplacante = lignes.find((l) => l.remplace_id === m.id);
  if (remplacante?.annulation) return { libelle: "Annulée", tonalite: "attention" };
  if (remplacante) return { libelle: "Corrigée", tonalite: "attention" };
  return { libelle: "Corrigée ou annulée", tonalite: "attention" };
}

/**
 * Rang de correction d'une mesure dans la chaîne chargée (0 : saisie initiale). Approximation
 * d'affichage : seules les lignes chargées sont suivies ; l'API reste seule juge (409).
 */
export function rangCorrection(m: MesureKpi, lignes: readonly MesureKpi[]): number {
  const parId = new Map(lignes.map((l) => [l.id, l]));
  let rang = 0;
  let courante: MesureKpi | undefined = m;
  const vus = new Set<string>();
  while (courante?.remplace_id && !vus.has(courante.id)) {
    vus.add(courante.id);
    rang++;
    courante = parId.get(courante.remplace_id);
  }
  return rang;
}

// --- Erreurs de l'API -----------------------------------------------------------------------

/** Codes dont le message de l'API, explicite et en français, est affiché tel quel. */
const CODES_MESSAGE_API = new Set([
  "KPI_TROP_DE_PERIODES",
  "KPI_CHAMP_FIGE",
  "KPI_HISTORIQUE_IMMUABLE",
]);

export const MESSAGES_KPI: Record<string, string> = {
  KPI_DEBUT_SUIVI_TROP_ANCIEN:
    "Le suivi d'un KPI commence au plus 10 ans avant sa création (la date est ramenée au premier jour de sa période) : choisissez un début de suivi plus récent.",
  KPI_TROP_DE_CORRECTIONS: `Cette mesure a déjà été corrigée ${MAX_CORRECTIONS_PAR_MESURE} fois, le maximum admis : annulez-la (avec un motif), puis saisissez à nouveau la valeur à cette date.`,
  KPI_MESURE_EN_DOUBLE:
    "Une mesure active existe déjà à cette date : corrigez-la depuis l'historique plutôt que d'en saisir une seconde.",
  KPI_HORS_PERIODE:
    "La date de mesure doit être comprise entre le début du suivi et aujourd'hui (ou la fin du suivi si elle est passée).",
  KPI_INACTIF: "Ce KPI est désactivé : réactivez-le avant de saisir des mesures.",
  KPI_INCOHERENT:
    "Choix refusé : un contributeur doit être un dirigeant ou un contributeur du portail de ce client.",
};

const MESSAGE_INTROUVABLE_KPI =
  "Ce KPI ou cette mesure n'existe plus ou ne vous est plus accessible : rechargez la page.";

/** Message affichable (français) pour une erreur des écrans KPI. */
export function messageKpi(e: unknown): string {
  if (e instanceof ErreurApi) {
    const specifique = MESSAGES_KPI[e.code];
    if (specifique) return specifique;
    if (CODES_MESSAGE_API.has(e.code)) return e.message;
    if (e.statut === 404) return MESSAGE_INTROUVABLE_KPI;
    // Conflits explicites de l'API : déjà corrigée ou annulée, mission clôturée, plafond de KPI.
    if (e.statut === 409) return e.message;
    // Règles métier refusées par l'API (propriétaire, cible avant le suivi, invariant du
    // moteur…) : message français. « Données invalides. » (validation) reste générique.
    if (e.statut === 400 && e.message !== "Données invalides.") return e.message;
  }
  return messageErreur(e);
}

/** Refus d'annuler une mesure saisie depuis le portail (403). */
export function messageAnnulationKpi(e: unknown, origine: MesureKpi["origine"]): string {
  if (e instanceof ErreurApi && e.statut === 403 && origine === "portail") {
    return "Seul un responsable de la mission (directeur ou chef, avec la gestion des KPI) peut annuler une mesure saisie depuis le portail client.";
  }
  return messageKpi(e);
}

/** Après ce refus, l'écran est probablement périmé : rafraîchir les données. */
export const etatKpiChange = (e: unknown) =>
  e instanceof ErreurApi && (e.statut === 404 || e.statut === 409);

// --- Export JSON ----------------------------------------------------------------------------

export function estExportKpi(v: unknown): v is ExportKpi {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { format?: unknown }).format === FORMAT_EXPORT_KPI &&
    Array.isArray((v as { kpis?: unknown }).kpis)
  );
}

/** Export versionné de la mission à la date d'arrêté ; refuse un format inattendu. */
export async function chargerExportKpi(missionId: string, date: string | null): Promise<ExportKpi> {
  const donnees = await api.get<unknown>(cheminExportKpi(missionId, date), { delaiMs: 30_000 });
  if (!estExportKpi(donnees)) {
    throw new ErreurApi(
      "EXPORT_INATTENDU",
      `Le serveur a renvoyé un export dans un format inattendu (attendu : ${FORMAT_EXPORT_KPI}).`,
      200,
    );
  }
  return donnees;
}

export function estSerieKpi(v: unknown): v is SerieKpiMission {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as { mission_id?: unknown }).mission_id === "string" &&
    Array.isArray((v as { kpis?: unknown }).kpis)
  );
}

/** Séries par période de la mission à la date d'arrêté (lecture, sans écriture au journal d'export). */
export async function chargerSerieKpi(
  missionId: string,
  date: string | null,
): Promise<SerieKpiMission> {
  const donnees = await api.get<unknown>(cheminSerieKpi(missionId, date), { delaiMs: 30_000 });
  if (!estSerieKpi(donnees)) {
    throw new ErreurApi(
      "SERIE_INATTENDUE",
      "Le serveur a renvoyé les séries dans un format inattendu.",
      200,
    );
  }
  return donnees;
}

/** « kpi-pilotage-de-la-performance-2026-05-15.json » (ASCII, sans caractère spécial). */
export function nomFichierExportKpi(intitule: string | null, date: string): string {
  const base = (intitule ?? "mission")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return `kpi-${base || "mission"}-${date}.json`;
}
