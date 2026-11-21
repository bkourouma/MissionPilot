import { creerTraduire } from "@missionpilot/shared";
import { formaterDate } from "../../lib/format";
import { obtenirLangue } from "../../lib/i18n/serveur";
import {
  libelleLienPlan,
  libellesDd,
  TONALITE_STATUT_ACTION,
  type ActionPlan100j,
  type PhasePlan,
} from "../../lib/due-diligence";
import { BadgeStatut } from "../ui/BadgeStatut";
import "./due-diligence-lecture.css";
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

/**
 * Frise du plan des 100 jours (DD-15) : trois bandes (jours 0–30, 31–60, 61–100) avec les actions,
 * leurs dates (si la date d'opération est connue), leur statut, leur responsable et leurs liens vers
 * une initiative de plan et un indicateur. Un retard est écrit en texte en plus de la couleur.
 * Composant serveur : phases, dates et retards sont calculés par l'API.
 */
export async function FrisePlan100j({
  dossierId,
  actions,
  avecDates,
  edition,
}: FrisePlan100jProps) {
  const langue = await obtenirLangue();
  const t = creerTraduire(langue);
  const L = libellesDd(langue);
  const plageJours = (a: ActionPlan100j): string =>
    a.jour_debut === a.jour_fin
      ? t(`Jour ${a.jour_debut}`, `Day ${a.jour_debut}`)
      : t(`Jours ${a.jour_debut} à ${a.jour_fin}`, `Days ${a.jour_debut} to ${a.jour_fin}`);
  return (
    <div className="mp-frise">
      {PHASES.map((phase) => {
        const duPhase = actions.filter((a) => a.phase === phase);
        return (
          <section key={phase} className="mp-frise__bande" aria-label={L.PHASE[phase]}>
            <h3 className="mp-frise__titre">{L.PHASE[phase]}</h3>
            {duPhase.length === 0 ? (
              <p className="mp-texte-doux mp-texte-petit">
                {t("Aucune action dans cette phase.", "No action in this phase.")}
              </p>
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
                        {L.STATUT_ACTION[a.statut_action]}
                      </BadgeStatut>
                      {a.en_retard ? (
                        <BadgeStatut tonalite="danger">{t("En retard", "Overdue")}</BadgeStatut>
                      ) : null}
                    </span>
                    {a.description ? (
                      <p className="mp-dd-texte mp-texte-doux">{a.description}</p>
                    ) : null}
                    <dl className="mp-dd-faits">
                      <dt>{t("Période", "Period")}</dt>
                      <dd>
                        {avecDates && a.date_debut && a.date_fin
                          ? t(
                              `Du ${formaterDate(a.date_debut)} au ${formaterDate(a.date_fin)} (${plageJours(a).toLowerCase()})`,
                              `From ${formaterDate(a.date_debut, "UTC", langue)} to ${formaterDate(a.date_fin, "UTC", langue)} (${plageJours(a).toLowerCase()})`,
                            )
                          : plageJours(a)}
                      </dd>
                      <dt>{t("Responsable", "Owner")}</dt>
                      <dd>
                        {a.responsable
                          ? (a.responsable.nom ?? t("utilisateur supprimé", "deleted user"))
                          : t("non désigné", "not assigned")}
                      </dd>
                      <dt>{t("Initiative du plan", "Plan initiative")}</dt>
                      <dd>{libelleLienPlan(a.plan_element, langue)}</dd>
                      <dt>{t("Indicateur", "KPI")}</dt>
                      <dd>{libelleLienPlan(a.kpi, langue)}</dd>
                    </dl>
                    {edition ? (
                      <details className="mp-dd-details">
                        <summary>
                          {t(
                            `Corriger l'action « ${a.libelle} »`,
                            `Edit the action “${a.libelle}”`,
                          )}
                        </summary>
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
