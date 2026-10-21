import type { RedClotureRapportVue } from "@missionpilot/shared";
import { formaterDateHeure } from "../../lib/format";
import { FORMAT_RAPPORT_CLOTURE_LIBELLES } from "../../lib/redressement-cloture";
import { FichierJoint } from "../fichiers/FichierJoint";

/** Rapports déjà générés pour ce bilan (le plus récent d'abord), avec lien de téléchargement. */
export function ClotureRapportsListe({ rapports }: { rapports: readonly RedClotureRapportVue[] }) {
  if (rapports.length === 0) {
    return <p className="mp-texte-doux">Aucun rapport généré pour ce bilan.</p>;
  }
  return (
    <ul className="mp-liste-lignes" aria-label="Rapports de clôture générés">
      {rapports.map((r) => {
        const date = formaterDateHeure(r.genere_le);
        const format = FORMAT_RAPPORT_CLOTURE_LIBELLES[r.format] ?? r.format;
        return (
          <li key={r.id} className="mp-liste-lignes__ligne mp-rapport">
            <div className="mp-rapport__texte">
              <p className="mp-rapport__titre">{`Rapport de clôture (${format}) du ${date}, bilan version ${r.version_source}`}</p>
              <FichierJoint fichier={r.fichier} contexte={`(${date}, ${format})`} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
