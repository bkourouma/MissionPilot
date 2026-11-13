import { LOCALES_INTL, type Langue } from "@missionpilot/shared";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import {
  formaterValeurKpi,
  libellePeriode,
  libellePeriodeCourt,
  libelleStatutKpi,
  texteAtteinte,
  type PeriodeKpiVue,
} from "../../lib/kpi";
import {
  formeRepere,
  geometrieSerie,
  pointsTriangle,
  type PointSerie,
} from "../../lib/kpi-graphiques";
import { Tableau } from "../ui/Tableau";
import { BadgeStatutKpi } from "./BadgeStatutKpi";

export interface GraphiqueSerieKpiProps {
  libelle: string;
  unite: string;
  periodes: readonly PeriodeKpiVue[];
  /** Préfixe unique des identifiants (titre et description du SVG). */
  idPrefixe: string;
}

function Repere({ p, langue }: { p: PointSerie; langue: Langue }) {
  const forme = formeRepere(p.statut);
  const classe = `mp-kpi-serie__repere mp-kpi-serie__repere--${p.statut}${p.close ? "" : " mp-kpi-serie__repere--en-cours"}`;
  const titre = `${libellePeriode(p.periode, langue)}${p.close ? "" : langue === "en" ? " (current)" : " (en cours)"} : ${p.valeur.toLocaleString(LOCALES_INTL[langue], { maximumFractionDigits: 6 })}, ${libelleStatutKpi(p.statut, langue).libelle}`;
  const contenu = <title>{titre}</title>;
  if (forme === "rond") {
    return (
      <circle className={classe} cx={p.x} cy={p.y} r={5}>
        {contenu}
      </circle>
    );
  }
  if (forme === "carre") {
    return (
      <rect className={classe} x={p.x - 4.5} y={p.y - 4.5} width={9} height={9}>
        {contenu}
      </rect>
    );
  }
  if (forme === "triangle") {
    return (
      <polygon className={classe} points={pointsTriangle(p.x, p.y)}>
        {contenu}
      </polygon>
    );
  }
  return (
    <circle className={`${classe} mp-kpi-serie__repere--anneau`} cx={p.x} cy={p.y} r={4.5}>
      {contenu}
    </circle>
  );
}

/**
 * Évolution d'un KPI par période (valeurs et cibles agrégées par le moteur) en SVG : ligne
 * des valeurs, ligne pointillée des cibles, un repère par période mesurée dont la FORME suit
 * le statut (rond vert, carré orange, triangle rouge, anneau sans cible) en plus de la
 * couleur. Le tableau qui suit porte toutes les valeurs (alternative accessible).
 */
export function GraphiqueSerieKpi({ libelle, unite, periodes, idPrefixe }: GraphiqueSerieKpiProps) {
  const t = useT();
  const langue = useLangue();
  const g = geometrieSerie(
    periodes.map((p) => ({
      periode: p.periode,
      valeur: p.valeur,
      cible: p.cible,
      statut: p.statut,
      close: p.close,
    })),
    { libellePeriode: (cle) => libellePeriodeCourt(cle, langue), langue },
  );
  const idTitre = `${idPrefixe}-titre`;
  const idDesc = `${idPrefixe}-desc`;
  const mesurees = periodes.filter((p) => p.valeur !== null).length;
  const premiere = periodes[0];
  const derniere = periodes[periodes.length - 1];
  return (
    <figure className="mp-kpi-serie">
      {g.vide ? (
        <p className="mp-texte-doux">
          {t(
            "Aucune valeur ni cible à tracer sur ces périodes : le tableau ci-dessous les liste.",
            "No value or target to plot over these periods: the table below lists them.",
          )}
        </p>
      ) : (
        <svg
          className="mp-kpi-serie__svg"
          viewBox={`0 0 ${g.largeur} ${g.hauteur}`}
          role="img"
          aria-labelledby={`${idTitre} ${idDesc}`}
        >
          <title id={idTitre}>
            {t(
              `Évolution de « ${libelle} » par période (${unite})`,
              `Trend of "${libelle}" by period (${unite})`,
            )}
          </title>
          <desc id={idDesc}>
            {t(
              `${periodes.length} période${periodes.length > 1 ? "s" : ""}${premiere && derniere ? `, de ${libellePeriode(premiere.periode, langue)} à ${libellePeriode(derniere.periode, langue)}` : ""}, dont ${mesurees} mesurée${mesurees > 1 ? "s" : ""}. Ligne continue : valeur ; ligne pointillée : cible. Les valeurs sont détaillées dans le tableau qui suit le graphique.`,
              `${periodes.length} period${periodes.length > 1 ? "s" : ""}${premiere && derniere ? `, from ${libellePeriode(premiere.periode, langue)} to ${libellePeriode(derniere.periode, langue)}` : ""}, of which ${mesurees} measured. Solid line: value; dotted line: target. The values are detailed in the table that follows the chart.`,
            )}
          </desc>
          {g.graduations.map((grad) => (
            <g key={grad.valeur} aria-hidden="true">
              <line
                className="mp-kpi-serie__grille"
                x1={g.zone.gauche}
                x2={g.zone.droite}
                y1={grad.y}
                y2={grad.y}
              />
              <text className="mp-kpi-serie__graduation" x={g.zone.gauche - 6} y={grad.y + 4}>
                {grad.libelle}
              </text>
            </g>
          ))}
          {g.abscisses.map((a) =>
            a.libelle ? (
              <text
                key={a.periode}
                className="mp-kpi-serie__abscisse"
                x={a.x}
                y={g.zone.bas + 20}
                aria-hidden="true"
              >
                {a.libelle}
              </text>
            ) : null,
          )}
          {g.traitsCible.map((trait) => (
            <polyline key={`c${trait}`} className="mp-kpi-serie__cible" points={trait} />
          ))}
          {g.traitsValeur.map((trait) => (
            <polyline key={`v${trait}`} className="mp-kpi-serie__valeur" points={trait} />
          ))}
          {g.points.map((p) => (
            <Repere key={p.periode} p={p} langue={langue} />
          ))}
        </svg>
      )}
      <figcaption className="mp-kpi-serie__legende">
        <span>
          <span className="mp-kpi-legende mp-kpi-legende--valeur" aria-hidden="true" />{" "}
          {t("Valeur", "Value")}
        </span>
        <span>
          <span className="mp-kpi-legende mp-kpi-legende--cible" aria-hidden="true" />{" "}
          {t("Cible", "Target")}
        </span>
        <span>
          {t(
            "Repères : rond = vert, carré = orange, triangle = rouge, anneau = sans cible ;",
            "Markers: circle = green, square = orange, triangle = red, ring = no target;",
          )}
        </span>
        <span>
          {t("contour pointillé = période en cours.", "dotted outline = current period.")}
        </span>
      </figcaption>
      <details className="mp-details">
        <summary>{t("Tableau des valeurs par période", "Table of values by period")}</summary>
        <Tableau
          legende={t(`Valeurs de « ${libelle} » par période`, `Values of "${libelle}" by period`)}
          colonnes={[
            {
              cle: "periode",
              entete: t("Période", "Period"),
              rendu: (p: PeriodeKpiVue) =>
                `${libellePeriode(p.periode, langue)}${p.close ? "" : t(" (en cours)", " (current)")}`,
            },
            {
              cle: "valeur",
              entete: t("Valeur", "Value"),
              alignement: "droite",
              rendu: (p) => formaterValeurKpi(p.valeur, unite, langue),
            },
            {
              cle: "cible",
              entete: t("Cible", "Target"),
              alignement: "droite",
              rendu: (p) => formaterValeurKpi(p.cible, unite, langue),
            },
            {
              cle: "atteinte",
              entete: t("Atteinte", "Attainment"),
              rendu: (p) => texteAtteinte(p.atteinte, langue),
            },
            {
              cle: "statut",
              entete: t("Statut", "Status"),
              rendu: (p) => <BadgeStatutKpi statut={p.statut} langue={langue} />,
            },
            {
              cle: "nombre_mesures",
              entete: t("Mesures", "Measurements"),
              alignement: "droite",
              rendu: (p) => String(p.nombre_mesures),
            },
          ]}
          lignes={periodes}
          cleLigne={(p) => p.periode}
          messageVide={t(
            "Aucune période évaluée à cette date.",
            "No period assessed at this date.",
          )}
        />
      </details>
    </figure>
  );
}
