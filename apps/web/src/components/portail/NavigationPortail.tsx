"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { entreeActive, libelleEntreePortail, type EntreePortail } from "../../lib/portail";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { Icone } from "../ui/Icone";
// Feuille des canaux : la barre défile sur téléphone quand elle compte plus de sept entrées.
import "../canaux/canaux.css";

/**
 * Navigation de l'espace client : barre basse sur téléphone, rangée sous l'en-tête sur grand
 * écran (même élément, un seul repère « navigation »). Entrées déjà filtrées par les droits.
 */
export function NavigationPortail({ entrees }: { entrees: readonly EntreePortail[] }) {
  const chemin = usePathname();
  const t = useT();
  const langue = useLangue();
  const refListe = useRef<HTMLUListElement>(null);
  // Barre qui défile (téléphone) : la rubrique courante reste visible, sans bouger la page.
  useEffect(() => {
    refListe.current
      ?.querySelector<HTMLElement>('[aria-current="page"]')
      ?.scrollIntoView?.({ block: "nearest", inline: "center" });
  }, [chemin]);
  return (
    <nav
      className="mp-portail__nav"
      aria-label={t("Rubriques de l'espace client", "Client space sections")}
    >
      <ul ref={refListe} className="mp-portail__nav-liste">
        {entrees.map((e) => (
          <li key={e.id}>
            <Link
              href={e.href}
              className="mp-portail__lien"
              aria-current={entreeActive(chemin, e) ? "page" : undefined}
            >
              <Icone nom={e.icone} />
              <span>{libelleEntreePortail(e, langue)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
