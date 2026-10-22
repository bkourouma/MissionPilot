/** Notation : chemins de pages et d'API (voir `notation.ts`). */
import type { VersionResume } from "./notation-types";

// --- Chemins ----------------------------------------------------------------------------------

const segment = (id: string) => encodeURIComponent(id);

/** Numéro de version lu dans l'URL (`?version=3`) ; null si absent ou invalide. */
export function lireNumeroVersion(v: string | string[] | undefined): number | null {
  const brut = Array.isArray(v) ? v[0] : v;
  if (typeof brut !== "string" || !/^[1-9]\d{0,5}$/.test(brut)) return null;
  const n = Number(brut);
  return n <= 100000 ? n : null;
}

/**
 * Version à afficher : celle demandée si elle existe, sinon la plus récente. `introuvable`
 * signale une version demandée qui n'existe pas (lien périmé).
 */
export function versionAffichee(
  versions: readonly Pick<VersionResume, "numero">[],
  demandee: number | null,
): { numero: number | null; introuvable: boolean; derniere: boolean } {
  const plusRecente = versions[0]?.numero ?? null;
  if (demandee !== null && versions.some((v) => v.numero === demandee)) {
    return { numero: demandee, introuvable: false, derniere: demandee === plusRecente };
  }
  return { numero: plusRecente, introuvable: demandee !== null, derniere: true };
}

export const hrefNotation = (missionId: string, numero?: number | null) =>
  `/missions/${segment(missionId)}/notation${numero ? `?version=${numero}` : ""}`;

export const cheminNotationMission = (missionId: string) =>
  `/api/missions/${segment(missionId)}/notation`;

export const cheminVersionNotation = (notationId: string, numero: number) =>
  `/api/notations/${segment(notationId)}/version?version=${numero}`;

export const cheminRapportNotation = (notationId: string, numero: number) =>
  `/api/notations/${segment(notationId)}/rapport?version=${numero}`;

export type ActionNotation = "calculs" | "ajustements" | "soumettre" | "renvoyer" | "publier";

export const cheminActionNotation = (notationId: string, action: ActionNotation) =>
  `/api/notations/${segment(notationId)}/${action}`;

/** Envois de questionnaires de la mission (100 plus récents : plafond de l'API). */
export const cheminEnvoisMission = (missionId: string) =>
  `/api/missions/${segment(missionId)}/questionnaires?limite=100`;
