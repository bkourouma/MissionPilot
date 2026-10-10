import type { Metadata } from "next";
import "../../../../../components/notation/notation.css";
import "../../../../../components/notation-augmentee/notation-augmentee.css";
import { FormulaireCalibration } from "../../../../../components/notation-augmentee/FormulaireCalibration";
import { Carte } from "../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { exigerLectureNotation } from "../../../../../lib/notation-serveur";

export const metadata: Metadata = { title: "Nouvelle session de calibrage" };

/** Création d'une session de calibrage (NOT-13) : échelle, tolérance et cas figés à la création. */
export default async function PageNouvelleCalibration() {
  await exigerLectureNotation();
  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Nouvelle session de calibrage"
        retour={{ href: "/notation/calibrations", libelle: "Calibration des évaluateurs" }}
        soustitre="Les cas et l'échelle sont figés dès la création. Chaque évaluateur cote seul, à l'aveugle ; un expert métier clôt ensuite la session."
      />
      <Carte titre="Session">
        <FormulaireCalibration />
      </Carte>
    </div>
  );
}
