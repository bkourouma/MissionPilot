import Link from "next/link";
import { useId } from "react";
import { T } from "../i18n/T";
import { pagesAffichees } from "../../lib/pagination";
import { Icone } from "./Icone";
import { libellePlage, plageAffichee } from "./Pagination.plage";

export interface PaginationProps {
  page: number;
  totalPages: number;
  /**
   * URL d'une page, ex. `(p) => "/missions?page=" + p`. Pagination par liens : l'état vit
   * dans l'URL (partage, retour arrière, rechargement après coupure).
   */
  hrefPage: (page: number) => string;
  /** Nom de la zone de navigation pour les lecteurs d'écran. */
  libelle?: string;
  /** Nombre total d'éléments ; avec `taillePage`, affiche « 21–40 sur 134 ». */
  total?: number;
  /** Éléments par page (nécessaire au calcul de la plage affichée). */
  taillePage?: number;
}

/** À utiliser depuis un Server Component (`hrefPage` est une fonction). */
export function Pagination({
  page,
  totalPages,
  hrefPage,
  libelle,
  total,
  taillePage,
}: PaginationProps) {
  const idLibelle = useId();
  if (totalPages <= 1) return null;
  const courante = Math.min(Math.max(1, page), totalPages);
  const elements = pagesAffichees(courante, totalPages);
  const plage = plageAffichee(courante, taillePage, total);
  return (
    <nav
      className="mp-pagination"
      aria-label={libelle}
      aria-labelledby={libelle ? undefined : idLibelle}
    >
      {libelle ? null : (
        <span id={idLibelle} className="mp-visuellement-cache">
          <T fr="Pagination" en="Pagination" />
        </span>
      )}
      <p className="mp-pagination__resume">
        {plage ? (
          <span className="mp-pagination__plage">
            <T fr={libellePlage(plage, "fr")} en={libellePlage(plage, "en")} />
          </span>
        ) : null}
        <span>
          <T fr={`Page ${courante} sur ${totalPages}`} en={`Page ${courante} of ${totalPages}`} />
        </span>
      </p>
      <ul className="mp-pagination__liste">
        <li>
          {courante > 1 ? (
            <Link className="mp-pagination__lien" href={hrefPage(courante - 1)} rel="prev">
              <Icone nom="chevronGauche" taille={18} />
              <span>
                <T fr="Précédente" en="Previous" />
              </span>
            </Link>
          ) : (
            <span className="mp-pagination__lien" aria-disabled="true">
              <Icone nom="chevronGauche" taille={18} />
              <span>
                <T fr="Précédente" en="Previous" />
              </span>
            </span>
          )}
        </li>
        {elements.map((el, i) =>
          el === "ellipse" ? (
            <li key={`e${i}`} className="mp-pagination__ellipse" aria-hidden="true">
              …
            </li>
          ) : (
            <li key={el} className="mp-pagination__numero">
              <Link
                className="mp-pagination__lien"
                href={hrefPage(el)}
                aria-current={el === courante ? "page" : undefined}
              >
                <span className="mp-visuellement-cache">
                  <T fr="Page " en="Page " />
                </span>
                {el}
              </Link>
            </li>
          ),
        )}
        <li>
          {courante < totalPages ? (
            <Link className="mp-pagination__lien" href={hrefPage(courante + 1)} rel="next">
              <span>
                <T fr="Suivante" en="Next" />
              </span>
              <Icone nom="chevronDroit" taille={18} />
            </Link>
          ) : (
            <span className="mp-pagination__lien" aria-disabled="true">
              <span>
                <T fr="Suivante" en="Next" />
              </span>
              <Icone nom="chevronDroit" taille={18} />
            </span>
          )}
        </li>
      </ul>
    </nav>
  );
}
