/**
 * Libellés du versement à l'observatoire. Le nombre d'éléments versés vient de l'API (`versees`) ;
 * le web ne fait que le dire, sans jamais annoncer un versement qui n'a pas eu lieu.
 */
import { creerTraduire, type Langue } from "@missionpilot/shared";
import { CODE_CONTRIBUTION_REQUISE } from "./observatoire";

export const MESSAGE_RIEN_A_VERSER = "Rien à verser pour l'instant : aucune notation publiée.";
export const MESSAGE_RIEN_A_VERSER_EN = "Nothing to contribute for now: no rating published.";

/** Message de succès d'un versement, véridique selon le nombre d'éléments réellement versés. */
export function messageVersement(versees: number, langue: Langue = "fr"): string {
  if (!Number.isFinite(versees) || versees <= 0) {
    return langue === "en" ? MESSAGE_RIEN_A_VERSER_EN : MESSAGE_RIEN_A_VERSER;
  }
  const t = creerTraduire(langue);
  const un = versees === 1;
  return t(
    `${un ? "1 élément versé" : `${versees} éléments versés`} ; ${un ? "il sera retenu" : "ils seront retenus"} le mois suivant.`,
    `${un ? "1 item contributed" : `${versees} items contributed`}; ${un ? "it" : "they"} will be counted next month.`,
  );
}

/** Lit `versees` dans la réponse de l'API ; absent ou invalide : 0 (on ne promet rien). */
export function nombreVerse(reponse: unknown): number {
  const v = (reponse as { versees?: unknown } | null | undefined)?.versees;
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

export const MESSAGE_ATTENTE_VERSEMENT_ASSOCIE =
  "Un associé du cabinet doit d'abord verser les données du cabinet ; elles sont prises en compte au mois suivant.";
export const MESSAGE_ATTENTE_VERSEMENT_ASSOCIE_EN =
  "A partner of the firm must first contribute the firm's data; it is taken into account the following month.";

/**
 * Message d'« agrégats non disponibles ». Pour « versement requis », seul l'associé peut agir :
 * les autres rôles voient qu'un associé doit verser, pas une consigne qu'ils ne peuvent pas suivre.
 */
export function messageAgregatsIndisponibles(
  code: string | undefined,
  messageApi: string,
  peutVerser: boolean,
  langue: Langue = "fr",
): string {
  if (code === CODE_CONTRIBUTION_REQUISE && !peutVerser) {
    return langue === "en"
      ? MESSAGE_ATTENTE_VERSEMENT_ASSOCIE_EN
      : MESSAGE_ATTENTE_VERSEMENT_ASSOCIE;
  }
  return messageApi;
}
