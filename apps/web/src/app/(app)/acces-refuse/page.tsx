import Link from "next/link";
import type { Metadata } from "next";
import { classesBouton } from "../../../components/ui/Bouton";
import { Icone } from "../../../components/ui/Icone";

export const metadata: Metadata = { title: "Accès refusé" };

/** Page 403 : l'utilisateur est connecté mais son rôle ne donne pas accès à la page demandée. */
export default function AccesRefuse() {
  return (
    <div className="mp-page mp-page--message">
      <Icone nom="cadenas" taille={40} className="mp-page__icone" />
      <p className="mp-page__code">Erreur 403</p>
      <h1 className="mp-page__titre">Accès refusé</h1>
      <p>
        Votre rôle ne vous permet pas d&apos;ouvrir cette page. Si vous pensez en avoir besoin,
        demandez à un associé de votre cabinet de modifier vos droits.
      </p>
      <Link href="/" className={classesBouton("primaire")}>
        Retour au tableau de bord
      </Link>
    </div>
  );
}
