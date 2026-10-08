import type { ReactNode } from "react";

export interface ColonneTableau<T> {
  cle: string;
  entete: string;
  /** Contenu de la cellule ; par défaut `String(ligne[cle])`. */
  rendu?: (ligne: T) => ReactNode;
  /** Les montants et quantités s'alignent à droite. */
  alignement?: "gauche" | "droite";
}

export interface TableauProps<T> {
  /** Titre du tableau, annoncé aux lecteurs d'écran (caption). */
  legende: string;
  /** Afficher la légende à l'écran (sinon seulement aux lecteurs d'écran). */
  legendeVisible?: boolean;
  colonnes: readonly ColonneTableau<T>[];
  lignes: readonly T[];
  cleLigne: (ligne: T) => string;
  /** Texte quand `lignes` est vide. */
  messageVide?: string;
}

function valeurParDefaut<T>(ligne: T, cle: string): ReactNode {
  const v = (ligne as Record<string, unknown>)[cle];
  return v == null ? "—" : String(v);
}

/**
 * Tableau de données. Sur grand écran : tableau classique défilant horizontalement si besoin.
 * Sur téléphone (< 640 px) : chaque ligne devient une fiche, chaque cellule précédée de
 * l'intitulé de sa colonne (`data-libelle`).
 */
export function Tableau<T>({
  legende,
  legendeVisible = false,
  colonnes,
  lignes,
  cleLigne,
  messageVide = "Aucun élément à afficher.",
}: TableauProps<T>) {
  if (lignes.length === 0) {
    return (
      <p className="mp-tableau__vide" role="status">
        {messageVide}
      </p>
    );
  }
  return (
    <div className="mp-tableau" role="region" aria-label={legende} tabIndex={0}>
      <table className="mp-tableau__table">
        <caption className={legendeVisible ? "mp-tableau__legende" : "mp-visuellement-cache"}>
          {legende}
        </caption>
        <thead>
          <tr>
            {colonnes.map((c) => (
              <th
                key={c.cle}
                scope="col"
                className={c.alignement === "droite" ? "mp-aligne-droite" : undefined}
              >
                {c.entete}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lignes.map((ligne) => (
            <tr key={cleLigne(ligne)}>
              {colonnes.map((c) => (
                <td
                  key={c.cle}
                  data-libelle={c.entete}
                  className={c.alignement === "droite" ? "mp-aligne-droite" : undefined}
                >
                  {c.rendu ? c.rendu(ligne) : valeurParDefaut(ligne, c.cle)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
