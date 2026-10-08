import { formaterReponse, type Definition } from "../../lib/questionnaires-definition";
import "./questionnaires.css";

/**
 * Réponses SOUMISES d'un répondant (ou réponse partagée), section par section, mises en forme
 * selon leur question. Une question sans réponse est signalée comme telle ; une question
 * conditionnelle sans réponse a pu ne pas être affichée au répondant.
 */
export function AffichageReponses({
  definition,
  reponses,
  idBase,
}: {
  definition: Definition;
  reponses: Record<string, unknown>;
  idBase: string;
}) {
  let numero = 0;
  return (
    <div className="mp-pile mp-pile--large">
      {definition.sections.map((s, si) => (
        <section key={`${s.id}-${si}`} className="mp-pile" aria-labelledby={`${idBase}-s${si}`}>
          <h5 id={`${idBase}-s${si}`} className="mp-sous-formulaire__titre">
            {`${si + 1}. ${s.titre}`}
          </h5>
          <dl className="mp-reponses">
            {s.questions.map((q) => {
              numero += 1;
              const valeur = Object.prototype.hasOwnProperty.call(reponses, q.id)
                ? reponses[q.id]
                : null;
              const texte = formaterReponse(q, valeur);
              return (
                <div key={q.id}>
                  <dt>{`${numero}. ${q.libelle}`}</dt>
                  <dd>
                    {texte ?? (
                      <span className="mp-reponses__vide">
                        {q.condition || s.condition
                          ? "Sans réponse (question conditionnelle, peut-être non affichée)"
                          : "Sans réponse"}
                      </span>
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        </section>
      ))}
    </div>
  );
}
