import { SqueletteListe } from "../../../components/ui/SqueletteListe";
import { obtenirT } from "../../../lib/i18n/serveur";

export default async function Chargement() {
  const t = await obtenirT();
  return <SqueletteListe libelle={t("Chargement des factures…", "Loading invoices…")} />;
}
