"use client";

import { formaterMontantMineur, type Devise } from "../../lib/format";
import {
  descriptionGraphique,
  geometrieTresorerie,
  MARQUEURS,
  pointsTriangle,
  libelleTrait,
  seriesTresorerie,
} from "../../lib/plan-graphique";
import {
  libelleScenario,
  SCENARIOS,
  type NomScenario,
  type ResultatScenarios,
} from "../../lib/plan-modele";
import { useLangue, useT } from "../i18n/FournisseurLangue";

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
  const t = useT();
  const langue = useLangue();
  const series = seriesTresorerie(resultat, langue);
  const g = geometrieTresorerie(series);
  if (!g) {
    return (
      <p className="mp-texte-doux">{t("Aucun exercice à représenter.", "No year to display.")}</p>
    );
  }
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
        <title id={idTitre}>
          {t(
            `Trésorerie nette de clôture, de ${premier} à ${dernier}`,
            `Closing net cash, from ${premier} to ${dernier}`,
          )}
        </title>
        <desc id={idDesc}>{descriptionGraphique(resultat, langue)}</desc>
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
                <title>{`${s.libelle}, ${m.exercice}${langue === "en" ? ":" : " :"} ${formaterMontantMineur(m.valeur, devise, langue)}`}</title>
              </g>
            ))}
          </g>
        ))}
      </svg>
      <figcaption>
        <ul className="mp-plan-legende" aria-label={t("Légende du graphique", "Chart legend")}>
          {SCENARIOS.map((s) => (
            <li key={s}>
              <Echantillon scenario={s} />
              <span>{`${libelleScenario(s, langue)} (${libelleTrait(s, langue)})`}</span>
            </li>
          ))}
        </ul>
        <p className="mp-texte-doux mp-texte-petit">
          {t(
            "Trait horizontal épais : trésorerie nulle. Valeurs exactes dans le tableau ci-dessous.",
            "Thick horizontal line: zero cash. Exact values are in the table below.",
          )}
        </p>
      </figcaption>
      <div className="mp-plan-etat" role="region" aria-labelledby={idTableau} tabIndex={0}>
        <table>
          <caption id={idTableau}>
            {t(
              "Trésorerie nette de clôture par scénario (valeurs du graphique)",
              "Closing net cash by scenario (chart values)",
            )}
          </caption>
          <thead>
            <tr>
              <th scope="col">{t("Exercice", "Year")}</th>
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
                      {formaterMontantMineur(v, devise, langue)}
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
