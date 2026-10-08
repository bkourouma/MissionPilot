import Link from "next/link";
import type { ReactNode } from "react";
import { Alerte } from "./Alerte";
import { classesBouton } from "./Bouton";
import { Icone, type NomIcone } from "./Icone";

export interface EtatVideProps {
  titre: string;
  children?: ReactNode;
  icone?: NomIcone;
  action?: ReactNode;
}

/** État vide explicite d'une liste : ce qui manque et quoi faire. */
export function EtatVide({ titre, children, icone = "info", action }: EtatVideProps) {
  return (
    <div className="mp-etat-vide" role="status">
      <Icone nom={icone} taille={32} className="mp-etat-vide__icone" />
      <p className="mp-etat-vide__titre">{titre}</p>
      {children ? <div className="mp-etat-vide__texte">{children}</div> : null}
      {action ? <div>{action}</div> : null}
    </div>
  );
}

export interface EtatErreurProps {
  /** Titre de l'alerte, ex. « La liste des clients n'a pas pu être chargée. » */
  titre: string;
  message: string;
  /** Lien pour recharger la page (mêmes filtres). */
  hrefReessayer: string;
}

/** Erreur de chargement d'une liste, affichée dans la page (la navigation reste utilisable). */
export function EtatErreur({ titre, message, hrefReessayer }: EtatErreurProps) {
  return (
    <div className="mp-etat-erreur">
      <Alerte tonalite="danger" titre={titre} annonce="alert">
        <p>{message}</p>
      </Alerte>
      <Link href={hrefReessayer} className={classesBouton("secondaire")} prefetch={false}>
        Réessayer
      </Link>
    </div>
  );
}

export interface PaginationCurseurProps {
  /** Lien vers la page suivante, `null` s'il n'y en a pas. */
  hrefSuivante: string | null;
  /** Lien vers le début de la liste, `null` si on y est déjà. */
  hrefDebut: string | null;
  libelle?: string;
}

/**
 * Pagination par curseur : « Page suivante » et « Revenir au début ». L'état vit dans l'URL
 * (partage, rechargement après coupure réseau).
 */
export function PaginationCurseur({
  hrefSuivante,
  hrefDebut,
  libelle = "Pagination",
}: PaginationCurseurProps) {
  if (!hrefSuivante && !hrefDebut) return null;
  return (
    <nav className="mp-pagination" aria-label={libelle}>
      <ul className="mp-pagination__liste">
        {hrefDebut ? (
          <li>
            <Link className="mp-pagination__lien" href={hrefDebut}>
              <Icone nom="chevronGauche" taille={18} />
              <span>Revenir au début</span>
            </Link>
          </li>
        ) : null}
        {hrefSuivante ? (
          <li>
            <Link className="mp-pagination__lien" href={hrefSuivante} rel="next">
              <span>Page suivante</span>
              <Icone nom="chevronDroit" taille={18} />
            </Link>
          </li>
        ) : null}
      </ul>
    </nav>
  );
}
