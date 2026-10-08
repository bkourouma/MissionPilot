import Link from "next/link";
import { classesBouton } from "../../../components/ui/Bouton";
import { Icone } from "../../../components/ui/Icone";
import { CHEMIN_PORTAIL } from "../../../lib/portail-routes";

/** Élément inexistant, ou qui n'est pas (ou plus) partagé avec le client : même réponse. */
export default function IntrouvableEspaceClient() {
  return (
    <div className="mp-page mp-page--message">
      <Icone nom="dossier" taille={40} className="mp-page__icone" />
      <h1 className="mp-page__titre">Élément introuvable</h1>
      <p>
        Cet élément n&apos;existe pas ou n&apos;est plus partagé avec vous. Si vous pensez
        qu&apos;il devrait être visible, contactez votre interlocuteur au cabinet.
      </p>
      <Link href={CHEMIN_PORTAIL} className={classesBouton("primaire")}>
        Retour à l&apos;accueil
      </Link>
    </div>
  );
}
