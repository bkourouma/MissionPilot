import { Squelette } from "../../../../../../../components/ui/Squelette";
import { obtenirT } from "../../../../../../../lib/i18n/serveur";

export default async function Chargement() {
  const t = await obtenirT();
  return (
    <Squelette
      avecTitre
      lignes={10}
      libelle={t("Chargement du plan vivant…", "Loading the living plan…")}
    />
  );
}
