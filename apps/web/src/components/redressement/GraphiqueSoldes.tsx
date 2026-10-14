import type { RedSemaineTresorerieVue } from "@missionpilot/shared";
import { formaterMontantMineur, type Devise } from "../../lib/format";
import { geometrieSoldes, lignesTableauSoldes } from "../../lib/redressement-graphiques";
import { formaterSemaine } from "../../lib/redressement";
import { Tableau } from "../ui/Tableau";
import { Icone } from "../ui/Icone";

/**
 * Soldes de clôture sur 13 semaines en SVG : solde prévu (pointillé), solde retenu (trait plein)
 * et droite du seuil de tension. Les repères en tension portent une forme distincte (carré) en
 * plus de la couleur ; le tableau qui suit porte toutes les valeurs (alternative accessible).
 * Les soldes sont ceux de l'API : le graphique ne fait que les placer.
 */
export function GraphiqueSoldes({
  semaines,
  seuil,
  devise,
}: {
  semaines: RedSemaineTresorerieVue[];
  seuil: number;
  devise: Devise;
}) {
  const g = geometrieSoldes(semaines, seuil);
  const tensions = semaines.filter((s) => s.tension).length;
  return (
    <figure className="mp-red-graphique">
      {g.vide ? (
        <p className="mp-texte-doux">Aucune semaine à tracer.</p>
      ) : (
        <svg
          className="mp-red-graphique__svg"
          viewBox={`0 0 ${g.largeur} ${g.hauteur}`}
          role="img"
          aria-labelledby="graphique-soldes-titre graphique-soldes-desc"
        >
          <title id="graphique-soldes-titre">Soldes de trésorerie sur 13 semaines</title>
          <desc id="graphique-soldes-desc">
            {`${semaines.length} semaines, dont ${tensions} en tension. Ligne continue : solde retenu ; ligne pointillée : solde prévu ; droite en pointillés fins : seuil de tension. Les valeurs sont détaillées dans le tableau qui suit le graphique.`}
          </desc>
          {g.graduations.map((t) => (
            <g key={t.valeur} aria-hidden="true">
              <line
                className="mp-red-graphique__grille"
                x1={g.zone.gauche}
                x2={g.zone.droite}
                y1={t.y}
                y2={t.y}
              />
              <text className="mp-red-graphique__graduation" x={g.zone.gauche - 6} y={t.y + 4}>
                {t.libelle}
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
                <title>{`Semaine ${p.semaine} : tension`}</title>
              </rect>
            ) : (
              <circle
                key={p.semaine}
                className="mp-red-graphique__repere"
                cx={p.x}
                cy={p.yRetenu}
                r={4}
              >
                <title>{`Semaine ${p.semaine}`}</title>
              </circle>
            ),
          )}
        </svg>
      )}
      <figcaption className="mp-red-graphique__legende">
        <span>
          <span className="mp-red-legende" aria-hidden="true" /> Solde retenu
        </span>
        <span>
          <span className="mp-red-legende mp-red-legende--prevu" aria-hidden="true" /> Solde prévu
        </span>
        <span>
          <span className="mp-red-legende mp-red-legende--seuil" aria-hidden="true" /> Seuil de
          tension ({formaterMontantMineur(seuil, devise)})
        </span>
        <span>
          <Icone nom="attention" taille={14} /> Carré : semaine de tension
        </span>
      </figcaption>
      <Tableau
        legende="Soldes de clôture par semaine (équivalent du graphique)"
        colonnes={[
          {
            cle: "semaine",
            entete: "Semaine",
            rendu: (l: ReturnType<typeof lignesTableauSoldes>[number]) =>
              `S${l.semaine} (${formaterSemaine(l.debut, l.fin)})`,
          },
          {
            cle: "prevu",
            entete: "Solde prévu",
            alignement: "droite",
            rendu: (l) => formaterMontantMineur(l.solde_prevu, devise),
          },
          {
            cle: "retenu",
            entete: "Solde retenu",
            alignement: "droite",
            rendu: (l) => formaterMontantMineur(l.solde_retenu, devise),
          },
          { cle: "tension", entete: "Situation", rendu: (l) => (l.tension ? "Tension" : "—") },
        ]}
        lignes={lignesTableauSoldes(semaines)}
        cleLigne={(l) => String(l.semaine)}
      />
    </figure>
  );
}
