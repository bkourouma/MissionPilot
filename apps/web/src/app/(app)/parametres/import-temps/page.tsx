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
        soustitre="Reprise des temps d'un ancien outil : une simulation vérifie chaque ligne (collaborateur, mission, tâche, date, période clôturée) avant tout import."
      />
      <Carte titre="Fichier à importer">
        <ImportTemps />
      </Carte>
    </div>
  );
}
