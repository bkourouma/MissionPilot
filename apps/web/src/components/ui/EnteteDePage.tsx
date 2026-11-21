import Link from "next/link";
import type { ReactNode } from "react";
import { FilAriane } from "./FilAriane";
import type { MaillonFil } from "./FilAriane.aide";
import { Icone } from "./Icone";

export interface EnteteDePageProps {
  titre: ReactNode;
  soustitre?: ReactNode;
  /** Lien de retour vers la page parente (fil d'Ariane réduit). Ignoré si `fil` est fourni. */
  retour?: { href: string; libelle: string };
  /**
   * Fil d'Ariane, du plus général au plus précis ; le dernier maillon est la page courante
   * (sans `href`). Quand `fil` est fourni, il remplace le lien `retour`.
   */
  fil?: readonly MaillonFil[];
  /**
   * Boutons ou liens d'action, à droite sur grand écran. Sur téléphone ils passent sous le
   * titre, s'empilent sur toute la largeur et le bouton principal (`classesBouton("primaire")`)
   * vient en premier, quel que soit son ordre dans le JSX.
   */
  actions?: ReactNode;
  /** Badges affichés sous le titre. */
  badges?: ReactNode;
}

/** En-tête d'écran : fil ou retour, un seul `h1`, badges, sous-titre et actions. */
export function EnteteDePage({
  titre,
  soustitre,
  retour,
  fil,
  actions,
  badges,
}: EnteteDePageProps) {
  const avecFil = fil !== undefined && fil.length > 0;
  return (
    <header className="mp-page__entete mp-entete-page">
      {avecFil ? <FilAriane fil={fil} /> : null}
      {!avecFil && retour ? (
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
