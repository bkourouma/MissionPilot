import type { Devise } from "../../lib/format";
import { obtenirLangue, obtenirT } from "../../lib/i18n/serveur";
import {
  libelleSens,
  lignesEcartsSerie,
  lignesHypotheses,
  tableauxSynthese,
  type LigneEcart,
  type SensEcart,
} from "../../lib/plan-comparaison";
import {
  libelleChemin,
  libelleValidationModele,
  libelleVersionModele,
  lignesSerieComparee,
  type ComparaisonModeles as Comparaison,
} from "../../lib/plan-modele";
import { classesBouton } from "../ui/Bouton";

export interface FormulaireComparaisonProps {
  /** Page du modèle (sans paramètres), cible du formulaire GET. */
  action: string;
  versionAffichee: number | null;
  de: number | null;
  a: number | null;
  derniere: number;
}

/**
 * Choix de deux versions à comparer : formulaire GET (fonctionne sans JavaScript, état dans
 * l'URL). Le numéro de la version affichée est conservé.
 */
export async function FormulaireComparaison({
  action,
  versionAffichee,
  de,
  a,
  derniere,
}: FormulaireComparaisonProps) {
  const t = await obtenirT();
  return (
    <form method="get" action={action} className="mp-plan-formulaire-ligne">
      {versionAffichee ? <input type="hidden" name="version" value={versionAffichee} /> : null}
      <div className="mp-champ">
        <label className="mp-champ__libelle" htmlFor="comparaison-de">
          {t("Version de départ", "Start version")}
        </label>
        <input
          id="comparaison-de"
          name="de"
          type="number"
          min={1}
          max={derniere}
          required
          inputMode="numeric"
          className="mp-champ__controle"
          defaultValue={de ?? Math.max(1, derniere - 1)}
        />
      </div>
      <div className="mp-champ">
        <label className="mp-champ__libelle" htmlFor="comparaison-a">
          {t("Version d'arrivée", "End version")}
        </label>
        <input
          id="comparaison-a"
          name="a"
          type="number"
          min={1}
          max={derniere}
          required
          inputMode="numeric"
          className="mp-champ__controle"
          defaultValue={a ?? derniere}
        />
      </div>
      <button type="submit" className={classesBouton("secondaire")}>
        {t("Comparer", "Compare")}
      </button>
    </form>
  );
}

const SENS_CLASSE: Record<SensEcart, string> = {
  hausse: "mp-plan-ecart mp-plan-ecart--hausse",
  baisse: "mp-plan-ecart mp-plan-ecart--baisse",
  stable: "mp-plan-ecart",
  indetermine: "mp-plan-ecart",
};

async function TableauEcarts({
  id,
  titre,
  premiereColonne,
  v1,
  v2,
  lignes,
}: {
  id: string;
  titre: string;
  premiereColonne: string;
  v1: string;
  v2: string;
  lignes: readonly LigneEcart[];
}) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  return (
    <div className="mp-plan-etat" role="region" aria-labelledby={id} tabIndex={0}>
      <table>
        <caption id={id}>{titre}</caption>
        <thead>
          <tr>
            <th scope="col">{premiereColonne}</th>
            <th scope="col">{v1}</th>
            <th scope="col">{v2}</th>
            <th scope="col">{t("Écart", "Difference")}</th>
            <th scope="col">{t("Écart relatif", "Relative difference")}</th>
          </tr>
        </thead>
        <tbody>
          {lignes.map((l) => (
            <tr key={l.cle}>
              <th scope="row">{l.libelle}</th>
              <td>{l.de}</td>
              <td>{l.a}</td>
              <td className={SENS_CLASSE[l.sens]}>
                {l.ecart}
                <span className="mp-visuellement-cache">{` (${libelleSens(l.sens, langue)})`}</span>
              </td>
              <td>{l.relatif}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Comparaison de deux versions (API) : hypothèses et écarts de scénario modifiés (avec leurs
 * valeurs), séries clés du scénario de base et synthèse des trois scénarios, avec les ÉCARTS
 * calculés par le moteur de l'API. Aucune différence n'est calculée dans le navigateur.
 */
export async function ResultatComparaison({
  comparaison: c,
  devise,
}: {
  comparaison: Comparaison;
  devise: Devise;
}) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const v1 = `Version ${c.de.version}`;
  const v2 = `Version ${c.a.version}`;
  const hypotheses = lignesHypotheses(c, langue);
  const synthese = tableauxSynthese(c, devise, langue);
  return (
    <div className="mp-plan__section">
      <ul className="mp-liste-simple">
        <li>{`${libelleVersionModele(c.de, langue)} — ${libelleValidationModele(c.de, langue)}`}</li>
        <li>{`${libelleVersionModele(c.a, langue)} — ${libelleValidationModele(c.a, langue)}`}</li>
      </ul>
      <p className="mp-texte-doux mp-texte-petit">
        {t(
          "Écart = valeur de la version d'arrivée moins celle de la version de départ ; écart relatif rapporté à la valeur de départ. Tous calculés par le moteur, sur les résultats figés des deux versions.",
          "Difference = end version value minus start version value; relative difference expressed against the start value. All computed by the engine, on the frozen results of the two versions.",
        )}
      </p>
      <div className="mp-plan-comparaison">
        <section className="mp-plan__section" aria-labelledby="titre-hypotheses-modifiees">
          <h4 id="titre-hypotheses-modifiees" className="mp-plan__intertitre">
            {t("Hypothèses modifiées", "Modified assumptions")}
          </h4>
          {hypotheses.length ? (
            <ul className="mp-liste-simple">
              {hypotheses.map((h) => (
                <li key={h.chemin}>
                  {h.de !== null && h.a !== null
                    ? `${h.libelle}${langue === "en" ? ":" : " :"} ${h.de} → ${h.a}`
                    : h.libelle}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mp-texte-doux">
              {t(
                "Aucune : mêmes hypothèses dans les deux versions.",
                "None: same assumptions in both versions.",
              )}
            </p>
          )}
        </section>
        <section className="mp-plan__section" aria-labelledby="titre-ecarts-modifies">
          <h4 id="titre-ecarts-modifies" className="mp-plan__intertitre">
            {t("Écarts de scénario modifiés", "Modified scenario deviations")}
          </h4>
          {c.ecarts_modifies.length ? (
            <ul className="mp-liste-simple">
              {c.ecarts_modifies.map((h) => (
                <li key={h}>{libelleChemin(h, langue)}</li>
              ))}
            </ul>
          ) : (
            <p className="mp-texte-doux">{t("Aucun.", "None.")}</p>
          )}
        </section>
      </div>
      {synthese.length ? (
        <div className="mp-plan-comparaison">
          {synthese.map((tab) => (
            <TableauEcarts
              key={tab.scenario}
              id={`comparaison-synthese-${tab.scenario}`}
              titre={`${tab.titre}${langue === "en" ? ": summary" : " : synthèse"}`}
              premiereColonne={t("Indicateur", "Indicator")}
              v1={v1}
              v2={v2}
              lignes={tab.lignes}
            />
          ))}
        </div>
      ) : null}
      <div className="mp-plan-comparaison">
        {c.series.map((s) => {
          const id = `comparaison-${s.cle}`;
          const titre = `${s.libelle} ${t("(scénario de base)", "(base scenario)")}`;
          if (s.points?.length) {
            return (
              <TableauEcarts
                key={s.cle}
                id={id}
                titre={titre}
                premiereColonne={t("Exercice", "Year")}
                v1={v1}
                v2={v2}
                lignes={lignesEcartsSerie(s, devise, langue)}
              />
            );
          }
          return (
            <div
              key={s.cle}
              className="mp-plan-etat"
              role="region"
              aria-labelledby={id}
              tabIndex={0}
            >
              <table>
                <caption id={id}>{titre}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("Exercice", "Year")}</th>
                    <th scope="col">{v1}</th>
                    <th scope="col">{v2}</th>
                  </tr>
                </thead>
                <tbody>
                  {lignesSerieComparee(s, devise, langue).map((l) => (
                    <tr key={l.exercice}>
                      <th scope="row">{l.exercice}</th>
                      <td>{l.de}</td>
                      <td>{l.a}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
}
