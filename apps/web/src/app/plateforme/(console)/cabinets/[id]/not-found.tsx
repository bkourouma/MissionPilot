import Link from "next/link";
import { classesBouton } from "../../../../../components/ui/Bouton";
import { EtatVide } from "../../../../../components/ui/EtatListe";
import { obtenirT } from "../../../../../lib/i18n/serveur";
import { CHEMIN_PLATEFORME } from "../../../../../lib/plateforme-routes";

export default async function CabinetIntrouvable() {
  const t = await obtenirT();
  return (
    <EtatVide
      titre={t("Cabinet introuvable", "Firm not found")}
      icone="attention"
      action={
        <Link href={CHEMIN_PLATEFORME} className={classesBouton("secondaire")}>
          {t("Tous les cabinets", "All firms")}
        </Link>
      }
    >
      <p>
        {t(
          "Ce cabinet n'existe pas ou le lien est incorrect.",
          "This firm does not exist or the link is incorrect.",
        )}
      </p>
    </EtatVide>
  );
}
