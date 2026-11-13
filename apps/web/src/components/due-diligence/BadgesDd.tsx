"use client";

import type { NiveauEs, NiveauRisqueDd } from "@missionpilot/shared";
import { BadgeStatut } from "../ui/BadgeStatut";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import {
  libellesDd,
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
 * jamais seules le sens. Composants sans état (client, pour lire la langue), utilisables dans une
 * page serveur comme dans un composant client.
 */

export function BadgeVerdict({ etat }: { etat: EtatHypothese }) {
  const L = libellesDd(useLangue());
  return (
    <BadgeStatut tonalite={TONALITE_ETAT_HYPOTHESE[etat]}>{L.ETAT_HYPOTHESE[etat]}</BadgeStatut>
  );
}

export function BadgeNiveauRisque({ niveau }: { niveau: NiveauRisqueDd }) {
  const L = libellesDd(useLangue());
  return (
    <BadgeStatut tonalite={TONALITE_NIVEAU_RISQUE[niveau]}>{L.NIVEAU_RISQUE[niveau]}</BadgeStatut>
  );
}

export function BadgeNiveauEs({ niveau }: { niveau: NiveauEs }) {
  const L = libellesDd(useLangue());
  return <BadgeStatut tonalite={TONALITE_NIVEAU_ES[niveau]}>{L.NIVEAU_ES[niveau]}</BadgeStatut>;
}

/** Lecture de solidité reçue du moteur (solide, étayée, fragile) ; `null` : non évaluée. */
export function BadgeLecture({ lecture }: { lecture: LectureSolidite | null | undefined }) {
  const t = useT();
  const L = libellesDd(useLangue());
  if (!lecture) return <BadgeStatut tonalite="neutre">{t("Non évaluée", "Not rated")}</BadgeStatut>;
  return <BadgeStatut tonalite={TONALITE_LECTURE_DD[lecture]}>{L.LECTURE[lecture]}</BadgeStatut>;
}

export function BadgeEtatNote({ etat }: { etat: EtatNote }) {
  const L = libellesDd(useLangue());
  return <BadgeStatut tonalite={TONALITE_ETAT_NOTE[etat]}>{L.ETAT_NOTE[etat]}</BadgeStatut>;
}
