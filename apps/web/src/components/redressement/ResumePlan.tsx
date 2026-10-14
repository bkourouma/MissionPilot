import { RED_VOLETS, type RedEvaluationPlanVue } from "@missionpilot/shared";
import { formaterMontantMineur, type Devise } from "../../lib/format";
import { largeurBarre, libelleAvancement, libelleVolet } from "../../lib/redressement";
import { Alerte } from "../ui/Alerte";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Carte } from "../ui/Carte";

type Anomalie = RedEvaluationPlanVue["anomalies"][number];

function texteAnomalie(a: Anomalie): string {
  const n = a.numero !== null ? `Action n° ${a.numero} : ` : "";
  switch (a.code) {
    case "AUCUNE_ACTION":
      return "Le plan ne contient aucune action.";
    case "AUCUN_QUICK_WIN":
      return "Le plan ne contient aucun quick win (action à 3 à 6 mois).";
    case "QUICK_WIN_HORS_FENETRE":
      return `${n}l'échéance de ce quick win dépasse 6 mois.`;
    case "RESTRUCTURATION_HORS_FENETRE":
      return `${n}l'échéance de cette restructuration sort de la fenêtre de 6 à 24 mois.`;
    default:
      return a.code;
  }
}

/**
 * Résumé du plan calculé par le moteur : avancement par volet (barre ET texte), actions en retard,
 * impact total attendu et anomalies (avertissements en attention, bloquants en danger).
 */
export function ResumePlan({
  evaluation,
  devise,
}: {
  evaluation: RedEvaluationPlanVue;
  devise: Devise;
}) {
  const bloquantes = evaluation.anomalies.filter((a) => a.bloquante);
  const avertissements = evaluation.anomalies.filter((a) => !a.bloquante);
  return (
    <div className="mp-red-section">
      <div className="mp-red-cartes">
        {RED_VOLETS.map((v) => {
          const a = evaluation.par_volet[v];
          return (
            <Carte key={v} titre={libelleVolet(v)} niveauTitre={3}>
              <div className="mp-red-barre">
                <div
                  className="mp-red-barre__piste"
                  role="progressbar"
                  aria-label={`Avancement : ${libelleVolet(v)}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={largeurBarre(a.avancement_pb)}
                  aria-valuetext={libelleAvancement(a.avancement_pb)}
                >
                  <div
                    className="mp-red-barre__remplissage"
                    style={{ width: `${largeurBarre(a.avancement_pb)}%` }}
                  />
                </div>
                <p className="mp-red-chiffre">{libelleAvancement(a.avancement_pb)}</p>
                <p className="mp-texte-doux mp-texte-petit">
                  {a.terminees} terminée(s) sur {a.total}, {a.abandonnees} abandonnée(s),{" "}
                  {a.en_retard} en retard
                </p>
              </div>
            </Carte>
          );
        })}
        <Carte titre="Impact total attendu" niveauTitre={3}>
          <dl className="mp-liste-def">
            <div>
              <dt>Trésorerie dégagée (une fois)</dt>
              <dd className="mp-red-valeur">
                {formaterMontantMineur(evaluation.impact_tresorerie_unique, devise)}
              </dd>
            </div>
            <div>
              <dt>Gain de résultat annuel</dt>
              <dd className="mp-red-valeur">
                {formaterMontantMineur(evaluation.impact_resultat_annuel, devise)}
              </dd>
            </div>
          </dl>
          <p className="mp-texte-doux mp-texte-petit">
            Ordres de grandeur du moteur : les effets des leviers ne se cumulent pas mécaniquement.
          </p>
        </Carte>
      </div>
      {evaluation.en_retard.length > 0 ? (
        <p>
          <BadgeStatut tonalite="danger">
            {evaluation.en_retard.length} action(s) en retard : n°{" "}
            {evaluation.en_retard.join(", n° ")}
          </BadgeStatut>
        </p>
      ) : null}
      {bloquantes.length > 0 ? (
        <Alerte tonalite="danger" titre="À corriger avant la validation" annonce="aucune">
          <ul className="mp-liste-simple">
            {bloquantes.map((a, i) => (
              <li key={`${a.code}-${i}`}>{texteAnomalie(a)}</li>
            ))}
          </ul>
        </Alerte>
      ) : null}
      {avertissements.length > 0 ? (
        <Alerte tonalite="attention" titre="Avertissements" annonce="aucune">
          <ul className="mp-liste-simple">
            {avertissements.map((a, i) => (
              <li key={`${a.code}-${a.numero ?? i}`}>{texteAnomalie(a)}</li>
            ))}
          </ul>
        </Alerte>
      ) : null}
    </div>
  );
}
