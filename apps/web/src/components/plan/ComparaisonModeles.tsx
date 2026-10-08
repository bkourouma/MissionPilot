import type { Devise } from "../../lib/format";
import {
  LIBELLES_SENS,
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

const SENS_CLASSE: Record<SensEcart, string> = {
  hausse: "mp-plan-ecart mp-plan-ecart--hausse",
  baisse: "mp-plan-ecart mp-plan-ecart--baisse",
  stable: "mp-plan-ecart",
  indetermine: "mp-plan-ecart",
};

function TableauEcarts({
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
  return (
    <div className="mp-plan-etat" role="region" aria-labelledby={id} tabIndex={0}>
      <table>
        <caption id={id}>{titre}</caption>
        <thead>
          <tr>
            <th scope="col">{premiereColonne}</th>
            <th scope="col">{v1}</th>
            <th scope="col">{v2}</th>
            <th scope="col">Écart</th>
            <th scope="col">Écart relatif</th>
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
                <span className="mp-visuellement-cache">{` (${LIBELLES_SENS[l.sens]})`}</span>
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
export function ResultatComparaison({
  comparaison: c,
  devise,
}: {
  comparaison: Comparaison;
  devise: Devise;
}) {
  const v1 = `Version ${c.de.version}`;
  const v2 = `Version ${c.a.version}`;
  const hypotheses = lignesHypotheses(c);
  const synthese = tableauxSynthese(c, devise);
  return (
    <div className="mp-plan__section">
      <ul className="mp-liste-simple">
        <li>{`${libelleVersionModele(c.de)} — ${libelleValidationModele(c.de)}`}</li>
        <li>{`${libelleVersionModele(c.a)} — ${libelleValidationModele(c.a)}`}</li>
      </ul>
      <p className="mp-texte-doux mp-texte-petit">
        Écart = valeur de la version d&apos;arrivée moins celle de la version de départ ; écart
        relatif rapporté à la valeur de départ. Tous calculés par le moteur, sur les résultats figés
        des deux versions.
      </p>
      <div className="mp-plan-comparaison">
        <section className="mp-plan__section" aria-labelledby="titre-hypotheses-modifiees">
          <h4 id="titre-hypotheses-modifiees" className="mp-plan__intertitre">
            Hypothèses modifiées
          </h4>
          {hypotheses.length ? (
            <ul className="mp-liste-simple">
              {hypotheses.map((h) => (
                <li key={h.chemin}>
                  {h.de !== null && h.a !== null ? `${h.libelle} : ${h.de} → ${h.a}` : h.libelle}
                </li>
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
      {synthese.length ? (
        <div className="mp-plan-comparaison">
          {synthese.map((t) => (
            <TableauEcarts
              key={t.scenario}
              id={`comparaison-synthese-${t.scenario}`}
              titre={`${t.titre} : synthèse`}
              premiereColonne="Indicateur"
              v1={v1}
              v2={v2}
              lignes={t.lignes}
            />
          ))}
        </div>
      ) : null}
      <div className="mp-plan-comparaison">
        {c.series.map((s) => {
          const id = `comparaison-${s.cle}`;
          const titre = `${s.libelle} (scénario de base)`;
          if (s.points?.length) {
            return (
              <TableauEcarts
                key={s.cle}
                id={id}
                titre={titre}
                premiereColonne="Exercice"
                v1={v1}
                v2={v2}
                lignes={lignesEcartsSerie(s, devise)}
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
