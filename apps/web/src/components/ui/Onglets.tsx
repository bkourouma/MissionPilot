"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { sousPageActive, type SousPage } from "../../lib/navigation";

export interface OngletsProps {
  /** Sous-pages déjà filtrées par les permissions (côté serveur). */
  pages: readonly Pick<SousPage, "id" | "libelle" | "href">[];
  libelle: string;
}

/** Navigation entre les sous-pages d'une rubrique (liens, pas un widget d'onglets ARIA). */
export function Onglets({ pages, libelle }: OngletsProps) {
  const chemin = usePathname();
  if (pages.length < 2) return null;
  const active = sousPageActive(pages, chemin);
  return (
    <nav className="mp-onglets" aria-label={libelle}>
      <ul className="mp-onglets__liste">
        {pages.map((p) => (
          <li key={p.id}>
            <Link
              href={p.href}
              className="mp-onglets__lien"
              aria-current={p.id === active ? "page" : undefined}
            >
              {p.libelle}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
