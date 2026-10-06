import Link from "next/link";
import { pagesAffichees } from "../../lib/pagination";
import { Icone } from "./Icone";

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
}

/** À utiliser depuis un Server Component (`hrefPage` est une fonction). */
export function Pagination({
  page,
  totalPages,
  hrefPage,
  libelle = "Pagination",
}: PaginationProps) {
  if (totalPages <= 1) return null;
  const courante = Math.min(Math.max(1, page), totalPages);
  const elements = pagesAffichees(courante, totalPages);
  return (
    <nav className="mp-pagination" aria-label={libelle}>
      <p className="mp-pagination__resume">
        Page {courante} sur {totalPages}
      </p>
      <ul className="mp-pagination__liste">
        <li>
          {courante > 1 ? (
            <Link className="mp-pagination__lien" href={hrefPage(courante - 1)} rel="prev">
              <Icone nom="chevronGauche" taille={18} />
              <span>Précédente</span>
            </Link>
          ) : (
            <span className="mp-pagination__lien" aria-disabled="true">
              <Icone nom="chevronGauche" taille={18} />
              <span>Précédente</span>
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
                aria-label={`Page ${el}`}
              >
                {el}
              </Link>
            </li>
          ),
        )}
        <li>
          {courante < totalPages ? (
            <Link className="mp-pagination__lien" href={hrefPage(courante + 1)} rel="next">
              <span>Suivante</span>
              <Icone nom="chevronDroit" taille={18} />
            </Link>
          ) : (
            <span className="mp-pagination__lien" aria-disabled="true">
              <span>Suivante</span>
              <Icone nom="chevronDroit" taille={18} />
            </span>
          )}
        </li>
      </ul>
    </nav>
  );
}
