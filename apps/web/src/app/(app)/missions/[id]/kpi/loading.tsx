import { Squelette } from "../../../../../components/ui/Squelette";
import { obtenirT } from "../../../../../lib/i18n/serveur";

export default async function Chargement() {
  const t = await obtenirT();
  return (
    <Squelette
      avecTitre
      lignes={8}
      libelle={t("Calcul du tableau de bord des KPI…", "Computing the KPI dashboard…")}
    />
  );
}
