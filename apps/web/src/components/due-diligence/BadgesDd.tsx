import type { NiveauEs, NiveauRisqueDd } from "@missionpilot/shared";
import { BadgeStatut } from "../ui/BadgeStatut";
import {
  ETAT_HYPOTHESE_LIBELLES,
  ETAT_NOTE_LIBELLES,
  LECTURE_SOLIDITE_DD_LIBELLES,
  NIVEAU_ES_LIBELLES,
  NIVEAU_RISQUE_DD_LIBELLES,
  TONALITE_ETAT_HYPOTHESE,
  TONALITE_ETAT_NOTE,
  TONALITE_LECTURE_DD,
  TONALITE_NIVEAU_ES,
  TONALITE_NIVEAU_RISQUE,
  type EtatHypothese,
  type EtatNote,
  type LectureSolidite,
} from "../../lib/due-diligence";

/*
 * Badges de la due diligence. Le texte est toujours affiché : la couleur et l'icône ne portent
 * jamais seules le sens. Composants sans état, utilisables côté serveur comme côté client.
 */

export function BadgeVerdict({ etat }: { etat: EtatHypothese }) {
  return (
    <BadgeStatut tonalite={TONALITE_ETAT_HYPOTHESE[etat]}>
      {ETAT_HYPOTHESE_LIBELLES[etat]}
    </BadgeStatut>
  );
}

export function BadgeNiveauRisque({ niveau }: { niveau: NiveauRisqueDd }) {
  return (
    <BadgeStatut tonalite={TONALITE_NIVEAU_RISQUE[niveau]}>
      {NIVEAU_RISQUE_DD_LIBELLES[niveau]}
    </BadgeStatut>
  );
}

export function BadgeNiveauEs({ niveau }: { niveau: NiveauEs }) {
  return (
    <BadgeStatut tonalite={TONALITE_NIVEAU_ES[niveau]}>{NIVEAU_ES_LIBELLES[niveau]}</BadgeStatut>
  );
}

/** Lecture de solidité reçue du moteur (solide, étayée, fragile) ; `null` : non évaluée. */
export function BadgeLecture({ lecture }: { lecture: LectureSolidite | null | undefined }) {
  if (!lecture) return <BadgeStatut tonalite="neutre">Non évaluée</BadgeStatut>;
  return (
    <BadgeStatut tonalite={TONALITE_LECTURE_DD[lecture]}>
      {LECTURE_SOLIDITE_DD_LIBELLES[lecture]}
    </BadgeStatut>
  );
}

export function BadgeEtatNote({ etat }: { etat: EtatNote }) {
  return <BadgeStatut tonalite={TONALITE_ETAT_NOTE[etat]}>{ETAT_NOTE_LIBELLES[etat]}</BadgeStatut>;
}
