import { creerTraduire, type RedSemaineTresorerieVue } from "@missionpilot/shared";
import { formaterMontantMineur, type Devise } from "../../lib/format";
import { obtenirLangue } from "../../lib/i18n/serveur";
import { geometrieSoldes, lignesTableauSoldes } from "../../lib/redressement-graphiques";
import { abregerSemaine, formaterSemaine } from "../../lib/redressement";
import { Tableau } from "../ui/Tableau";
import { Icone } from "../ui/Icone";

/**
 * Soldes de clôture sur 13 semaines en SVG : solde prévu (pointillé), solde retenu (trait plein)
 * et droite du seuil de tension. Les repères en tension portent une forme distincte (carré) en
 * plus de la couleur ; le tableau qui suit porte toutes les valeurs (alternative accessible).
 * Les soldes sont ceux de l'API : le graphique ne fait que les placer.
 */
export async function GraphiqueSoldes({
  semaines,
  seuil,
  devise,
}: {
  semaines: RedSemaineTresorerieVue[];
  seuil: number;
  devise: Devise;
}) {
  const langue = await obtenirLangue();
  const t = creerTraduire(langue);
  const g = geometrieSoldes(semaines, seuil, { langue });
  const tensions = semaines.filter((s) => s.tension).length;
  return (
    <figure className="mp-red-graphique">
      {g.vide ? (
        <p className="mp-texte-doux">{t("Aucune semaine à tracer.", "No week to plot.")}</p>
      ) : (
        <svg
          className="mp-red-graphique__svg"
          viewBox={`0 0 ${g.largeur} ${g.hauteur}`}
          role="img"
          aria-labelledby="graphique-soldes-titre graphique-soldes-desc"
        >
          <title id="graphique-soldes-titre">
            {t("Soldes de trésorerie sur 13 semaines", "Cash balances over 13 weeks")}
          </title>
          <desc id="graphique-soldes-desc">
            {t(
              `${semaines.length} semaines, dont ${tensions} en tension. Ligne continue : solde retenu ; ligne pointillée : solde prévu ; droite en pointillés fins : seuil de tension. Les valeurs sont détaillées dans le tableau qui suit le graphique.`,
              `${semaines.length} weeks, ${tensions} of them tight. Solid line: retained balance; dashed line: projected balance; fine dotted line: tension threshold. Values are detailed in the table following the chart.`,
            )}
          </desc>
          {g.graduations.map((grad) => (
            <g key={grad.valeur} aria-hidden="true">
              <line
                className="mp-red-graphique__grille"
                x1={g.zone.gauche}
                x2={g.zone.droite}
                y1={grad.y}
                y2={grad.y}
              />
              <text className="mp-red-graphique__graduation" x={g.zone.gauche - 6} y={grad.y + 4}>
                {grad.libelle}
              </text>
            </g>
          ))}
          {g.abscisses.map((a) => (
            <text
              key={a.semaine}
              className="mp-red-graphique__abscisse"
              x={a.x}
              y={g.zone.bas + 20}
              aria-hidden="true"
            >
              {a.libelle}
            </text>
          ))}
          {g.ySeuil !== null ? (
            <line
              className="mp-red-graphique__seuil"
              x1={g.zone.gauche}
              x2={g.zone.droite}
              y1={g.ySeuil}
              y2={g.ySeuil}
            />
          ) : null}
          <polyline className="mp-red-graphique__prevu" points={g.traitPrevu} />
          <polyline className="mp-red-graphique__retenu" points={g.traitRetenu} />
          {g.points.map((p) =>
            p.tension ? (
              <rect
                key={p.semaine}
                className="mp-red-graphique__repere mp-red-graphique__repere--tension"
                x={p.x - 4.5}
                y={p.yRetenu - 4.5}
                width={9}
                height={9}
              >
                <title>{t(`Semaine ${p.semaine} : tension`, `Week ${p.semaine}: tension`)}</title>
              </rect>
            ) : (
              <circle
                key={p.semaine}
                className="mp-red-graphique__repere"
                cx={p.x}
                cy={p.yRetenu}
                r={4}
              >
                <title>{t(`Semaine ${p.semaine}`, `Week ${p.semaine}`)}</title>
              </circle>
            ),
          )}
        </svg>
      )}
      <figcaption className="mp-red-graphique__legende">
        <span>
          <span className="mp-red-legende" aria-hidden="true" />{" "}
          {t("Solde retenu", "Retained balance")}
        </span>
        <span>
          <span className="mp-red-legende mp-red-legende--prevu" aria-hidden="true" />{" "}
          {t("Solde prévu", "Projected balance")}
        </span>
        <span>
          <span className="mp-red-legende mp-red-legende--seuil" aria-hidden="true" />{" "}
          {t("Seuil de tension", "Tension threshold")} (
          {formaterMontantMineur(seuil, devise, langue)})
        </span>
        <span>
          <Icone nom="attention" taille={14} />{" "}
          {t("Carré : semaine de tension", "Square: tight week")}
        </span>
      </figcaption>
      <Tableau
        legende={t(
          "Soldes de clôture par semaine (équivalent du graphique)",
          "Closing balances by week (chart equivalent)",
        )}
        colonnes={[
          {
            cle: "semaine",
            entete: t("Semaine", "Week"),
            rendu: (l: ReturnType<typeof lignesTableauSoldes>[number]) =>
              `${abregerSemaine(l.semaine, langue)} (${formaterSemaine(l.debut, l.fin, langue)})`,
          },
          {
            cle: "prevu",
            entete: t("Solde prévu", "Projected balance"),
            alignement: "droite",
            rendu: (l) => formaterMontantMineur(l.solde_prevu, devise, langue),
          },
          {
            cle: "retenu",
            entete: t("Solde retenu", "Retained balance"),
            alignement: "droite",
            rendu: (l) => formaterMontantMineur(l.solde_retenu, devise, langue),
          },
          {
            cle: "tension",
            entete: t("Situation", "Position"),
            rendu: (l) => (l.tension ? t("Tension", "Tight") : "—"),
          },
        ]}
        lignes={lignesTableauSoldes(semaines)}
        cleLigne={(l) => String(l.semaine)}
      />
    </figure>
  );
}
