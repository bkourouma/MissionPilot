import type { RedClotureRapportVue } from "@missionpilot/shared";
import { formaterDateHeure } from "../../lib/format";
import { obtenirLangue, obtenirT } from "../../lib/i18n/serveur";
import { FORMAT_RAPPORT_CLOTURE_LIBELLES } from "../../lib/redressement-cloture";
import { FichierJoint } from "../fichiers/FichierJoint";

/** Rapports déjà générés pour ce bilan (le plus récent d'abord), avec lien de téléchargement. */
export async function ClotureRapportsListe({
  rapports,
}: {
  rapports: readonly RedClotureRapportVue[];
}) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  if (rapports.length === 0) {
    return (
      <p className="mp-texte-doux">
        {t("Aucun rapport généré pour ce bilan.", "No report generated for this review.")}
      </p>
    );
  }
  return (
    <ul
      className="mp-liste-lignes"
      aria-label={t("Rapports de clôture générés", "Generated close-out reports")}
    >
      {rapports.map((r) => {
        const date = formaterDateHeure(r.genere_le, undefined, langue);
        const format = FORMAT_RAPPORT_CLOTURE_LIBELLES[r.format] ?? r.format;
        return (
          <li key={r.id} className="mp-liste-lignes__ligne mp-rapport">
            <div className="mp-rapport__texte">
              <p className="mp-rapport__titre">
                {t(
                  `Rapport de clôture (${format}) du ${date}, bilan version ${r.version_source}`,
                  `Close-out report (${format}) of ${date}, review version ${r.version_source}`,
                )}
              </p>
              <FichierJoint fichier={r.fichier} contexte={`(${date}, ${format})`} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
