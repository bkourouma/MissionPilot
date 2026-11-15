import Link from "next/link";
import type { Metadata } from "next";
import { classesBouton } from "../components/ui/Bouton";
import { Icone } from "../components/ui/Icone";
import { obtenirT } from "../lib/i18n/serveur";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Page introuvable", "Page not found") };
}

export default async function PageIntrouvable() {
  const t = await obtenirT();
  return (
    <main className="mp-page mp-page--message mp-page--isolee">
      <Icone nom="recherche" taille={40} className="mp-page__icone" />
      <p className="mp-page__code">{t("Erreur 404", "Error 404")}</p>
      <h1 className="mp-page__titre">{t("Page introuvable", "Page not found")}</h1>
      <p>
        {t(
          "L'adresse saisie ne correspond à aucune page. Vérifiez-la, ou repartez du tableau de bord.",
          "The address you entered does not match any page. Check it, or start again from the dashboard.",
        )}
      </p>
      <Link href="/" className={classesBouton("primaire")}>
        {t("Retour au tableau de bord", "Back to the dashboard")}
      </Link>
    </main>
  );
}
