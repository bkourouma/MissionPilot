"use client";

import type { RedMotifVoyantVue, RedVoyantPilotage } from "@missionpilot/shared";
import {
  libelleGravite,
  libelleVoyantPilotage,
  texteAlternatifVoyant,
  tonaliteGravite,
  tonaliteVoyantPilotage,
} from "../../lib/redressement-tableau";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { BadgeStatut } from "../ui/BadgeStatut";

/**
 * Voyant de pilotage : couleur, icône ET texte (« Priorité haute », « Vigilance »…), avec un
 * texte alternatif complet pour les lecteurs d'écran. Indicatif, jamais une qualification
 * juridique de la situation du client.
 */
export function VoyantPilotage({ voyant }: { voyant: RedVoyantPilotage }) {
  const langue = useLangue();
  return (
    <span className="mp-tdb-voyant">
      <span className="mp-visuellement-cache">{texteAlternatifVoyant(voyant, langue)}. </span>
      <BadgeStatut tonalite={tonaliteVoyantPilotage(voyant)}>
        {libelleVoyantPilotage(voyant, langue)}
      </BadgeStatut>
    </span>
  );
}

/** Motifs du voyant, du plus grave au moins grave ; `max` limite l'affichage (portefeuille). */
export function VoyantPilotageMotifs({
  motifs,
  max,
}: {
  motifs: readonly RedMotifVoyantVue[];
  max?: number;
}) {
  const t = useT();
  const langue = useLangue();
  const visibles = max === undefined ? motifs : motifs.slice(0, max);
  if (visibles.length === 0) {
    return (
      <p className="mp-texte-doux">{t("Aucun motif n'est signalé.", "No reason is flagged.")}</p>
    );
  }
  return (
    <ol
      className="mp-tdb-motifs"
      aria-label={t(
        "Motifs du voyant, du plus grave au moins grave",
        "Indicator reasons, from most to least serious",
      )}
    >
      {visibles.map((m, i) => (
        <li key={`${m.code}-${i}`} className="mp-tdb-motif">
          <BadgeStatut tonalite={tonaliteGravite(m.gravite)}>
            {libelleGravite(m.gravite, langue)}
          </BadgeStatut>
          <span>{m.libelle}</span>
        </li>
      ))}
    </ol>
  );
}
