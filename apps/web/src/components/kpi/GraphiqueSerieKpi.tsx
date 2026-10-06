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

function Repere({ p }: { p: PointSerie }) {
  const forme = formeRepere(p.statut);
  const classe = `mp-kpi-serie__repere mp-kpi-serie__repere--${p.statut}${p.close ? "" : " mp-kpi-serie__repere--en-cours"}`;
  const titre = `${libellePeriode(p.periode)}${p.close ? "" : " (en cours)"} : ${p.valeur.toLocaleString("fr-FR", { maximumFractionDigits: 6 })}, ${libelleStatutKpi(p.statut).libelle}`;
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
  const g = geometrieSerie(
    periodes.map((p) => ({
      periode: p.periode,
      valeur: p.valeur,
      cible: p.cible,
      statut: p.statut,
      close: p.close,
    })),
    { libellePeriode: libellePeriodeCourt },
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
          Aucune valeur ni cible à tracer sur ces périodes : le tableau ci-dessous les liste.
        </p>
      ) : (
        <svg
          className="mp-kpi-serie__svg"
          viewBox={`0 0 ${g.largeur} ${g.hauteur}`}
          role="img"
          aria-labelledby={`${idTitre} ${idDesc}`}
        >
          <title id={idTitre}>{`Évolution de « ${libelle} » par période (${unite})`}</title>
          <desc id={idDesc}>
            {`${periodes.length} période${periodes.length > 1 ? "s" : ""}${premiere && derniere ? `, de ${libellePeriode(premiere.periode)} à ${libellePeriode(derniere.periode)}` : ""}, dont ${mesurees} mesurée${mesurees > 1 ? "s" : ""}. Ligne continue : valeur ; ligne pointillée : cible. Les valeurs sont détaillées dans le tableau qui suit le graphique.`}
          </desc>
          {g.graduations.map((t) => (
            <g key={t.valeur} aria-hidden="true">
              <line
                className="mp-kpi-serie__grille"
                x1={g.zone.gauche}
                x2={g.zone.droite}
                y1={t.y}
                y2={t.y}
              />
              <text className="mp-kpi-serie__graduation" x={g.zone.gauche - 6} y={t.y + 4}>
                {t.libelle}
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
          {g.traitsCible.map((t) => (
            <polyline key={`c${t}`} className="mp-kpi-serie__cible" points={t} />
          ))}
          {g.traitsValeur.map((t) => (
            <polyline key={`v${t}`} className="mp-kpi-serie__valeur" points={t} />
          ))}
          {g.points.map((p) => (
            <Repere key={p.periode} p={p} />
          ))}
        </svg>
      )}
      <figcaption className="mp-kpi-serie__legende">
        <span>
          <span className="mp-kpi-legende mp-kpi-legende--valeur" aria-hidden="true" /> Valeur
        </span>
        <span>
          <span className="mp-kpi-legende mp-kpi-legende--cible" aria-hidden="true" /> Cible
        </span>
        <span>Repères : rond = vert, carré = orange, triangle = rouge, anneau = sans cible ;</span>
        <span>contour pointillé = période en cours.</span>
      </figcaption>
      <details className="mp-details">
        <summary>Tableau des valeurs par période</summary>
        <Tableau
          legende={`Valeurs de « ${libelle} » par période`}
          colonnes={[
            {
              cle: "periode",
              entete: "Période",
              rendu: (p: PeriodeKpiVue) =>
                `${libellePeriode(p.periode)}${p.close ? "" : " (en cours)"}`,
            },
            {
              cle: "valeur",
              entete: "Valeur",
              alignement: "droite",
              rendu: (p) => formaterValeurKpi(p.valeur, unite),
            },
            {
              cle: "cible",
              entete: "Cible",
              alignement: "droite",
              rendu: (p) => formaterValeurKpi(p.cible, unite),
            },
            { cle: "atteinte", entete: "Atteinte", rendu: (p) => texteAtteinte(p.atteinte) },
            { cle: "statut", entete: "Statut", rendu: (p) => <BadgeStatutKpi statut={p.statut} /> },
            {
              cle: "nombre_mesures",
              entete: "Mesures",
              alignement: "droite",
              rendu: (p) => String(p.nombre_mesures),
            },
          ]}
          lignes={periodes}
          cleLigne={(p) => p.periode}
          messageVide="Aucune période évaluée à cette date."
        />
      </details>
    </figure>
  );
}
