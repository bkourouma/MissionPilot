import { hrefFiche, hrefGoNoGo, hrefMatrice, hrefRetroplanning } from "../../lib/appels-offres";
import { obtenirT } from "../../lib/i18n/serveur";
import { Onglets } from "../ui/Onglets";

/**
 * Navigation entre les écrans d'une fiche d'appel d'offres (fiche, go/no-go, matrice de
 * conformité, rétro-planning) : l'écran courant reste repérable et chaque étape à un clic.
 */
export async function NavigationFicheAo({ id }: { id: string }) {
  const t = await obtenirT();
  const pages = [
    { id: "fiche", href: hrefFiche(id), libelle: t("Fiche", "Record") },
    { id: "go-no-go", href: hrefGoNoGo(id), libelle: "Go/no-go" },
    {
      id: "matrice",
      href: hrefMatrice(id),
      libelle: t("Matrice de conformité", "Compliance matrix"),
    },
    {
      id: "retroplanning",
      href: hrefRetroplanning(id),
      libelle: t("Rétro-planning", "Backward schedule"),
    },
  ];
  return <Onglets pages={pages} libelle={t("Écrans de l'appel d'offres", "Tender screens")} />;
}
