"use client";

import type { StatutAppelOffres } from "@missionpilot/shared";
import { libelleStatutAo, statutsManuels } from "../../lib/appels-offres";
import { api } from "../../lib/api";
import { BoutonActionAo, seg } from "./ActionsAoBouton";

/*
 * Actions des écrans d'appels d'offres (AO-01 à AO-03, AO-08). Chaque action appelle l'API, qui
 * reste seule juge des droits, des transitions et des calculs (moteur) ; l'écran se rafraîchit
 * ensuite pour montrer l'état serveur.
 *
 * Sous-composants : `ActionsAoBouton` (bouton d'action), `ActionsAoEvaluation` (score et
 * décision), `ActionsAoTexte` (texte et extraction), `ActionsAoExigence` (matrice),
 * `ActionsAoEtape` (rétro-planning).
 */

export { BoutonActionAo } from "./ActionsAoBouton";
export { FormulaireEvaluationAo, FormulaireDecisionAo } from "./ActionsAoEvaluation";
export { FormulaireDossierAo, LancerExtractionAo, ValidationExtractionAo } from "./ActionsAoTexte";
export { FormulaireExigenceAo, SuiviExigenceAo } from "./ActionsAoExigence";
export { ActionsEtapeAo } from "./ActionsAoEtape";

/** Dépôt, puis gagné ou perdu (« en réponse » et « no-go » relèvent de la décision). */
export function ActionsStatutAo({ id, statut }: { id: string; statut: StatutAppelOffres }) {
  const statuts = statutsManuels(statut);
  if (statuts.length === 0) return null;
  return (
    <div className="mp-ao__actions">
      {statuts.map((s) => (
        <BoutonActionAo
          key={s}
          variante={s === "perdu" ? "danger" : "primaire"}
          confirmation={`Passer l'appel d'offres à « ${libelleStatutAo(s)} » ?`}
          action={() => api.post(`/api/appels-offres/${seg(id)}/statut`, { statut: s })}
        >
          {s === "depose" ? "Marquer déposé" : `Marquer ${libelleStatutAo(s).toLowerCase()}`}
        </BoutonActionAo>
      ))}
    </div>
  );
}
