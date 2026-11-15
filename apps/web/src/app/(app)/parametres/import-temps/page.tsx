import type { Metadata } from "next";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { obtenirT } from "../../../../lib/i18n/serveur";
import { exigerPermission } from "../../../../lib/session";
import { ImportTemps } from "./ImportTemps";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Import des temps", "Time import") };
}

export default async function PageImportTemps() {
  await exigerPermission("temps.importer");
  const t = await obtenirT();
  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Import de l'historique des temps", "Time history import")}
        soustitre={t(
          "Reprise des temps d'un ancien outil, depuis un classeur Excel (.xlsx) ou un fichier CSV : une simulation vérifie chaque ligne (collaborateur, mission, tâche, date, période clôturée) avant tout import.",
          "Carry over time from a previous tool, from an Excel workbook (.xlsx) or a CSV file: a simulation checks every row (employee, engagement, task, date, closed period) before any import.",
        )}
      />
      <Carte titre={t("Importer l'historique", "Import the history")}>
        <ImportTemps />
      </Carte>
    </div>
  );
}
