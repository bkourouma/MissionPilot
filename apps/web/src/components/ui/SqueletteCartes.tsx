import { T } from "../i18n/T";

export interface SqueletteCartesProps {
  /** Nombre de cartes simulées (défaut 6). */
  nombre?: number;
  /** Message annoncé une seule fois aux lecteurs d'écran. */
  libelle?: string;
}

/**
 * Espace réservé d'une grille de cartes pendant son chargement (même grille fluide que les
 * listes de cartes : 16 rem minimum par carte). Annonce `libelle` une seule fois.
 *
 * `<SqueletteCartes nombre={6} libelle="Chargement des clients…" />`
 */
export function SqueletteCartes({ nombre = 6, libelle }: SqueletteCartesProps) {
  const n = Math.max(1, Math.floor(nombre));
  return (
    <div className="mp-squelette-cartes" role="status">
      <span className="mp-visuellement-cache">
        {libelle ?? <T fr="Chargement…" en="Loading…" />}
      </span>
      <div className="mp-squelette-cartes__grille" aria-hidden="true">
        {Array.from({ length: n }, (_, i) => (
          <div key={i} className="mp-squelette-cartes__carte">
            <span className="mp-squelette__forme mp-squelette-cartes__titre" />
            <span className="mp-squelette__forme mp-squelette-cartes__ligne" />
            <span
              className="mp-squelette__forme mp-squelette-cartes__ligne"
              style={{ width: "60%" }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
