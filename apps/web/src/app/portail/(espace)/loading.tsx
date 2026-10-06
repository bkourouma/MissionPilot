import { Squelette } from "../../../components/ui/Squelette";

export default function ChargementPortail() {
  return (
    <div className="mp-page">
      <Squelette avecTitre lignes={4} libelle="Chargement de la page…" />
    </div>
  );
}
