import Link from "next/link";
import type { Metadata } from "next";
import { classesBouton } from "../../../components/ui/Bouton";
import { Icone } from "../../../components/ui/Icone";
import { obtenirT } from "../../../lib/i18n/serveur";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Accès refusé", "Access denied") };
}

/** Page 403 : l'utilisateur est connecté mais son rôle ne donne pas accès à la page demandée. */
export default async function AccesRefuse() {
  const t = await obtenirT();
  return (
    <div className="mp-page mp-page--message">
      <Icone nom="cadenas" taille={40} className="mp-page__icone" />
      <p className="mp-page__code">{t("Erreur 403", "Error 403")}</p>
      <h1 className="mp-page__titre">{t("Accès refusé", "Access denied")}</h1>
      <p>
        {t(
          "Votre rôle ne vous permet pas d'ouvrir cette page. Si vous pensez en avoir besoin, demandez à un associé de votre cabinet de modifier vos droits.",
          "Your role does not allow you to open this page. If you think you need it, ask a partner at your firm to change your permissions.",
        )}
      </p>
      <Link href="/" className={classesBouton("primaire")}>
        {t("Retour au tableau de bord", "Back to the dashboard")}
      </Link>
    </div>
  );
}
