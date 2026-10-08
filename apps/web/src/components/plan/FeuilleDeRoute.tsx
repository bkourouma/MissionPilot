import { BadgeStatut } from "../ui/BadgeStatut";
import {
  datesPrevues,
  explicationsInitiative,
  grilleFeuilleDeRoute,
  libelleDecalage,
  libellePeriodeFeuille,
  periodeInitiative,
  type FeuilleDeRoute as Feuille,
} from "../../lib/plan-feuille-de-route";
import { libelleStatutContenu } from "../../lib/plan-strategique";

/**
 * Feuille de route par période (PLA-05) : une ligne par initiative active, une colonne par
 * trimestre ou semestre, aux dates RECALÉES par le moteur de l'API. La couleur ne porte jamais
 * seule le sens : chaque case occupée porte un texte caché (« active »), chaque initiative
 * recalée, critique ou en conflit a son badge écrit et son explication.
 */
export function FeuilleDeRoute({ feuille }: { feuille: Feuille }) {
  const grille = grilleFeuilleDeRoute(feuille);
  return (
    <div className="mp-plan__section">
      <div
        className="mp-plan-etat mp-plan-feuille"
        role="region"
        aria-labelledby="titre-grille-feuille"
        tabIndex={0}
      >
        <table>
          <caption id="titre-grille-feuille">
            {`Initiatives par ${feuille.pas === "semestre" ? "semestre" : "trimestre"} (dates recalées)`}
          </caption>
          <thead>
            <tr>
              <th scope="col">Initiative</th>
              {feuille.periodes.map((p) => (
                <th scope="col" key={p.periode}>
                  {libellePeriodeFeuille(p.periode)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grille.map(({ initiative: i, cases }) => {
              const prevues = datesPrevues(i);
              return (
                <tr key={i.id}>
                  <th scope="row">
                    <span className="mp-plan-feuille__titre">
                      <span>{i.titre}</span>
                      <span className="mp-plan-feuille__meta">
                        {`${periodeInitiative(i)} · ${i.statut_libelle} · ${libelleStatutContenu(i.statut_contenu)}`}
                      </span>
                      {prevues ? <span className="mp-plan-feuille__meta">{prevues}</span> : null}
                      {i.recalee || i.critique || i.conflits.length ? (
                        <span className="mp-plan-feuille__marques">
                          {i.recalee ? (
                            <BadgeStatut tonalite="attention">
                              {`Recalée ${libelleDecalage(i.decalage_jours)}`}
                            </BadgeStatut>
                          ) : null}
                          {i.conflits.length ? (
                            <BadgeStatut tonalite="danger">Conflit de dates</BadgeStatut>
                          ) : null}
                          {i.critique ? (
                            <BadgeStatut tonalite="neutre">Chemin critique</BadgeStatut>
                          ) : null}
                        </span>
                      ) : null}
                    </span>
                  </th>
                  {cases.map((active, n) => (
                    <td key={feuille.periodes[n]?.periode ?? n} className="mp-plan-feuille__case">
                      {active ? (
                        <span
                          className={[
                            "mp-plan-feuille__barre",
                            i.critique ? "mp-plan-feuille__barre--critique" : "",
                            i.recalee ? "mp-plan-feuille__barre--recalee" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          <span className="mp-visuellement-cache">active</span>
                        </span>
                      ) : null}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ExplicationsFeuille feuille={feuille} />
    </div>
  );
}

/** Explications écrites des recalages, conflits et dépendances ignorées. */
function ExplicationsFeuille({ feuille }: { feuille: Feuille }) {
  const lignes = feuille.initiatives
    .map((i) => ({ i, l: explicationsInitiative(i, feuille) }))
    .filter((x) => x.l.length > 0);
  if (!lignes.length) return null;
  return (
    <section className="mp-plan__section" aria-labelledby="titre-explications-feuille">
      <h4 id="titre-explications-feuille" className="mp-plan__intertitre">
        Recalages et points d&apos;attention
      </h4>
      <ul className="mp-plan-feuille__explications">
        {lignes.map(({ i, l }) => (
          <li key={i.id}>
            <strong>{i.titre}</strong> : {l.join(" ")}
          </li>
        ))}
      </ul>
    </section>
  );
}
