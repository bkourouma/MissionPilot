import { obtenirT } from "../../../../../../../lib/i18n/serveur";
import { Squelette } from "../../../../../../../components/ui/Squelette";

export default async function Chargement() {
  const t = await obtenirT();
  return (
    <Squelette
      avecTitre
      lignes={8}
      libelle={t("Chargement de la feuille de route…", "Loading the roadmap…")}
    />
  );
}
