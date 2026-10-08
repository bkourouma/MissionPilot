import Link from "next/link";
import { CHEMIN_PORTAIL } from "../../lib/portail-routes";
import { classesBouton } from "../ui/Bouton";
import { Icone } from "../ui/Icone";

/** Rubrique du portail non ouverte au rôle de l'utilisateur (l'API la refuserait). */
export function NonDisponible({ titre }: { titre: string }) {
  return (
    <div className="mp-page mp-page--message">
      <Icone nom="cadenas" taille={40} className="mp-page__icone" />
      <h1 className="mp-page__titre">{titre}</h1>
      <p>
        Cette rubrique n&apos;est pas ouverte pour votre accès. Si vous en avez besoin, demandez à
        votre interlocuteur au cabinet de faire évoluer vos droits.
      </p>
      <Link href={CHEMIN_PORTAIL} className={classesBouton("primaire")}>
        Retour à l&apos;accueil
      </Link>
    </div>
  );
}
