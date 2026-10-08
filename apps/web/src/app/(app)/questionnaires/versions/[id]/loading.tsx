import { Squelette } from "../../../../../components/ui/Squelette";

export default function Chargement() {
  return (
    <div className="mp-page">
      <Squelette avecTitre lignes={8} libelle="Chargement de la version du questionnaire…" />
    </div>
  );
}
