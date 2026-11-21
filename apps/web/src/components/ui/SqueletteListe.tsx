import { Squelette } from "./Squelette";

/**
 * Chargement d'une page de liste : titre, barre de filtres et lignes simulées. `lignes`
 * (défaut 6) règle le nombre de lignes. Annonce `libelle` une seule fois.
 */
export function SqueletteListe({ libelle, lignes = 6 }: { libelle: string; lignes?: number }) {
  return (
    <div className="mp-page">
      <Squelette avecTitre lignes={1} libelle={libelle} />
      <div className="mp-squelette-liste" aria-hidden="true">
        {Array.from({ length: Math.max(1, Math.floor(lignes)) }, (_, i) => (
          <div key={i} className="mp-squelette__forme mp-squelette-liste__ligne" />
        ))}
      </div>
    </div>
  );
}
