import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { aPermission } from "@missionpilot/shared";
import { Alerte } from "../../../../components/ui/Alerte";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../lib/api-serveur";
import type { PlanComptable as Plan } from "../../../../lib/export-comptable";
import { aujourdhui, debutDuMois } from "../../../../lib/periode";
import { exigerPermission } from "../../../../lib/session";
import { ExportComptable } from "./ExportComptable";
import { PlanComptable } from "./PlanComptable";

export const metadata: Metadata = { title: "Export comptable" };

export default async function PageExport() {
  const { utilisateur } = await exigerPermission("export.comptable");
  // L'API exige aussi la vue de toutes les missions (écritures de tout le cabinet).
  if (!aPermission(utilisateur.roles, "mission.lire_toutes")) redirect("/acces-refuse");
  const r = await chargerServeur<Plan>("/api/finance/plan-comptable");
  const jour = aujourdhui();
  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Export comptable"
        soustitre="Écritures SYSCOHADA des factures, avoirs et encaissements d'une période, au format CSV, pour le logiciel comptable du cabinet."
      />
      <Alerte tonalite="attention" annonce="aucune" titre="Données sensibles">
        <p>
          Le fichier contient les montants facturés et encaissés et le nom des clients.
          Enregistrez-le dans un espace protégé, ne le transmettez qu&apos;à votre comptable et
          supprimez les copies inutiles. Chaque export est inscrit au journal d&apos;audit.
        </p>
      </Alerte>
      <Carte titre="Exporter les écritures">
        <ExportComptable duDefaut={debutDuMois(jour)} auDefaut={jour} />
      </Carte>
      {r.ok ? (
        <PlanComptable plan={r.donnees} />
      ) : (
        <EtatErreur
          titre="Le plan comptable n'a pas pu être chargé."
          message={r.message}
          hrefReessayer="/finance/export"
        />
      )}
    </div>
  );
}
