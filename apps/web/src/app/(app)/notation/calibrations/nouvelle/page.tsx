import type { Metadata } from "next";
import "../../../../../components/notation/notation.css";
import "../../../../../components/notation-augmentee/notation-augmentee.css";
import { FormulaireCalibration } from "../../../../../components/notation-augmentee/FormulaireCalibration";
import { Carte } from "../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { obtenirT } from "../../../../../lib/i18n/serveur";
import { exigerLectureNotation } from "../../../../../lib/notation-serveur";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Nouvelle session de calibrage", "New calibration session") };
}

/** Création d'une session de calibrage (NOT-13) : échelle, tolérance et cas figés à la création. */
export default async function PageNouvelleCalibration() {
  const t = await obtenirT();
  await exigerLectureNotation();
  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Nouvelle session de calibrage", "New calibration session")}
        retour={{
          href: "/notation/calibrations",
          libelle: t("Calibration des évaluateurs", "Rater calibration"),
        }}
        soustitre={t(
          "Les cas et l'échelle sont figés dès la création. Chaque évaluateur cote seul, à l'aveugle ; un expert métier clôt ensuite la session.",
          "Cases and scale are locked at creation. Each rater rates alone, blind; a business expert then closes the session.",
        )}
      />
      <Carte titre={t("Session", "Session")}>
        <FormulaireCalibration />
      </Carte>
    </div>
  );
}
