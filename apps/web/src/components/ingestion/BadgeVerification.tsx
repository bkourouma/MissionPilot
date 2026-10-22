import { BadgeStatut } from "../ui/BadgeStatut";
import { libelleVerification } from "../../lib/ingestion-extractions";

/**
 * « Vérifié dans la page » ou « NON retrouvé dans la page » : le serveur a cherché l'extrait et les
 * nombres cités dans le texte de la page. Texte et icône portent le sens, jamais la couleur seule.
 */
export function BadgeVerification({ verifie }: { verifie: boolean }) {
  return (
    <BadgeStatut tonalite={verifie ? "succes" : "danger"}>
      {libelleVerification(verifie)}
    </BadgeStatut>
  );
}
