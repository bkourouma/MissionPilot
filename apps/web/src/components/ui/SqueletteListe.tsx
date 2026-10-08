import { Squelette } from "./Squelette";

/** Chargement d'une page de liste : titre, barre de filtres et lignes simulées. */
export function SqueletteListe({ libelle }: { libelle: string }) {
  return (
    <div className="mp-page">
      <Squelette avecTitre lignes={1} libelle={libelle} />
      <div className="mp-squelette-liste" aria-hidden="true">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="mp-squelette__forme mp-squelette-liste__ligne" />
        ))}
      </div>
    </div>
  );
}
