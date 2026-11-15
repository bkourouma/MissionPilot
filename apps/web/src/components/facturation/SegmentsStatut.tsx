import Link from "next/link";
import { T } from "../i18n/T";

export interface SegmentsStatutProps {
  /** Statut courant ; "" = tous. */
  statut: string;
  options: readonly { valeur: string; libelle: string }[];
  /** Lien vers la liste filtrée sur un statut ("" = tous). Server Component seulement. */
  href: (statut: string) => string;
  libelle: string;
}

/** Filtre par statut en liens (l'état vit dans l'URL : partage, retour, rechargement). */
export function SegmentsStatut({ statut, options, href, libelle }: SegmentsStatutProps) {
  return (
    <nav className="mp-filtre-segments" aria-label={libelle}>
      {[{ valeur: "", libelle: null as string | null }, ...options].map((o) => (
        <Link
          key={o.valeur || "tous"}
          href={href(o.valeur)}
          aria-current={statut === o.valeur ? "page" : undefined}
          className="mp-onglets__lien"
        >
          {o.libelle ?? <T fr="Tous" en="All" />}
        </Link>
      ))}
    </nav>
  );
}
