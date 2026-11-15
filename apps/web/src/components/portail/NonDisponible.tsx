import Link from "next/link";
import { obtenirT } from "../../lib/i18n/serveur";
import { CHEMIN_PORTAIL } from "../../lib/portail-routes";
import { classesBouton } from "../ui/Bouton";
import { Icone } from "../ui/Icone";

/** Rubrique du portail non ouverte au rôle de l'utilisateur (l'API la refuserait). */
export async function NonDisponible({ titre }: { titre: string }) {
  const t = await obtenirT();
  return (
    <div className="mp-page mp-page--message">
      <Icone nom="cadenas" taille={40} className="mp-page__icone" />
      <h1 className="mp-page__titre">{titre}</h1>
      <p>
        {t(
          "Cette rubrique n'est pas ouverte pour votre accès. Si vous en avez besoin, demandez à votre interlocuteur au cabinet de faire évoluer vos droits.",
          "This section is not open to your access. If you need it, ask your contact person at the firm to update your permissions.",
        )}
      </p>
      <Link href={CHEMIN_PORTAIL} className={classesBouton("primaire")}>
        {t("Retour à l'accueil", "Back to home")}
      </Link>
    </div>
  );
}
