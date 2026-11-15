"use client";

import type { RedResultatUrgenceVue } from "@missionpilot/shared";
import { libelleDomaine } from "../../lib/redressement";
import { libelleCompteur } from "../../lib/redressement-saisie";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { Voyant } from "./Voyant";

/**
 * Résultat d'une évaluation d'urgence : un voyant par domaine avec son pourcentage (calculé par
 * le moteur), le voyant global, et « Domaine non évalué : trop peu de réponses » quand la part
 * minimale de réponses n'est pas atteinte.
 */
export function ResultatUrgence({ resultat }: { resultat: RedResultatUrgenceVue }) {
  const t = useT();
  const langue = useLangue();
  return (
    <div className="mp-red-carte-corps">
      <p>
        <span className="mp-texte-doux">{t("Voyant global :", "Overall indicator:")} </span>
        <Voyant voyant={resultat.voyant} />
      </p>
      <ul
        className="mp-red-liste-voyants"
        aria-label={t("Voyants par domaine", "Indicators by domain")}
      >
        {resultat.domaines.map((d) => (
          <li key={d.domaine}>
            <span>{libelleDomaine(d.domaine, langue)}</span>
            <span>
              <Voyant voyant={d.voyant} />{" "}
              {d.pourcentage !== null ? (
                <span className="mp-red-pourcentage">{d.pourcentage} %</span>
              ) : (
                <span className="mp-red-pourcentage">
                  {t(
                    "Domaine non évalué : trop peu de réponses",
                    "Domain not assessed: too few answers",
                  )}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
      <p className="mp-texte-doux mp-texte-petit">
        {libelleCompteur(resultat.questions_repondues, resultat.questions_total, langue)}
        {resultat.complet ? "" : t(" : évaluation incomplète", ": incomplete assessment")}.
      </p>
    </div>
  );
}
