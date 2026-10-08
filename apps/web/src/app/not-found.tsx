import Link from "next/link";
import type { Metadata } from "next";
import { classesBouton } from "../components/ui/Bouton";

export const metadata: Metadata = { title: "Page introuvable" };

export default function PageIntrouvable() {
  return (
    <main className="mp-page mp-page--message mp-page--isolee">
      <p className="mp-page__code">Erreur 404</p>
      <h1 className="mp-page__titre">Page introuvable</h1>
      <p>
        L&apos;adresse saisie ne correspond à aucune page. Vérifiez-la, ou repartez du tableau de
        bord.
      </p>
      <Link href="/" className={classesBouton("primaire")}>
        Retour au tableau de bord
      </Link>
    </main>
  );
}
