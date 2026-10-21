import type { RedMotifVoyantVue, RedVoyantPilotage } from "@missionpilot/shared";
import {
  libelleGravite,
  libelleVoyantPilotage,
  texteAlternatifVoyant,
  tonaliteGravite,
  tonaliteVoyantPilotage,
} from "../../lib/redressement-tableau";
import { BadgeStatut } from "../ui/BadgeStatut";

/**
 * Voyant de pilotage : couleur, icône ET texte (« Priorité haute », « Vigilance »…), avec un
 * texte alternatif complet pour les lecteurs d'écran. Indicatif, jamais une qualification
 * juridique de la situation du client.
 */
export function VoyantPilotage({ voyant }: { voyant: RedVoyantPilotage }) {
  return (
    <span className="mp-tdb-voyant">
      <span className="mp-visuellement-cache">{texteAlternatifVoyant(voyant)}. </span>
      <BadgeStatut tonalite={tonaliteVoyantPilotage(voyant)}>
        {libelleVoyantPilotage(voyant)}
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
  const visibles = max === undefined ? motifs : motifs.slice(0, max);
  if (visibles.length === 0) {
    return <p className="mp-texte-doux">Aucun motif n&apos;est signalé.</p>;
  }
  return (
    <ol className="mp-tdb-motifs" aria-label="Motifs du voyant, du plus grave au moins grave">
      {visibles.map((m, i) => (
        <li key={`${m.code}-${i}`} className="mp-tdb-motif">
          <BadgeStatut tonalite={tonaliteGravite(m.gravite)}>
            {libelleGravite(m.gravite)}
          </BadgeStatut>
          <span>{m.libelle}</span>
        </li>
      ))}
    </ol>
  );
}
