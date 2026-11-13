import {
  creerTraduire,
  RED_VOLETS,
  type Langue,
  type RedEvaluationPlanVue,
} from "@missionpilot/shared";
import { formaterMontantMineur, type Devise } from "../../lib/format";
import { obtenirLangue } from "../../lib/i18n/serveur";
import { largeurBarre, libelleAvancement, libelleVolet } from "../../lib/redressement";
import { Alerte } from "../ui/Alerte";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Carte } from "../ui/Carte";

type Anomalie = RedEvaluationPlanVue["anomalies"][number];

function texteAnomalie(a: Anomalie, langue: Langue): string {
  const t = creerTraduire(langue);
  const n = a.numero !== null ? t(`Action n° ${a.numero} : `, `Action no. ${a.numero}: `) : "";
  switch (a.code) {
    case "AUCUNE_ACTION":
      return t("Le plan ne contient aucune action.", "The plan contains no action.");
    case "AUCUN_QUICK_WIN":
      return t(
        "Le plan ne contient aucun quick win (action à 3 à 6 mois).",
        "The plan contains no quick win (action within 3 to 6 months).",
      );
    case "QUICK_WIN_HORS_FENETRE":
      return t(
        `${n}l'échéance de ce quick win dépasse 6 mois.`,
        `${n}this quick win's due date is beyond 6 months.`,
      );
    case "RESTRUCTURATION_HORS_FENETRE":
      return t(
        `${n}l'échéance de cette restructuration sort de la fenêtre de 6 à 24 mois.`,
        `${n}this restructuring's due date falls outside the 6 to 24-month window.`,
      );
    default:
      return a.code;
  }
}

/**
 * Résumé du plan calculé par le moteur : avancement par volet (barre ET texte), actions en retard,
 * impact total attendu et anomalies (avertissements en attention, bloquants en danger).
 */
export async function ResumePlan({
  evaluation,
  devise,
}: {
  evaluation: RedEvaluationPlanVue;
  devise: Devise;
}) {
  const langue = await obtenirLangue();
  const t = creerTraduire(langue);
  const bloquantes = evaluation.anomalies.filter((a) => a.bloquante);
  const avertissements = evaluation.anomalies.filter((a) => !a.bloquante);
  return (
    <div className="mp-red-section">
      <div className="mp-red-cartes">
        {RED_VOLETS.map((v) => {
          const a = evaluation.par_volet[v];
          return (
            <Carte key={v} titre={libelleVolet(v, langue)} niveauTitre={3}>
              <div className="mp-red-barre">
                <div
                  className="mp-red-barre__piste"
                  role="progressbar"
                  aria-label={`${t("Avancement :", "Progress:")} ${libelleVolet(v, langue)}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={largeurBarre(a.avancement_pb)}
                  aria-valuetext={libelleAvancement(a.avancement_pb, langue)}
                >
                  <div
                    className="mp-red-barre__remplissage"
                    style={{ width: `${largeurBarre(a.avancement_pb)}%` }}
                  />
                </div>
                <p className="mp-red-chiffre">{libelleAvancement(a.avancement_pb, langue)}</p>
                <p className="mp-texte-doux mp-texte-petit">
                  {t(
                    `${a.terminees} terminée(s) sur ${a.total}, ${a.abandonnees} abandonnée(s), ${a.en_retard} en retard`,
                    `${a.terminees} done out of ${a.total}, ${a.abandonnees} dropped, ${a.en_retard} overdue`,
                  )}
                </p>
              </div>
            </Carte>
          );
        })}
        <Carte titre={t("Impact total attendu", "Total expected impact")} niveauTitre={3}>
          <dl className="mp-liste-def">
            <div>
              <dt>{t("Trésorerie dégagée (une fois)", "Cash released (one-off)")}</dt>
              <dd className="mp-red-valeur">
                {formaterMontantMineur(evaluation.impact_tresorerie_unique, devise, langue)}
              </dd>
            </div>
            <div>
              <dt>{t("Gain de résultat annuel", "Annual income gain")}</dt>
              <dd className="mp-red-valeur">
                {formaterMontantMineur(evaluation.impact_resultat_annuel, devise, langue)}
              </dd>
            </div>
          </dl>
          <p className="mp-texte-doux mp-texte-petit">
            {t(
              "Ordres de grandeur du moteur : les effets des leviers ne se cumulent pas mécaniquement.",
              "Orders of magnitude from the engine: lever effects do not simply add up.",
            )}
          </p>
        </Carte>
      </div>
      {evaluation.en_retard.length > 0 ? (
        <p>
          <BadgeStatut tonalite="danger">
            {t(
              `${evaluation.en_retard.length} action(s) en retard : n° ${evaluation.en_retard.join(", n° ")}`,
              `${evaluation.en_retard.length} overdue action(s): no. ${evaluation.en_retard.join(", no. ")}`,
            )}
          </BadgeStatut>
        </p>
      ) : null}
      {bloquantes.length > 0 ? (
        <Alerte
          tonalite="danger"
          titre={t("À corriger avant la validation", "To fix before approval")}
          annonce="aucune"
        >
          <ul className="mp-liste-simple">
            {bloquantes.map((a, i) => (
              <li key={`${a.code}-${i}`}>{texteAnomalie(a, langue)}</li>
            ))}
          </ul>
        </Alerte>
      ) : null}
      {avertissements.length > 0 ? (
        <Alerte tonalite="attention" titre={t("Avertissements", "Warnings")} annonce="aucune">
          <ul className="mp-liste-simple">
            {avertissements.map((a, i) => (
              <li key={`${a.code}-${a.numero ?? i}`}>{texteAnomalie(a, langue)}</li>
            ))}
          </ul>
        </Alerte>
      ) : null}
    </div>
  );
}
