import type { Devise } from "../../lib/format";
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
export function FormulaireComparaison({
  action,
  versionAffichee,
  de,
  a,
  derniere,
}: FormulaireComparaisonProps) {
  return (
    <form method="get" action={action} className="mp-plan-formulaire-ligne">
      {versionAffichee ? <input type="hidden" name="version" value={versionAffichee} /> : null}
      <div className="mp-champ">
        <label className="mp-champ__libelle" htmlFor="comparaison-de">
          Version de départ
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
          Version d&apos;arrivée
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
        Comparer
      </button>
    </form>
  );
}

/**
 * Comparaison de deux versions (API) : hypothèses et écarts modifiés, séries clés du scénario
 * de base côte à côte. Aucune différence n'est calculée dans le navigateur : les valeurs des
 * deux versions sont présentées telles que le moteur les a figées.
 */
export function ResultatComparaison({
  comparaison: c,
  devise,
}: {
  comparaison: Comparaison;
  devise: Devise;
}) {
  const v1 = `Version ${c.de.version}`;
  const v2 = `Version ${c.a.version}`;
  return (
    <div className="mp-plan__section">
      <ul className="mp-liste-simple">
        <li>{`${libelleVersionModele(c.de)} — ${libelleValidationModele(c.de)}`}</li>
        <li>{`${libelleVersionModele(c.a)} — ${libelleValidationModele(c.a)}`}</li>
      </ul>
      <div className="mp-plan-comparaison">
        <section className="mp-plan__section" aria-labelledby="titre-hypotheses-modifiees">
          <h4 id="titre-hypotheses-modifiees" className="mp-plan__intertitre">
            Hypothèses modifiées
          </h4>
          {c.hypotheses_modifiees.length ? (
            <ul className="mp-liste-simple">
              {c.hypotheses_modifiees.map((h) => (
                <li key={h}>{libelleChemin(h)}</li>
              ))}
            </ul>
          ) : (
            <p className="mp-texte-doux">Aucune : mêmes hypothèses dans les deux versions.</p>
          )}
        </section>
        <section className="mp-plan__section" aria-labelledby="titre-ecarts-modifies">
          <h4 id="titre-ecarts-modifies" className="mp-plan__intertitre">
            Écarts de scénario modifiés
          </h4>
          {c.ecarts_modifies.length ? (
            <ul className="mp-liste-simple">
              {c.ecarts_modifies.map((h) => (
                <li key={h}>{libelleChemin(h)}</li>
              ))}
            </ul>
          ) : (
            <p className="mp-texte-doux">Aucun.</p>
          )}
        </section>
      </div>
      <div className="mp-plan-comparaison">
        {c.series.map((s) => {
          const id = `comparaison-${s.cle}`;
          return (
            <div
              key={s.cle}
              className="mp-plan-etat"
              role="region"
              aria-labelledby={id}
              tabIndex={0}
            >
              <table>
                <caption id={id}>{`${s.libelle} (scénario de base)`}</caption>
                <thead>
                  <tr>
                    <th scope="col">Exercice</th>
                    <th scope="col">{v1}</th>
                    <th scope="col">{v2}</th>
                  </tr>
                </thead>
                <tbody>
                  {lignesSerieComparee(s, devise).map((l) => (
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
