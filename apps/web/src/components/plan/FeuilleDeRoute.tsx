import { obtenirLangue, obtenirT } from "../../lib/i18n/serveur";
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
export async function FeuilleDeRoute({ feuille }: { feuille: Feuille }) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
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
            {feuille.pas === "semestre"
              ? t(
                  "Initiatives par semestre (dates recalées)",
                  "Initiatives by half-year (rescheduled dates)",
                )
              : t(
                  "Initiatives par trimestre (dates recalées)",
                  "Initiatives by quarter (rescheduled dates)",
                )}
          </caption>
          <thead>
            <tr>
              <th scope="col">{t("Initiative", "Initiative")}</th>
              {feuille.periodes.map((p) => (
                <th scope="col" key={p.periode}>
                  {libellePeriodeFeuille(p.periode, langue)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grille.map(({ initiative: i, cases }) => {
              const prevues = datesPrevues(i, langue);
              return (
                <tr key={i.id}>
                  <th scope="row">
                    <span className="mp-plan-feuille__titre">
                      <span>{i.titre}</span>
                      <span className="mp-plan-feuille__meta">
                        {`${periodeInitiative(i, langue)} · ${i.statut_libelle} · ${libelleStatutContenu(i.statut_contenu, langue)}`}
                      </span>
                      {prevues ? <span className="mp-plan-feuille__meta">{prevues}</span> : null}
                      {i.recalee || i.critique || i.conflits.length ? (
                        <span className="mp-plan-feuille__marques">
                          {i.recalee ? (
                            <BadgeStatut tonalite="attention">
                              {t(
                                `Recalée ${libelleDecalage(i.decalage_jours)}`,
                                `Rescheduled ${libelleDecalage(i.decalage_jours, langue)}`,
                              )}
                            </BadgeStatut>
                          ) : null}
                          {i.conflits.length ? (
                            <BadgeStatut tonalite="danger">
                              {t("Conflit de dates", "Date conflict")}
                            </BadgeStatut>
                          ) : null}
                          {i.critique ? (
                            <BadgeStatut tonalite="neutre">
                              {t("Chemin critique", "Critical path")}
                            </BadgeStatut>
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
                          <span className="mp-visuellement-cache">{t("active", "active")}</span>
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
async function ExplicationsFeuille({ feuille }: { feuille: Feuille }) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const lignes = feuille.initiatives
    .map((i) => ({ i, l: explicationsInitiative(i, feuille, langue) }))
    .filter((x) => x.l.length > 0);
  if (!lignes.length) return null;
  return (
    <section className="mp-plan__section" aria-labelledby="titre-explications-feuille">
      <h4 id="titre-explications-feuille" className="mp-plan__intertitre">
        {t("Recalages et points d'attention", "Rescheduling and points of attention")}
      </h4>
      <ul className="mp-plan-feuille__explications">
        {lignes.map(({ i, l }) => (
          <li key={i.id}>
            <strong>{i.titre}</strong>
            {langue === "en" ? ":" : " :"} {l.join(" ")}
          </li>
        ))}
      </ul>
    </section>
  );
}
