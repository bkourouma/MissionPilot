/** Sous-module de `questionnaires.ts` : navigation, pagination et chemins d'API. */
import { cheminPage } from "./pagination";
import { type PageQuestionnaires, type ModeleResume } from "./questionnaires-types";

// --- Navigation et pages ------------------------------------------------------------------------

export const TAILLE_PAGE = 30;
export const TAILLE_PAGE_CHOIX = 100;

/** Curseur lu dans l'URL (chaîne bornée, sinon `null`). */
export function lireCurseur(v: string | string[] | undefined): string | null {
  const c = Array.isArray(v) ? v[0] : v;
  if (!c || c.length > 500 || !/^[A-Za-z0-9_\-=.~]+$/.test(c)) return null;
  return c;
}

export const cheminModeles = (curseur: string | null, limite = TAILLE_PAGE) =>
  cheminPage("/api/questionnaires/modeles", limite, curseur);

export const cheminEnvoisMission = (missionId: string, curseur: string | null) =>
  cheminPage(`/api/missions/${encodeURIComponent(missionId)}/questionnaires`, TAILLE_PAGE, curseur);

/** Pages de 100 (plafond de l'API) chargées au plus : au-delà de 1 000, liste partielle. */
export const PAGES_MAX_REPONDANTS = 10;

export const cheminRepondantsEligibles = (missionId: string, curseur: string | null) =>
  cheminPage(
    `/api/missions/${encodeURIComponent(missionId)}/questionnaires/repondants-eligibles`,
    TAILLE_PAGE_CHOIX,
    curseur,
  );

export const hrefAvecCurseur = (base: string, curseur: string | null) =>
  curseur ? `${base}?curseur=${encodeURIComponent(curseur)}` : base;

export const hrefEnvoi = (missionId: string, envoiId: string) =>
  `/missions/${encodeURIComponent(missionId)}/questionnaires/${encodeURIComponent(envoiId)}`;

/**
 * Charge toutes les pages d'une liste (listes de choix). S'arrête sur un curseur répété ou
 * après `pagesMax` pages (liste alors marquée `tronquee`).
 */
export async function toutesLesPages<T>(
  charger: (chemin: string) => Promise<PageQuestionnaires<T>>,
  chemin: (curseur: string | null) => string,
  pagesMax = 20,
): Promise<{ elements: T[]; tronquee: boolean }> {
  const elements: T[] = [];
  const vus = new Set<string>();
  let curseur: string | null = null;
  for (let page = 0; page < pagesMax; page++) {
    const r: PageQuestionnaires<T> = await charger(chemin(curseur));
    elements.push(...r.elements);
    curseur = r.curseur_suivant ?? null;
    if (curseur === null || vus.has(curseur)) return { elements, tronquee: false };
    vus.add(curseur);
  }
  return { elements, tronquee: true };
}

/** Modèles envoyables (au moins une version validée), triés par titre. */
export function modelesEnvoyables(modeles: readonly ModeleResume[]) {
  return modeles
    .filter(
      (m): m is ModeleResume & { version_validee_id: string } => m.version_validee_id !== null,
    )
    .map((m) => ({ valeur: m.version_validee_id, libelle: `${m.titre} (${m.code})` }))
    .sort((a, b) => a.libelle.localeCompare(b.libelle, "fr", { sensitivity: "base" }));
}

/** Date du jour AAAA-MM-JJ dans le fuseau donné (Abidjan par défaut, UTC+0). */
export function dateDuJour(maintenant: Date, fuseau = "Africa/Abidjan"): string {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: fuseau,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(maintenant);
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${v("year")}-${v("month")}-${v("day")}`;
}
