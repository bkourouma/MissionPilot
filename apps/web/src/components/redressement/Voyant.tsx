import type { RedNiveauAlerte, RedVoyant } from "@missionpilot/shared";
import {
  libelleNiveauAlerte,
  libelleVoyant,
  tonaliteNiveauAlerte,
  tonaliteVoyant,
} from "../../lib/redressement";
import { BadgeStatut } from "../ui/BadgeStatut";

/**
 * Voyant d'un domaine ou d'un critère : enveloppe de `BadgeStatut` (vert : succès, orange :
 * attention, rouge : danger, non évalué : neutre), TOUJOURS avec son texte et son icône. Un
 * voyant est un constat de saisie, jamais une qualification juridique.
 */
export function Voyant({ voyant }: { voyant: RedVoyant }) {
  return <BadgeStatut tonalite={tonaliteVoyant(voyant)}>{libelleVoyant(voyant)}</BadgeStatut>;
}

/** Niveau de l'alerte précoce : texte et icône, jamais la couleur seule. */
export function NiveauAlerte({ niveau }: { niveau: RedNiveauAlerte }) {
  return (
    <BadgeStatut tonalite={tonaliteNiveauAlerte(niveau)}>{libelleNiveauAlerte(niveau)}</BadgeStatut>
  );
}
