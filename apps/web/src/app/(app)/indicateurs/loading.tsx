import { Squelette } from "../../../components/ui/Squelette";

export default function Chargement() {
  return (
    <div className="mp-page">
      <Squelette avecTitre lignes={1} libelle="Calcul des indicateurs…" />
      <div className="mp-grille-indicateurs" aria-hidden="true">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="mp-squelette__forme mp-indicateur--squelette" />
        ))}
      </div>
    </div>
  );
}
