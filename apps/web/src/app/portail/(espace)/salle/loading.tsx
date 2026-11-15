import { Squelette } from "../../../../components/ui/Squelette";
import { obtenirT } from "../../../../lib/i18n/serveur";

export default async function ChargementSalle() {
  const t = await obtenirT();
  return (
    <div className="mp-page">
      <Squelette
        avecTitre
        lignes={4}
        libelle={t("Chargement des documents à fournir…", "Loading the documents to provide…")}
      />
    </div>
  );
}
