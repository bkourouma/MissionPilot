import Link from "next/link";
import { classesBouton } from "../../../components/ui/Bouton";
import { Icone } from "../../../components/ui/Icone";
import { obtenirT } from "../../../lib/i18n/serveur";
import { CHEMIN_PORTAIL } from "../../../lib/portail-routes";

/** Élément inexistant, ou qui n'est pas (ou plus) partagé avec le client : même réponse. */
export default async function IntrouvableEspaceClient() {
  const t = await obtenirT();
  return (
    <div className="mp-page mp-page--message">
      <Icone nom="dossier" taille={40} className="mp-page__icone" />
      <h1 className="mp-page__titre">{t("Élément introuvable", "Item not found")}</h1>
      <p>
        {t(
          "Cet élément n'existe pas ou n'est plus partagé avec vous. Si vous pensez qu'il devrait être visible, contactez votre interlocuteur au cabinet.",
          "This item does not exist or is no longer shared with you. If you think it should be visible, contact your contact person at the firm.",
        )}
      </p>
      <Link href={CHEMIN_PORTAIL} className={classesBouton("primaire")}>
        {t("Retour à l'accueil", "Back to home")}
      </Link>
    </div>
  );
}
