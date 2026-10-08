import { formaterScore, type DonneesRapport } from "../../lib/notation";
import { geometrieRadar } from "../../lib/notation-graphiques";

export interface GraphiqueRadarProps {
  radar: DonneesRapport["radar"];
  /** Préfixe unique des identifiants (titre et description du SVG). */
  idPrefixe: string;
}

/**
 * Radar de maturité (NOT-07) en SVG : une seule série (les scores de l'API), anneaux aux seuils
 * des classes. Les axes sont numérotés et renvoient à une légende écrite (libellés longs, écran
 * étroit) ; le tableau des dimensions porte toutes les valeurs (alternative accessible).
 */
export function GraphiqueRadar({ radar, idPrefixe }: GraphiqueRadarProps) {
  if (radar.length < 3) {
    return (
      <p className="mp-texte-doux">
        Le radar demande au moins trois dimensions : consultez le tableau des scores ci-dessous.
      </p>
    );
  }
  const g = geometrieRadar(radar);
  const notables = radar.length - g.nonNotables;
  const idTitre = `${idPrefixe}-titre`;
  const idDesc = `${idPrefixe}-desc`;
  return (
    <figure className="mp-notation-radar">
      <svg
        className="mp-notation-radar__svg"
        viewBox={`-24 -8 ${g.taille + 48} ${g.taille + 16}`}
        role="img"
        aria-labelledby={`${idTitre} ${idDesc}`}
      >
        <title id={idTitre}>Radar de maturité par dimension, sur 100</title>
        <desc id={idDesc}>
          {`${notables} dimension${notables > 1 ? "s" : ""} notée${notables > 1 ? "s" : ""} sur ${radar.length}. Anneaux aux seuils des classes : 35, 50, 65, 80 et 100. Les valeurs sont détaillées dans la légende et dans le tableau des scores.`}
        </desc>
        {g.anneaux.map((a) => (
          <polygon key={a.valeur} className="mp-notation-radar__grille" points={a.points} />
        ))}
        {g.axes.map((a) => (
          <line
            key={a.dimension}
            className="mp-notation-radar__axe"
            x1={g.centre}
            y1={g.centre}
            x2={a.x}
            y2={a.y}
          />
        ))}
        {g.anneaux.map((a) => (
          <text
            key={`s${a.valeur}`}
            className="mp-notation-radar__seuil"
            x={g.centre + 3}
            y={a.yLibelle - 2}
            aria-hidden="true"
          >
            {a.valeur}
          </text>
        ))}
        {g.polygone ? <polygon className="mp-notation-radar__surface" points={g.polygone} /> : null}
        {g.axes.map((a) =>
          a.point ? (
            <circle
              key={`p${a.dimension}`}
              className="mp-notation-radar__point"
              cx={a.point.x}
              cy={a.point.y}
              r={4}
            >
              <title>{`${a.numero}. ${a.libelle} : ${formaterScore(a.score)} sur 100`}</title>
            </circle>
          ) : null,
        )}
        {g.axes.map((a) => (
          <text
            key={`n${a.dimension}`}
            className="mp-notation-radar__numero"
            x={a.xNumero}
            y={a.yNumero}
            textAnchor="middle"
            dominantBaseline="middle"
            aria-hidden="true"
          >
            {a.numero}
          </text>
        ))}
      </svg>
      <figcaption>
        <ol className="mp-notation-legende" aria-label="Légende du radar">
          {g.axes.map((a) => (
            <li key={a.dimension}>
              <span className="mp-notation-legende__numero" aria-hidden="true">
                {a.numero}.
              </span>
              <span className="mp-notation-legende__libelle">{a.libelle}</span>
              <span className="mp-notation-legende__valeur">
                {a.score === null ? "non notable" : formaterScore(a.score)}
              </span>
            </li>
          ))}
        </ol>
        {g.nonNotables > 0 ? (
          <p className="mp-texte-doux mp-texte-petit">
            Les dimensions non notables (réponses insuffisantes) ne sont pas tracées.
          </p>
        ) : null}
      </figcaption>
    </figure>
  );
}
