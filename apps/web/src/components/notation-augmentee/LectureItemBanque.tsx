import type { ItemBanqueDonnees } from "@missionpilot/shared";
import { formaterNombre } from "../../lib/format";
import { obtenirLangue, obtenirT } from "../../lib/i18n/serveur";
import { libellePublicItem } from "../../lib/notation-augmentee";
import { libelleDimensionBanque } from "./suggestions";
import "./notation-augmentee.css";

/**
 * Contenu d'un item de la banque en lecture seule (version validée ou consultation) : identification,
 * échelle avec ses ancrages comportementaux, formulations par public, paramètres de sélection et
 * étalonnage observé (informatif).
 */
export async function LectureItemBanque({ contenu }: { contenu: ItemBanqueDonnees }) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const e = contenu.etalonnage;
  return (
    <div className="mp-na-lecture">
      <dl className="mp-liste-def mp-liste-def--compacte">
        <div>
          <dt>{t("Code", "Code")}</dt>
          <dd>{contenu.code}</dd>
        </div>
        <div>
          <dt>{t("Dimension", "Dimension")}</dt>
          <dd>{libelleDimensionBanque(contenu.dimension)}</dd>
        </div>
        <div>
          <dt>{t("Pratique évaluée", "Practice assessed")}</dt>
          <dd>{contenu.pratique}</dd>
        </div>
        <div>
          <dt>{t("Intitulé", "Title")}</dt>
          <dd>{contenu.intitule}</dd>
        </div>
        <div>
          <dt>{t("Poids", "Weight")}</dt>
          <dd>{formaterNombre(contenu.poids, 2, langue)}</dd>
        </div>
        <div>
          <dt>{t("Priorité", "Priority")}</dt>
          <dd>
            {contenu.priorite} {t("(1 : cœur de la dimension)", "(1: core of the dimension)")}
          </dd>
        </div>
        <div>
          <dt>{t("Durée de réponse", "Answer time")}</dt>
          <dd>
            {contenu.dureeSecondes} {t("secondes", "seconds")}
          </dd>
        </div>
        {e ? (
          <div>
            <dt>{t("Étalonnage observé", "Observed calibration")}</dt>
            <dd>
              {t(
                `${formaterNombre(e.echantillon, 0)} cotations, moyenne ${formaterNombre(e.moyenne, 2)}, écart-type ${formaterNombre(e.ecartType, 2)}`,
                `${formaterNombre(e.echantillon, 0, langue)} ratings, mean ${formaterNombre(e.moyenne, 2, langue)}, standard deviation ${formaterNombre(e.ecartType, 2, langue)}`,
              )}
            </dd>
          </div>
        ) : null}
      </dl>

      <section aria-labelledby="na-titre-echelle" className="mp-pile">
        <h3 id="na-titre-echelle" className="mp-section__titre">
          {t("Échelle et ancrages", "Scale and anchors")} ({contenu.echelle.niveaux}{" "}
          {t("niveaux", "levels")})
        </h3>
        <ol className="mp-na-liste">
          {contenu.echelle.libelles.map((libelle, i) => {
            const ancrage = contenu.ancrages.find((a) => a.niveau === i + 1);
            return (
              <li key={i}>
                <span className="mp-na-liste__titre">
                  {t("Niveau", "Level")} {i + 1} : {libelle}
                </span>
                <span className="mp-na-texte-long">
                  {ancrage?.comportement ??
                    t("Aucun comportement décrit.", "No behavior described.")}
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
          {t("Formulations par public", "Wordings by audience")}
        </h3>
        <ul className="mp-na-liste">
          {contenu.formulations.map((f) => (
            <li key={f.public}>
              <span className="mp-na-liste__titre">{libellePublicItem(f.public, langue)}</span>
              <span className="mp-na-texte-long">{f.texte}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
