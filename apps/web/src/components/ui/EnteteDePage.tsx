import Link from "next/link";
import type { ReactNode } from "react";
import { Icone } from "./Icone";

export interface EnteteDePageProps {
  titre: ReactNode;
  soustitre?: ReactNode;
  /** Lien de retour vers la page parente (fil d'Ariane réduit). */
  retour?: { href: string; libelle: string };
  /** Boutons ou liens d'action, à droite sur grand écran. */
  actions?: ReactNode;
  /** Badges affichés sous le titre. */
  badges?: ReactNode;
}

export function EnteteDePage({ titre, soustitre, retour, actions, badges }: EnteteDePageProps) {
  return (
    <header className="mp-page__entete mp-entete-page">
      {retour ? (
        <Link href={retour.href} className="mp-lien-retour">
          <Icone nom="chevronGauche" taille={18} />
          <span>{retour.libelle}</span>
        </Link>
      ) : null}
      <div className="mp-entete-page__ligne">
        <div className="mp-entete-page__textes">
          <h1 className="mp-page__titre">{titre}</h1>
          {badges ? <div className="mp-entete-page__badges">{badges}</div> : null}
          {soustitre ? <p className="mp-page__soustitre">{soustitre}</p> : null}
        </div>
        {actions ? <div className="mp-entete-page__actions">{actions}</div> : null}
      </div>
    </header>
  );
}
