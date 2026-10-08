import { formaterMontantMineur, type Devise } from "../../lib/format";
import {
  descriptionGraphique,
  geometrieTresorerie,
  MARQUEURS,
  pointsTriangle,
  seriesTresorerie,
  TRAITS,
} from "../../lib/plan-graphique";
import {
  SCENARIOS,
  SCENARIO_LIBELLES,
  type NomScenario,
  type ResultatScenarios,
} from "../../lib/plan-modele";

function Marqueur({ scenario, x, y }: { scenario: NomScenario; x: number; y: number }) {
  const classe = `mp-plan-graphique__point--${scenario}`;
  const forme = MARQUEURS[scenario];
  if (forme === "carre")
    return <rect className={classe} x={x - 4} y={y - 4} width={8} height={8} />;
  if (forme === "triangle") return <polygon className={classe} points={pointsTriangle(x, y)} />;
  return <circle className={classe} cx={x} cy={y} r={4} />;
}

function Echantillon({ scenario }: { scenario: NomScenario }) {
  return (
    <svg width="36" height="14" viewBox="0 0 36 14" aria-hidden="true" focusable="false">
      <line
        className={`mp-plan-graphique__serie mp-plan-graphique__serie--${scenario}`}
        x1="2"
        y1="7"
        x2="34"
        y2="7"
      />
      <Marqueur scenario={scenario} x={18} y={7} />
    </svg>
  );
}

/**
 * Trésorerie nette de clôture des trois scénarios (valeurs du moteur) : graphique SVG simple,
 * étiqueté, suivi de son tableau équivalent (alternative accessible). Trait, motif et forme de
 * point distinguent les scénarios sans dépendre de la couleur ; seul le zéro est gradué.
 */
export function GraphiqueTresorerie({
  resultat,
  devise,
  idPrefixe,
}: {
  resultat: Pick<ResultatScenarios, NomScenario>;
  devise: Devise;
  idPrefixe: string;
}) {
  const series = seriesTresorerie(resultat);
  const g = geometrieTresorerie(series);
  if (!g) return <p className="mp-texte-doux">Aucun exercice à représenter.</p>;
  const idTitre = `${idPrefixe}-titre`;
  const idDesc = `${idPrefixe}-desc`;
  const idTableau = `${idPrefixe}-tableau`;
  const premier = g.abscisses[0]?.exercice;
  const dernier = g.abscisses.at(-1)?.exercice;
  return (
    <figure className="mp-plan-graphique">
      <svg
        className="mp-plan-graphique__svg"
        viewBox={`0 0 ${g.largeur} ${g.hauteur}`}
        role="img"
        aria-labelledby={`${idTitre} ${idDesc}`}
      >
        <title id={idTitre}>{`Trésorerie nette de clôture, de ${premier} à ${dernier}`}</title>
        <desc id={idDesc}>{descriptionGraphique(resultat)}</desc>
        <rect
          className="mp-plan-graphique__cadre"
          x={g.gauche}
          y={g.haut}
          width={g.droite - g.gauche}
          height={g.bas - g.haut}
        />
        <line
          className="mp-plan-graphique__zero"
          x1={g.gauche}
          y1={g.yZero}
          x2={g.droite}
          y2={g.yZero}
        />
        <text
          className="mp-plan-graphique__texte"
          x={g.gauche - 6}
          y={g.yZero}
          textAnchor="end"
          dominantBaseline="middle"
          aria-hidden="true"
        >
          0
        </text>
        {g.abscisses.map((a) => (
          <text
            key={a.exercice}
            className="mp-plan-graphique__texte"
            x={a.x}
            y={g.bas + 16}
            textAnchor="middle"
            aria-hidden="true"
          >
            {a.exercice}
          </text>
        ))}
        {g.series.map((s) => (
          <g key={s.scenario}>
            <polyline
              className={`mp-plan-graphique__serie mp-plan-graphique__serie--${s.scenario}`}
              points={s.points}
            />
            {s.marqueurs.map((m) => (
              <g key={m.exercice}>
                <Marqueur scenario={s.scenario} x={m.x} y={m.y} />
                <title>{`${s.libelle}, ${m.exercice} : ${formaterMontantMineur(m.valeur, devise)}`}</title>
              </g>
            ))}
          </g>
        ))}
      </svg>
      <figcaption>
        <ul className="mp-plan-legende" aria-label="Légende du graphique">
          {SCENARIOS.map((s) => (
            <li key={s}>
              <Echantillon scenario={s} />
              <span>{`${SCENARIO_LIBELLES[s]} (${TRAITS[s]})`}</span>
            </li>
          ))}
        </ul>
        <p className="mp-texte-doux mp-texte-petit">
          Trait horizontal épais : trésorerie nulle. Valeurs exactes dans le tableau ci-dessous.
        </p>
      </figcaption>
      <div className="mp-plan-etat" role="region" aria-labelledby={idTableau} tabIndex={0}>
        <table>
          <caption id={idTableau}>
            Trésorerie nette de clôture par scénario (valeurs du graphique)
          </caption>
          <thead>
            <tr>
              <th scope="col">Exercice</th>
              {series.map((s) => (
                <th key={s.scenario} scope="col">
                  {s.libelle}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {g.abscisses.map((a, i) => (
              <tr key={a.exercice}>
                <th scope="row">{a.exercice}</th>
                {series.map((s) => {
                  const v = s.points[i]?.valeur;
                  return (
                    <td
                      key={s.scenario}
                      className={
                        typeof v === "number" && v < 0 ? "mp-plan-etat__negatif" : undefined
                      }
                    >
                      {formaterMontantMineur(v, devise)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
