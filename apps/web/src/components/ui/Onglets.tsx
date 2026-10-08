"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { sousPageActive, type SousPage } from "../../lib/navigation";

export interface OngletsProps {
  /** Sous-pages déjà filtrées par les permissions (côté serveur). */
  pages: readonly Pick<SousPage, "id" | "libelle" | "href">[];
  libelle: string;
}

/** Navigation entre les sous-pages d'une rubrique (liens, pas un widget d'onglets ARIA). */
export function Onglets({ pages, libelle }: OngletsProps) {
  const chemin = usePathname();
  const nav = useRef<HTMLElement>(null);
  // Téléphone : la barre d'onglets défile ; l'onglet actif est ramené dans la zone visible.
  useEffect(() => {
    const lien = nav.current?.querySelector<HTMLElement>('[aria-current="page"]');
    const barre = nav.current;
    if (!lien || !barre) return;
    const gauche =
      lien.getBoundingClientRect().left - barre.getBoundingClientRect().left + barre.scrollLeft;
    if (
      gauche < barre.scrollLeft ||
      gauche + lien.offsetWidth > barre.scrollLeft + barre.clientWidth
    )
      barre.scrollLeft = Math.max(0, gauche - 16);
  }, [chemin]);
  if (pages.length < 2) return null;
  const active = sousPageActive(pages, chemin);
  return (
    <nav ref={nav} className="mp-onglets" aria-label={libelle}>
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
