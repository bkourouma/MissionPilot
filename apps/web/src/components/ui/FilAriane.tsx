import Link from "next/link";
import { useId } from "react";
import { T } from "../i18n/T";
import { elementsFil, type MaillonFil } from "./FilAriane.aide";
import { Icone } from "./Icone";

export interface FilArianeProps {
  /** Du plus général au plus précis ; le dernier maillon est la page courante (sans lien). */
  fil: readonly MaillonFil[];
  /** Nom de la zone de navigation (défaut : « Fil d'Ariane » / « Breadcrumb »). */
  libelle?: string;
}

/**
 * Fil d'Ariane : `nav` + liste ordonnée, `aria-current="page"` sur le dernier maillon,
 * séparateurs décoratifs masqués aux lecteurs d'écran. Sur téléphone, seuls les deux derniers
 * maillons restent visibles (le parent sert de retour) et les libellés longs sont tronqués.
 *
 * `<FilAriane fil={[{ href: "/missions", libelle: "Missions" }, { libelle: "Audit 2026" }]} />`
 */
export function FilAriane({ fil, libelle }: FilArianeProps) {
  const idLibelle = useId();
  const elements = elementsFil(fil);
  if (elements.length === 0) return null;
  return (
    <nav className="mp-fil" aria-label={libelle} aria-labelledby={libelle ? undefined : idLibelle}>
      {libelle ? null : (
        <span id={idLibelle} className="mp-visuellement-cache">
          <T fr="Fil d'Ariane" en="Breadcrumb" />
        </span>
      )}
      <ol className="mp-fil__liste">
        {elements.map((el, i) => (
          <li key={`${i}-${el.libelle}`} className="mp-fil__element">
            {el.courant ? (
              <span className="mp-fil__courant" aria-current="page">
                {el.libelle}
              </span>
            ) : el.href ? (
              <Link href={el.href} className="mp-fil__lien">
                {el.libelle}
              </Link>
            ) : (
              <span className="mp-fil__texte">{el.libelle}</span>
            )}
            {el.courant ? null : (
              <span className="mp-fil__separateur" aria-hidden="true">
                <Icone nom="chevronDroit" taille={14} />
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
