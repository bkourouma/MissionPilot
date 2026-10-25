import Link from "next/link";
import { classesBouton } from "../../../../../components/ui/Bouton";
import { EtatVide } from "../../../../../components/ui/EtatListe";
import { CHEMIN_PLATEFORME } from "../../../../../lib/plateforme-routes";

export default function CabinetIntrouvable() {
  return (
    <EtatVide
      titre="Cabinet introuvable"
      icone="attention"
      action={
        <Link href={CHEMIN_PLATEFORME} className={classesBouton("secondaire")}>
          Tous les cabinets
        </Link>
      }
    >
      <p>Ce cabinet n&apos;existe pas ou le lien est incorrect.</p>
    </EtatVide>
  );
}
