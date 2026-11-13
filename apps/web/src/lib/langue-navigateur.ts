import { COOKIE_LANGUE, resoudreLangue, type Langue } from "@missionpilot/shared";

/**
 * Langue de l'interface côté navigateur (cookie du sélecteur de langue) ; français ailleurs
 * (serveur, tests). Sert aux messages et aux lectures de saisie construits localement.
 */
export function langueNavigateur(): Langue {
  if (typeof document === "undefined") return "fr";
  const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_LANGUE}=([^;]*)`));
  return resoudreLangue(m ? decodeURIComponent(m[1] ?? "") : undefined, null);
}
