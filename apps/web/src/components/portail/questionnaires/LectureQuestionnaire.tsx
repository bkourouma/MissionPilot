import type { DefinitionQuestionnaireDonnees } from "@missionpilot/shared";
import { useT, useLangue } from "../../i18n/FournisseurLangue";
import { EtatVide } from "../../ui/EtatListe";
import {
  libelleReponse,
  SANS_REPONSE,
  SANS_REPONSE_EN,
  type Reponses,
} from "../../../lib/portail-questionnaires";
import {
  propre,
  saisiesInitiales,
  visiblesDepuisSaisies,
} from "../../../lib/portail-questionnaires-saisie";
import "./questionnaires.css";

/**
 * Réponses en lecture seule (questionnaire envoyé ou clos), section par section : seules les
 * questions visibles pour ces réponses sont listées (mêmes conditions d'affichage que la saisie).
 */
export function LectureQuestionnaire({
  definition,
  reponses,
}: {
  definition: DefinitionQuestionnaireDonnees;
  reponses: Reponses;
}) {
  const t = useT();
  const langue = useLangue();
  const visibles = visiblesDepuisSaisies(definition, saisiesInitiales(definition, reponses));
  const sections = definition.sections
    .map((s) => ({ section: s, questions: s.questions.filter((q) => visibles.has(q.id)) }))
    .filter((x) => x.questions.length > 0);
  if (sections.length === 0) {
    return (
      <EtatVide
        titre={t("Aucune réponse n'a été enregistrée.", "No response has been saved.")}
        icone="taches"
      />
    );
  }
  return (
    <div className="mp-pq-lecture">
      {sections.map(({ section, questions }) => {
        const idTitre = `mp-pq-lecture-${section.id}`;
        return (
          <section key={section.id} className="mp-pq-section" aria-labelledby={idTitre}>
            <h2 id={idTitre} className="mp-section__titre">
              {section.titre}
            </h2>
            <dl className="mp-pq-lecture__liste">
              {questions.map((q) => {
                const texte = libelleReponse(q, propre(reponses, q.id), langue);
                return (
                  <div key={q.id} className="mp-pq-lecture__ligne">
                    <dt>{q.libelle}</dt>
                    <dd
                      className={
                        texte === SANS_REPONSE || texte === SANS_REPONSE_EN
                          ? "mp-pq-lecture__vide"
                          : undefined
                      }
                    >
                      {texte}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </section>
        );
      })}
    </div>
  );
}
