import { BadgeStatut } from "../ui/BadgeStatut";
import { T } from "../i18n/T";
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
 * Composant partagé entre serveur et client : textes par `<T>`.
 */
export function BadgeSolidite({ solidite }: { solidite: SoliditeVue | undefined }) {
  if (!solidite)
    return (
      <BadgeStatut tonalite="neutre">
        <T fr="Non évaluée" en="Not rated" />
      </BadgeStatut>
    );
  return (
    <span className="mp-solidite">
      <BadgeStatut tonalite={TONALITE_LECTURE[solidite.lecture]}>
        <T fr={libelleLecture(solidite.lecture)} en={libelleLecture(solidite.lecture, "en")} />
      </BadgeStatut>
      <span className="mp-solidite__indice">
        <span className="mp-visuellement-cache">
          <T fr="Indice de solidité : " en="Solidity index: " />
        </span>
        {formaterIndice(solidite.indice)}
      </span>
    </span>
  );
}

/** « Pourquoi cet indice ? » : les étapes de la formule, avec les valeurs du moteur. */
export function ExplicationSolidite({ solidite }: { solidite: SoliditeVue }) {
  const fr = expliquerSolidite(solidite);
  const en = expliquerSolidite(solidite, "en");
  return (
    <details className="mp-details">
      <summary>
        <T fr="Pourquoi cet indice ?" en="Why this index?" />
      </summary>
      <ul className="mp-solidite-explication">
        {fr.map((ligne, i) => (
          <li key={ligne}>
            <T fr={ligne} en={en[i] ?? ligne} />
          </li>
        ))}
      </ul>
      <p className="mp-texte-doux mp-texte-petit">
        <T
          fr="Poids de fiabilité, plafond et seuils sont des valeurs de départ, à calibrer au pilote."
          en="Reliability weights, cap and thresholds are starting values, to be calibrated during the pilot."
        />
      </p>
    </details>
  );
}
