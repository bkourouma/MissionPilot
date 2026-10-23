/**
 * Libellés du versement à l'observatoire. Le nombre d'éléments versés vient de l'API (`versees`) ;
 * le web ne fait que le dire, sans jamais annoncer un versement qui n'a pas eu lieu.
 */
import { CODE_CONTRIBUTION_REQUISE } from "./observatoire";

export const MESSAGE_RIEN_A_VERSER = "Rien à verser pour l'instant : aucune notation publiée.";

/** Message de succès d'un versement, véridique selon le nombre d'éléments réellement versés. */
export function messageVersement(versees: number): string {
  if (!Number.isFinite(versees) || versees <= 0) return MESSAGE_RIEN_A_VERSER;
  const libelle = versees === 1 ? "1 élément versé" : `${versees} éléments versés`;
  return `${libelle} ; ${versees === 1 ? "il sera retenu" : "ils seront retenus"} le mois suivant.`;
}

/** Lit `versees` dans la réponse de l'API ; absent ou invalide : 0 (on ne promet rien). */
export function nombreVerse(reponse: unknown): number {
  const v = (reponse as { versees?: unknown } | null | undefined)?.versees;
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

export const MESSAGE_ATTENTE_VERSEMENT_ASSOCIE =
  "Un associé du cabinet doit d'abord verser les données du cabinet ; elles sont prises en compte au mois suivant.";

/**
 * Message d'« agrégats non disponibles ». Pour « versement requis », seul l'associé peut agir :
 * les autres rôles voient qu'un associé doit verser, pas une consigne qu'ils ne peuvent pas suivre.
 */
export function messageAgregatsIndisponibles(
  code: string | undefined,
  messageApi: string,
  peutVerser: boolean,
): string {
  if (code === CODE_CONTRIBUTION_REQUISE && !peutVerser) return MESSAGE_ATTENTE_VERSEMENT_ASSOCIE;
  return messageApi;
}
