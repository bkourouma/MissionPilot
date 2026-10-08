import { formaterScore, libelleFamille, type DonneesRapport } from "../../lib/notation";
import { longueurBarre, SEUILS_CLASSES } from "../../lib/notation-graphiques";
import { BadgeClasse } from "./BadgeClasse";

export interface BarresFamillesProps {
  barres: DonneesRapport["barres"];
}

/**
 * Barres par dimension, regroupées par famille (NOT-07), dans l'ordre de la grille. Chaque
 * ligne écrit son score et sa classe ; la barre, décorative, est masquée aux lecteurs d'écran.
 * Repères verticaux aux seuils des classes (35, 50, 65, 80).
 */
export function BarresFamilles({ barres }: BarresFamillesProps) {
  return (
    <div className="mp-notation-barres">
      {barres.map((f) => (
        <section key={f.famille || "sans-famille"} aria-label={libelleFamille(f.famille)}>
          <h4 className="mp-notation-barres__famille">{libelleFamille(f.famille)}</h4>
          <ul className="mp-notation-barres__liste">
            {f.dimensions.map((d) => (
              <li
                key={d.dimension}
                className={
                  d.score === null
                    ? "mp-notation-barre mp-notation-barre--absente"
                    : "mp-notation-barre"
                }
              >
                <span className="mp-notation-barre__libelle">{d.libelle}</span>
                {d.score === null ? (
                  <span className="mp-notation-barre__valeur">—</span>
                ) : (
                  <span className="mp-notation-barre__valeur">
                    {formaterScore(d.score)}
                    <span className="mp-visuellement-cache"> sur 100,</span>{" "}
                    <BadgeClasse classe={d.classe} />
                  </span>
                )}
                <span className="mp-notation-barre__piste" aria-hidden="true">
                  {d.score === null ? null : (
                    <span
                      className="mp-notation-barre__remplissage"
                      style={{ width: longueurBarre(d.score) }}
                    />
                  )}
                  {SEUILS_CLASSES.map((s) => (
                    <span key={s} className="mp-notation-barre__repere" style={{ left: `${s}%` }} />
                  ))}
                </span>
                {d.score === null ? (
                  <span className="mp-notation-barre__absente">
                    Dimension non notable : réponses insuffisantes.
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
