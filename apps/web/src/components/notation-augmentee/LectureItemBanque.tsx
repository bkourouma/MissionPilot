import { PUBLIC_ITEM_LIBELLES, type ItemBanqueDonnees } from "@missionpilot/shared";
import { formaterNombre } from "../../lib/format";
import { libelleDimensionBanque } from "./suggestions";
import "./notation-augmentee.css";

/**
 * Contenu d'un item de la banque en lecture seule (version validée ou consultation) : identification,
 * échelle avec ses ancrages comportementaux, formulations par public, paramètres de sélection et
 * étalonnage observé (informatif).
 */
export function LectureItemBanque({ contenu }: { contenu: ItemBanqueDonnees }) {
  const e = contenu.etalonnage;
  return (
    <div className="mp-na-lecture">
      <dl className="mp-liste-def mp-liste-def--compacte">
        <div>
          <dt>Code</dt>
          <dd>{contenu.code}</dd>
        </div>
        <div>
          <dt>Dimension</dt>
          <dd>{libelleDimensionBanque(contenu.dimension)}</dd>
        </div>
        <div>
          <dt>Pratique évaluée</dt>
          <dd>{contenu.pratique}</dd>
        </div>
        <div>
          <dt>Intitulé</dt>
          <dd>{contenu.intitule}</dd>
        </div>
        <div>
          <dt>Poids</dt>
          <dd>{formaterNombre(contenu.poids, 2)}</dd>
        </div>
        <div>
          <dt>Priorité</dt>
          <dd>{contenu.priorite} (1 : cœur de la dimension)</dd>
        </div>
        <div>
          <dt>Durée de réponse</dt>
          <dd>{contenu.dureeSecondes} secondes</dd>
        </div>
        {e ? (
          <div>
            <dt>Étalonnage observé</dt>
            <dd>
              {formaterNombre(e.echantillon, 0)} cotations, moyenne {formaterNombre(e.moyenne, 2)},
              écart-type {formaterNombre(e.ecartType, 2)}
            </dd>
          </div>
        ) : null}
      </dl>

      <section aria-labelledby="na-titre-echelle" className="mp-pile">
        <h3 id="na-titre-echelle" className="mp-section__titre">
          Échelle et ancrages ({contenu.echelle.niveaux} niveaux)
        </h3>
        <ol className="mp-na-liste">
          {contenu.echelle.libelles.map((libelle, i) => {
            const ancrage = contenu.ancrages.find((a) => a.niveau === i + 1);
            return (
              <li key={i}>
                <span className="mp-na-liste__titre">
                  Niveau {i + 1} : {libelle}
                </span>
                <span className="mp-na-texte-long">
                  {ancrage?.comportement ?? "Aucun comportement décrit."}
                </span>
                {ancrage?.exemples && ancrage.exemples.length > 0 ? (
                  <ul className="mp-na-cotations">
                    {ancrage.exemples.map((x, j) => (
                      <li key={j}>
                        <strong>{x.contexte}</strong> : {x.texte}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ol>
      </section>

      <section aria-labelledby="na-titre-formulations" className="mp-pile">
        <h3 id="na-titre-formulations" className="mp-section__titre">
          Formulations par public
        </h3>
        <ul className="mp-na-liste">
          {contenu.formulations.map((f) => (
            <li key={f.public}>
              <span className="mp-na-liste__titre">{PUBLIC_ITEM_LIBELLES[f.public]}</span>
              <span className="mp-na-texte-long">{f.texte}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
