import { BadgeStatut } from "../ui/BadgeStatut";
import {
  expliquerSolidite,
  formaterIndice,
  libelleLecture,
  TONALITE_LECTURE,
  type SoliditeVue,
} from "../../lib/preuves";

/**
 * Lecture de la solidité d'une assertion (solide, étayée, fragile) et indice, tels que calculés
 * par le moteur de l'API. Le texte est toujours affiché : la couleur ne porte jamais seule le sens.
 */
export function BadgeSolidite({ solidite }: { solidite: SoliditeVue | undefined }) {
  if (!solidite) return <BadgeStatut tonalite="neutre">Non évaluée</BadgeStatut>;
  return (
    <span className="mp-solidite">
      <BadgeStatut tonalite={TONALITE_LECTURE[solidite.lecture]}>
        {libelleLecture(solidite.lecture)}
      </BadgeStatut>
      <span className="mp-solidite__indice">
        <span className="mp-visuellement-cache">Indice de solidité : </span>
        {formaterIndice(solidite.indice)}
      </span>
    </span>
  );
}

/** « Pourquoi cet indice ? » : les étapes de la formule, avec les valeurs du moteur. */
export function ExplicationSolidite({ solidite }: { solidite: SoliditeVue }) {
  return (
    <details className="mp-details">
      <summary>Pourquoi cet indice ?</summary>
      <ul className="mp-solidite-explication">
        {expliquerSolidite(solidite).map((ligne) => (
          <li key={ligne}>{ligne}</li>
        ))}
      </ul>
      <p className="mp-texte-doux mp-texte-petit">
        Poids de fiabilité, plafond et seuils sont des valeurs de départ, à calibrer au pilote.
      </p>
    </details>
  );
}
