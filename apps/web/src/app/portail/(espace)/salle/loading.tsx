import { Squelette } from "../../../../components/ui/Squelette";

export default function ChargementSalle() {
  return (
    <div className="mp-page">
      <Squelette avecTitre lignes={4} libelle="Chargement des documents à fournir…" />
    </div>
  );
}
