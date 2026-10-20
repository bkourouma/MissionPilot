import { formaterDate } from "../../lib/format";
import {
  libelleLienPlan,
  PHASE_PLAN_LIBELLES,
  STATUT_ACTION_100J_LIBELLES,
  TONALITE_STATUT_ACTION,
  type ActionPlan100j,
  type PhasePlan,
} from "../../lib/due-diligence";
import { BadgeStatut } from "../ui/BadgeStatut";
import { FormulaireAction, type ChoixAction } from "./FormulaireAction";

const PHASES: readonly PhasePlan[] = ["jours_0_30", "jours_31_60", "jours_61_100"];

export interface FrisePlan100jProps {
  dossierId: string;
  actions: ActionPlan100j[];
  /** Date d'opération connue : les dates calculées par le moteur sont affichées. */
  avecDates: boolean;
  /** Listes de choix pour corriger une action ; `null` : lecture seule. */
  edition: ChoixAction | null;
}

function plageJours(a: ActionPlan100j): string {
  return a.jour_debut === a.jour_fin
    ? `Jour ${a.jour_debut}`
    : `Jours ${a.jour_debut} à ${a.jour_fin}`;
}

/**
 * Frise du plan des 100 jours (DD-15) : trois bandes (jours 0–30, 31–60, 61–100) avec les actions,
 * leurs dates (si la date d'opération est connue), leur statut, leur responsable et leurs liens vers
 * une initiative de plan et un indicateur. Un retard est écrit en texte en plus de la couleur.
 * Composant serveur : phases, dates et retards sont calculés par l'API.
 */
export function FrisePlan100j({ dossierId, actions, avecDates, edition }: FrisePlan100jProps) {
  return (
    <div className="mp-frise">
      {PHASES.map((phase) => {
        const duPhase = actions.filter((a) => a.phase === phase);
        return (
          <section key={phase} className="mp-frise__bande" aria-label={PHASE_PLAN_LIBELLES[phase]}>
            <h3 className="mp-frise__titre">{PHASE_PLAN_LIBELLES[phase]}</h3>
            {duPhase.length === 0 ? (
              <p className="mp-texte-doux mp-texte-petit">Aucune action dans cette phase.</p>
            ) : (
              <ul className="mp-dd-liste">
                {duPhase.map((a) => (
                  <li
                    key={a.id}
                    className={
                      a.en_retard ? "mp-dd-element mp-frise__action--retard" : "mp-dd-element"
                    }
                  >
                    <p className="mp-dd-element__titre">{a.libelle}</p>
                    <span className="mp-dd-meta">
                      <BadgeStatut tonalite={TONALITE_STATUT_ACTION[a.statut_action]}>
                        {STATUT_ACTION_100J_LIBELLES[a.statut_action]}
                      </BadgeStatut>
                      {a.en_retard ? <BadgeStatut tonalite="danger">En retard</BadgeStatut> : null}
                    </span>
                    <p className="mp-texte-petit">
                      {avecDates && a.date_debut && a.date_fin
                        ? `Du ${formaterDate(a.date_debut)} au ${formaterDate(a.date_fin)} (${plageJours(a).toLowerCase()})`
                        : plageJours(a)}
                    </p>
                    {a.description ? (
                      <p className="mp-dd-texte mp-texte-doux">{a.description}</p>
                    ) : null}
                    <p className="mp-texte-petit">
                      {`Responsable : ${a.responsable ? (a.responsable.nom ?? "utilisateur supprimé") : "non désigné"}`}
                    </p>
                    <p className="mp-texte-petit">{`Initiative du plan : ${libelleLienPlan(a.plan_element)}`}</p>
                    <p className="mp-texte-petit">{`Indicateur : ${libelleLienPlan(a.kpi)}`}</p>
                    {edition ? (
                      <details className="mp-dd-details">
                        <summary>{`Corriger l'action « ${a.libelle} »`}</summary>
                        <div className="mp-dd-details__corps">
                          <FormulaireAction dossierId={dossierId} choix={edition} action={a} />
                        </div>
                      </details>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
