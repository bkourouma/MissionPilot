"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { entreeActive, type EntreePortail } from "../../lib/portail";
import { Icone } from "../ui/Icone";

/**
 * Navigation de l'espace client : barre basse sur téléphone, rangée sous l'en-tête sur grand
 * écran (même élément, un seul repère « navigation »). Entrées déjà filtrées par les droits.
 */
export function NavigationPortail({ entrees }: { entrees: readonly EntreePortail[] }) {
  const chemin = usePathname();
  return (
    <nav className="mp-portail__nav" aria-label="Rubriques de l'espace client">
      <ul className="mp-portail__nav-liste">
        {entrees.map((e) => (
          <li key={e.id}>
            <Link
              href={e.href}
              className="mp-portail__lien"
              aria-current={entreeActive(chemin, e) ? "page" : undefined}
            >
              <Icone nom={e.icone} />
              <span>{e.libelle}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
