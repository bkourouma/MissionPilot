import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { aPermission, creerTraduire } from "@missionpilot/shared";
import { Alerte } from "../../../../components/ui/Alerte";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../lib/api-serveur";
import type { PlanComptable as Plan } from "../../../../lib/export-comptable";
import { obtenirLangue, obtenirT } from "../../../../lib/i18n/serveur";
import { aujourdhui, debutDuMois } from "../../../../lib/periode";
import { exigerPermission } from "../../../../lib/session";
import { ExportComptable } from "./ExportComptable";
import { PlanComptable } from "./PlanComptable";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Export comptable", "Accounting export") };
}

export default async function PageExport() {
  const { utilisateur } = await exigerPermission("export.comptable");
  // L'API exige aussi la vue de toutes les missions (écritures de tout le cabinet).
  if (!aPermission(utilisateur.roles, "mission.lire_toutes")) redirect("/acces-refuse");
  const t = creerTraduire(await obtenirLangue());
  const r = await chargerServeur<Plan>("/api/finance/plan-comptable");
  const jour = aujourdhui();
  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Export comptable", "Accounting export")}
        soustitre={t(
          "Écritures SYSCOHADA des factures, avoirs et encaissements d'une période, au format CSV, pour le logiciel comptable du cabinet.",
          "SYSCOHADA entries for the invoices, credit notes and payments of a period, in CSV format, for the firm's accounting software.",
        )}
      />
      <Alerte
        tonalite="attention"
        annonce="aucune"
        titre={t("Données sensibles", "Sensitive data")}
      >
        <p>
          {t(
            "Le fichier contient les montants facturés et encaissés et le nom des clients. Enregistrez-le dans un espace protégé, ne le transmettez qu'à votre comptable et supprimez les copies inutiles. Chaque export est inscrit au journal d'audit.",
            "The file contains the amounts invoiced and received and the clients' names. Save it in a protected location, share it only with your accountant and delete unneeded copies. Every export is recorded in the audit log.",
          )}
        </p>
      </Alerte>
      <Carte titre={t("Exporter les écritures", "Export the entries")}>
        <ExportComptable duDefaut={debutDuMois(jour)} auDefaut={jour} />
      </Carte>
      {r.ok ? (
        <PlanComptable plan={r.donnees} />
      ) : (
        <EtatErreur
          titre={t(
            "Le plan comptable n'a pas pu être chargé.",
            "The chart of accounts could not be loaded.",
          )}
          message={r.message}
          hrefReessayer="/finance/export"
        />
      )}
    </div>
  );
}
