import type { Metadata } from "next";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { exigerPermission } from "../../../../lib/session";
import { FormulaireClient } from "../FormulaireClient";

export const metadata: Metadata = { title: "Nouveau client" };

export default async function PageNouveauClient() {
  await exigerPermission("clients.ecrire");
  return (
    <div className="mp-page mp-page--etroite">
      <EnteteDePage titre="Nouveau client" retour={{ href: "/clients", libelle: "Clients" }} />
      <Carte>
        <FormulaireClient />
      </Carte>
    </div>
  );
}
