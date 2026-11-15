import { obtenirT } from "../../../../../../../lib/i18n/serveur";
import { Squelette } from "../../../../../../../components/ui/Squelette";

export default async function Chargement() {
  const t = await obtenirT();
  return (
    <Squelette
      avecTitre
      lignes={10}
      libelle={t("Chargement de la simulation…", "Loading the simulation…")}
    />
  );
}
