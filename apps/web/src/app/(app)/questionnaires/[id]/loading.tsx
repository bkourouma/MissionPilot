import { Squelette } from "../../../../components/ui/Squelette";

export default function Chargement() {
  return (
    <div className="mp-page">
      <Squelette avecTitre lignes={6} libelle="Chargement du modèle de questionnaire…" />
    </div>
  );
}
