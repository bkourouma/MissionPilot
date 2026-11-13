import { SqueletteListe } from "../../../../components/ui/SqueletteListe";
import { obtenirT } from "../../../../lib/i18n/serveur";

export default async function Chargement() {
  const t = await obtenirT();
  return <SqueletteListe libelle={t("Chargement du dossier…", "Loading the file…")} />;
}
