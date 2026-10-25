import { formaterJours } from "../../lib/format";

export interface TrajectoireProps {
  /** Jours budgétés (le cap prévu). */
  budget: number;
  /** Jours réalisés à ce jour (le chemin parcouru). */
  realises: number;
  /** Atterrissage estimé en jours, servi par le moteur. */
  atterrissage: number;
  /** Largeur du dessin en unités de la boîte (168 en cellule de tableau, plus en grand). */
  largeur?: number;
  hauteur?: number;
}

const MARGE = 6;

/**
 * Trajectoire d'une mission, langage unique du budget : le cap prévu en tirets violets jusqu'au
 * budget, le chemin réel en or avec sa pointe de flèche, puis l'atterrissage estimé en pointillé
 * (rouge s'il dépasse le budget). Aucun axe de temps n'est inventé : seule la longueur compte,
 * en jours. Le texte alternatif porte les trois valeurs.
 */
export function Trajectoire({
  budget,
  realises,
  atterrissage,
  largeur = 168,
  hauteur = 24,
}: TrajectoireProps) {
  const portee = Math.max(budget, realises, atterrissage, 1);
  const x = (jours: number) => MARGE + (jours / portee) * (largeur - 2 * MARGE - 6);
  const y = hauteur / 2;
  const xr = x(realises);
  const depasse = atterrissage > budget;
  const libelle = `${formaterJours(realises)} réalisés sur ${formaterJours(budget)} budgétés, atterrissage estimé à ${formaterJours(atterrissage)}`;
  return (
    <svg
      className="mp-trajectoire"
      viewBox={`0 0 ${largeur} ${hauteur}`}
      width={largeur}
      height={hauteur}
      role="img"
      aria-label={libelle}
    >
      <line
        className="mp-trajectoire__prevu"
        x1={MARGE}
        y1={y}
        x2={x(budget)}
        y2={y}
        strokeDasharray="4 4"
      />
      <line
        className="mp-trajectoire__repere"
        x1={x(budget)}
        y1={y - 6}
        x2={x(budget)}
        y2={y + 6}
      />
      {atterrissage > realises ? (
        <line
          className={
            depasse
              ? "mp-trajectoire__estimation mp-trajectoire__estimation--depasse"
              : "mp-trajectoire__estimation"
          }
          x1={xr}
          y1={y}
          x2={x(atterrissage)}
          y2={y}
          strokeDasharray="1.5 3.5"
        />
      ) : null}
      {realises > 0 ? (
        <>
          <line className="mp-trajectoire__reel" x1={MARGE} y1={y} x2={xr} y2={y} />
          <path
            className="mp-trajectoire__pointe"
            d={`M${xr + 6} ${y} L${xr - 1} ${y - 4.5} L${xr - 1} ${y + 4.5}Z`}
          />
        </>
      ) : null}
      <circle className="mp-trajectoire__depart" cx={MARGE} cy={y} r={2.5} />
    </svg>
  );
}
