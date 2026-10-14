import type { RedResultatUrgenceVue } from "@missionpilot/shared";
import { libelleDomaine } from "../../lib/redressement";
import { Voyant } from "./Voyant";

/**
 * Résultat d'une évaluation d'urgence : un voyant par domaine avec son pourcentage (calculé par
 * le moteur), le voyant global, et « Domaine non évalué : trop peu de réponses » quand la part
 * minimale de réponses n'est pas atteinte.
 */
export function ResultatUrgence({ resultat }: { resultat: RedResultatUrgenceVue }) {
  return (
    <div className="mp-red-carte-corps">
      <p>
        <span className="mp-texte-doux">Voyant global : </span>
        <Voyant voyant={resultat.voyant} />
      </p>
      <ul className="mp-red-liste-voyants" aria-label="Voyants par domaine">
        {resultat.domaines.map((d) => (
          <li key={d.domaine}>
            <span>{libelleDomaine(d.domaine)}</span>
            <span>
              <Voyant voyant={d.voyant} />{" "}
              {d.pourcentage !== null ? (
                <span className="mp-red-pourcentage">{d.pourcentage} %</span>
              ) : (
                <span className="mp-red-pourcentage">
                  Domaine non évalué : trop peu de réponses
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
      <p className="mp-texte-doux mp-texte-petit">
        {resultat.questions_repondues} question{resultat.questions_repondues > 1 ? "s" : ""}{" "}
        renseignée{resultat.questions_repondues > 1 ? "s" : ""} sur {resultat.questions_total}
        {resultat.complet ? "" : " : évaluation incomplète"}.
      </p>
    </div>
  );
}
