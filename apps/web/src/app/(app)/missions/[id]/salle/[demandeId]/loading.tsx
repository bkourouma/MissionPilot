import { Squelette } from "../../../../../../components/ui/Squelette";
import { obtenirT } from "../../../../../../lib/i18n/serveur";

export default async function Chargement() {
  const t = await obtenirT();
  return (
    <Squelette
      lignes={8}
      libelle={t("Chargement de la demande de documents…", "Loading the document request…")}
    />
  );
}
