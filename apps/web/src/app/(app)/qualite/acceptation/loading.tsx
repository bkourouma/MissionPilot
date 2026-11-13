import { Squelette } from "../../../../components/ui/Squelette";
import { obtenirT } from "../../../../lib/i18n/serveur";

export default async function Chargement() {
  const t = await obtenirT();
  return (
    <Squelette
      avecTitre
      lignes={5}
      libelle={t("Chargement de l'acceptation de mission…", "Loading engagement acceptance…")}
    />
  );
}
