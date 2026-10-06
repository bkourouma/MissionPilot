import type { Metadata } from "next";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { exigerPermission } from "../../../../lib/session";
import { ImportTemps } from "./ImportTemps";

export const metadata: Metadata = { title: "Import des temps" };

export default async function PageImportTemps() {
  await exigerPermission("temps.importer");
  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Import de l'historique des temps"
        soustitre="Reprise des temps d'un ancien outil, depuis un classeur Excel (.xlsx) ou un fichier CSV : une simulation vérifie chaque ligne (collaborateur, mission, tâche, date, période clôturée) avant tout import."
      />
      <Carte titre="Importer l'historique">
        <ImportTemps />
      </Carte>
    </div>
  );
}
