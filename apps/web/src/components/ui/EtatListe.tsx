import Link from "next/link";
import { useId } from "react";
import { T } from "../i18n/T";
import type { ReactNode } from "react";
import { Alerte } from "./Alerte";
import { classesBouton } from "./Bouton";
import { Icone, type NomIcone } from "./Icone";
import { classes } from "./Tableau.tri";

export interface EtatVideProps {
  titre: string;
  children?: ReactNode;
  /** Icône ; par défaut `info`, ou `recherche` pour la variante « filtres ». */
  icone?: NomIcone;
  /** Action principale (ex. « Créer un client »). */
  action?: ReactNode;
  /** Action secondaire, plus discrète (ex. « Importer »). */
  actionSecondaire?: ReactNode;
  /** Version réduite (moins de marge), pour un vide dans une carte ou un onglet. */
  compact?: boolean;
  /** Niveau de titre (2 à 6) ; sans valeur, le titre est un paragraphe en gras. */
  titreNiveau?: 2 | 3 | 4 | 5 | 6;
  /**
   * `filtres` : « aucun résultat pour ces filtres » (la liste a des éléments, mais aucun ne
   * correspond). Déduite quand `hrefReinitialiser` est fourni.
   */
  variante?: "defaut" | "filtres";
  /** Lien vers la même liste sans filtre ; affiche « Réinitialiser les filtres ». */
  hrefReinitialiser?: string;
}

/** État vide explicite d'une liste : ce qui manque et quoi faire. */
export function EtatVide({
  titre,
  children,
  icone,
  action,
  actionSecondaire,
  compact = false,
  titreNiveau,
  variante,
  hrefReinitialiser,
}: EtatVideProps) {
  const filtres = (variante ?? (hrefReinitialiser ? "filtres" : "defaut")) === "filtres";
  const Titre = titreNiveau ? (`h${titreNiveau}` as const) : "p";
  const avecActions = Boolean(action || actionSecondaire || hrefReinitialiser);
  return (
    <div className={classes("mp-etat-vide", compact && "mp-etat-vide--compact")} role="status">
      <Icone
        nom={icone ?? (filtres ? "recherche" : "info")}
        taille={compact ? 24 : 32}
        className="mp-etat-vide__icone"
      />
      <Titre className="mp-etat-vide__titre">{titre}</Titre>
      {children ? <div className="mp-etat-vide__texte">{children}</div> : null}
      {avecActions ? (
        <div className="mp-etat-vide__actions">
          {action}
          {hrefReinitialiser ? (
            <Link
              href={hrefReinitialiser}
              className={classesBouton(action ? "discret" : "secondaire")}
              prefetch={false}
            >
              <T fr="Réinitialiser les filtres" en="Reset filters" />
            </Link>
          ) : null}
          {actionSecondaire}
        </div>
      ) : null}
    </div>
  );
}

export interface EtatErreurProps {
  /** Titre de l'alerte, ex. « La liste des clients n'a pas pu être chargée. » */
  titre: string;
  message: string;
  /** Lien pour recharger la page (mêmes filtres). */
  hrefReessayer: string;
  /** Autre action possible (ex. lien « Contacter le support » ou « Retour au tableau de bord »). */
  action?: ReactNode;
}

/** Erreur de chargement d'une liste, affichée dans la page (la navigation reste utilisable). */
export function EtatErreur({ titre, message, hrefReessayer, action }: EtatErreurProps) {
  return (
    <div className="mp-etat-erreur">
      <Alerte tonalite="danger" titre={titre} annonce="alert">
        <p>{message}</p>
      </Alerte>
      <div className="mp-etat-erreur__actions">
        <Link href={hrefReessayer} className={classesBouton("secondaire")} prefetch={false}>
          <T fr="Réessayer" en="Try again" />
        </Link>
        {action}
      </div>
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
 * (partage, rechargement après coupure réseau). Cibles de 44 px ; sur téléphone les deux liens
 * se partagent la largeur.
 */
export function PaginationCurseur({ hrefSuivante, hrefDebut, libelle }: PaginationCurseurProps) {
  const idLibelle = useId();
  if (!hrefSuivante && !hrefDebut) return null;
  return (
    <nav
      className="mp-pagination mp-pagination--curseur"
      aria-label={libelle}
      aria-labelledby={libelle ? undefined : idLibelle}
    >
      {libelle ? null : (
        <span id={idLibelle} className="mp-visuellement-cache">
          <T fr="Pagination" en="Pagination" />
        </span>
      )}
      <ul className="mp-pagination__liste">
        {hrefDebut ? (
          <li>
            <Link className="mp-pagination__lien" href={hrefDebut}>
              <Icone nom="chevronGauche" taille={18} />
              <span>
                <T fr="Revenir au début" en="Back to start" />
              </span>
            </Link>
          </li>
        ) : null}
        {hrefSuivante ? (
          <li>
            <Link className="mp-pagination__lien" href={hrefSuivante} rel="next">
              <span>
                <T fr="Page suivante" en="Next page" />
              </span>
              <Icone nom="chevronDroit" taille={18} />
            </Link>
          </li>
        ) : null}
      </ul>
    </nav>
  );
}
