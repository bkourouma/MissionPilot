import Link from "next/link";
import { CHEMIN_CONNEXION_PLATEFORME } from "../../lib/plateforme-routes";
import "./lien-administrateur.css";

/**
 * Lien discret, toujours affiché (démonstration active ou non) vers la connexion de la console de
 * la plateforme. Un lien vers une page de connexion ne divulgue rien.
 */
export function LienAdministrateur() {
  return (
    <p className="mp-connexion__admin">
      <Link href={CHEMIN_CONNEXION_PLATEFORME}>Accès administrateur de la plateforme</Link>
    </p>
  );
}
