import type { Metadata } from "next";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { obtenirT } from "../../../../lib/i18n/serveur";
import { exigerPermission } from "../../../../lib/session";
import { FormulaireClient } from "../FormulaireClient";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Nouveau client", "New client") };
}

export default async function PageNouveauClient() {
  await exigerPermission("clients.ecrire");
  const t = await obtenirT();
  return (
    <div className="mp-page mp-page--etroite">
      <EnteteDePage
        titre={t("Nouveau client", "New client")}
        retour={{ href: "/clients", libelle: t("Clients", "Clients") }}
      />
      <Carte>
        <FormulaireClient />
      </Carte>
    </div>
  );
}
