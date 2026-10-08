import { Squelette } from "../../components/ui/Squelette";

export default function Chargement() {
  return (
    <div className="mp-page">
      <Squelette avecTitre lignes={4} libelle="Chargement de la page…" />
    </div>
  );
}
