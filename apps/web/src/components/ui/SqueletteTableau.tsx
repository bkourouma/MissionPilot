import type { CSSProperties } from "react";
import { T } from "../i18n/T";

export interface SqueletteTableauProps {
  /** Nombre de colonnes simulées (défaut 4). */
  colonnes?: number;
  /** Nombre de lignes simulées (défaut 5). */
  lignes?: number;
  /** Afficher une rangée d'en-tête simulée (défaut oui). */
  avecEntete?: boolean;
  /** Message annoncé une seule fois aux lecteurs d'écran. */
  libelle?: string;
}

/**
 * Espace réservé d'un tableau pendant son chargement. Seul `libelle` est annoncé
 * (`role="status"`) ; les formes sont masquées aux technologies d'assistance et figées sous
 * `prefers-reduced-motion`. Sur téléphone, seules les deux premières colonnes restent (fiches).
 *
 * `<SqueletteTableau colonnes={5} lignes={8} libelle="Chargement des missions…" />`
 */
export function SqueletteTableau({
  colonnes = 4,
  lignes = 5,
  avecEntete = true,
  libelle,
}: SqueletteTableauProps) {
  const nbColonnes = Math.max(1, Math.floor(colonnes));
  const nbLignes = Math.max(1, Math.floor(lignes));
  const style = { "--mp-squelette-colonnes": nbColonnes } as CSSProperties;
  return (
    <div className="mp-squelette-tableau" role="status" style={style}>
      <span className="mp-visuellement-cache">
        {libelle ?? <T fr="Chargement du tableau…" en="Loading the table…" />}
      </span>
      <div aria-hidden="true">
        {avecEntete ? (
          <div className="mp-squelette-tableau__rangee mp-squelette-tableau__rangee--entete">
            {Array.from({ length: nbColonnes }, (_, c) => (
              <span key={c} className="mp-squelette__forme mp-squelette-tableau__cellule" />
            ))}
          </div>
        ) : null}
        {Array.from({ length: nbLignes }, (_, i) => (
          <div key={i} className="mp-squelette-tableau__rangee">
            {Array.from({ length: nbColonnes }, (_, c) => (
              <span
                key={c}
                className="mp-squelette__forme mp-squelette-tableau__cellule"
                style={{ width: c === 0 ? "85%" : c === nbColonnes - 1 ? "55%" : "70%" }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
