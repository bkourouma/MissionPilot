import { formaterMontantMineur, type Devise } from "../../lib/format";
import { obtenirLangue } from "../../lib/i18n/serveur";
import {
  libelleSigne,
  descriptionHistogramme,
  geometrieHistogramme,
  lignesHistogramme,
  type ResultatMonteCarlo,
} from "../../lib/plan-montecarlo";

/**
 * Histogramme de la VAN (classes du moteur) : SVG étiqueté, suivi de son tableau équivalent.
 * Les classes de VAN négative sont hachurées (pas seulement colorées) ; la médiane et le zéro
 * sont tracés et nommés dans la légende.
 */
export async function HistogrammeVan({
  resultat,
  devise,
  idPrefixe,
}: {
  resultat: ResultatMonteCarlo;
  devise: Devise;
  idPrefixe: string;
}) {
  const langue = await obtenirLangue();
  const t = (fr: string, en: string) => (langue === "en" ? en : fr);
  const histo = resultat.van.histogramme;
  const g = geometrieHistogramme(histo);
  if (!g)
    return (
      <p className="mp-texte-doux">{t("Aucune classe à représenter.", "No class to display.")}</p>
    );
  const idTitre = `${idPrefixe}-titre`;
  const idDesc = `${idPrefixe}-desc`;
  const idHachure = `${idPrefixe}-hachure`;
  const xMediane = g.abscisse(resultat.van.percentiles.p50);
  const lignes = lignesHistogramme(histo, devise, langue);
  const bornes = histo.bornes;
  return (
    <figure className="mp-mc__histogramme">
      <svg
        className="mp-mc__svg"
        viewBox={`0 0 ${g.largeur} ${g.hauteur}`}
        role="img"
        aria-labelledby={`${idTitre} ${idDesc}`}
      >
        <title id={idTitre}>
          {t(
            "Distribution de la valeur actuelle nette (VAN)",
            "Distribution of the net present value (NPV)",
          )}
        </title>
        <desc id={idDesc}>{descriptionHistogramme(resultat, devise, langue)}</desc>
        <defs>
          <pattern id={idHachure} width="6" height="6" patternUnits="userSpaceOnUse">
            <path className="mp-mc__hachure" d="M0 6 L6 0" />
          </pattern>
        </defs>
        {g.barres.map((b) => (
          <g key={b.index}>
            <rect
              className={`mp-mc__barre mp-mc__barre--${b.signe}`}
              x={b.x}
              y={b.y}
              width={b.largeur}
              height={b.hauteur}
            />
            {b.signe !== "positive" ? (
              <rect
                x={b.x}
                y={b.y}
                width={b.largeur}
                height={b.hauteur}
                fill={`url(#${idHachure})`}
              />
            ) : null}
            <title>{`${lignes[b.index]?.classe} : ${b.effectif} ${t("tirage(s)", "draw(s)")}, ${libelleSigne(b.signe, langue)}`}</title>
          </g>
        ))}
        <line className="mp-mc__axe" x1={g.gauche} y1={g.bas} x2={g.droite} y2={g.bas} />
        {g.xZero !== null ? (
          <line className="mp-mc__zero" x1={g.xZero} y1={g.haut} x2={g.xZero} y2={g.bas} />
        ) : null}
        <line className="mp-mc__mediane" x1={xMediane} y1={g.haut} x2={xMediane} y2={g.bas} />
        <text
          className="mp-mc__texte"
          x={g.gauche}
          y={g.bas + 16}
          textAnchor="start"
          aria-hidden="true"
        >
          {formaterMontantMineur(bornes[0], devise, langue)}
        </text>
        <text
          className="mp-mc__texte"
          x={g.droite}
          y={g.bas + 16}
          textAnchor="end"
          aria-hidden="true"
        >
          {formaterMontantMineur(bornes[bornes.length - 1], devise, langue)}
        </text>
      </svg>
      <figcaption>
        <ul className="mp-mc__legende" aria-label={t("Légende du graphique", "Chart legend")}>
          <li>
            <svg width="28" height="14" viewBox="0 0 28 14" aria-hidden="true" focusable="false">
              <rect className="mp-mc__barre" x="1" y="1" width="26" height="12" />
            </svg>
            <span>{t("VAN positive", "Positive NPV")}</span>
          </li>
          <li>
            <svg width="28" height="14" viewBox="0 0 28 14" aria-hidden="true" focusable="false">
              <rect
                className="mp-mc__barre mp-mc__barre--negative"
                x="1"
                y="1"
                width="26"
                height="12"
              />
              <rect x="1" y="1" width="26" height="12" fill={`url(#${idHachure})`} />
            </svg>
            <span>{t("VAN négative (hachurée)", "Negative NPV (hatched)")}</span>
          </li>
          <li>
            <svg width="28" height="14" viewBox="0 0 28 14" aria-hidden="true" focusable="false">
              <line className="mp-mc__mediane" x1="2" y1="7" x2="26" y2="7" />
            </svg>
            <span>{t("Médiane", "Median")}</span>
          </li>
          {g.xZero !== null ? (
            <li>
              <svg width="28" height="14" viewBox="0 0 28 14" aria-hidden="true" focusable="false">
                <line className="mp-mc__zero" x1="2" y1="7" x2="26" y2="7" />
              </svg>
              <span>{t("VAN nulle", "Zero NPV")}</span>
            </li>
          ) : null}
        </ul>
      </figcaption>
      <details>
        <summary>{t("Voir le tableau des classes de VAN", "View the NPV classes table")}</summary>
        <div
          className="mp-mc__tableau"
          role="region"
          aria-label={t("Tableau des classes de VAN", "NPV classes table")}
          tabIndex={0}
        >
          <table>
            <caption>
              {t(
                "Nombre de tirages par classe de VAN (valeurs du graphique)",
                "Number of draws per NPV class (chart values)",
              )}
            </caption>
            <thead>
              <tr>
                <th scope="col">{t("Classe de VAN", "NPV class")}</th>
                <th scope="col">{t("Tirages", "Draws")}</th>
              </tr>
            </thead>
            <tbody>
              {lignes.map((l) => (
                <tr key={l.cle}>
                  <th scope="row">{l.classe}</th>
                  <td>{l.effectif}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
