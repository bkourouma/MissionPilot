import { obtenirT } from "../../../../../../../lib/i18n/serveur";
import { Squelette } from "../../../../../../../components/ui/Squelette";

export default async function Chargement() {
  const t = await obtenirT();
  return (
    <Squelette
      avecTitre
      lignes={6}
      libelle={t("Chargement des KPI du plan…", "Loading the plan KPIs…")}
    />
  );
}
