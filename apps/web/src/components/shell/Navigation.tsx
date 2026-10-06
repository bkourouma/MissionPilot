"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ENTREES_BARRE_BASSE, estActive, type EntreeNavigation } from "../../lib/navigation";
import { Icone } from "../ui/Icone";
import { BoutonDeconnexion } from "./BoutonDeconnexion";
import { LienNavigation } from "./LienNavigation";

export interface NavigationProps {
  /** Entrées déjà filtrées par les permissions de l'utilisateur (côté serveur). */
  entrees: readonly EntreeNavigation[];
  nom: string;
  roles: string;
}

/** Navigation latérale (grand écran). */
export function NavigationLaterale({ entrees }: Pick<NavigationProps, "entrees">) {
  const chemin = usePathname();
  return (
    <nav className="mp-nav-laterale" aria-label="Navigation principale">
      <ul className="mp-nav__liste">
        {entrees.map((e) => (
          <li key={e.id}>
            <LienNavigation entree={e} active={estActive(e, chemin)} forme="liste" />
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Barre basse (téléphone) : premières entrées + bouton « Menu » ouvrant la liste complète. */
export function BarreNavigationBasse({ entrees, nom, roles }: NavigationProps) {
  const chemin = usePathname();
  const dialogue = useRef<HTMLDialogElement>(null);
  const [ouvert, setOuvert] = useState(false);

  useEffect(() => {
    const d = dialogue.current;
    if (!d) return;
    if (ouvert && !d.open) d.showModal();
    if (!ouvert && d.open) d.close();
  }, [ouvert]);

  const principales = entrees.slice(0, ENTREES_BARRE_BASSE);
  return (
    <>
      <nav className="mp-barre-basse" aria-label="Navigation principale">
        <ul className="mp-barre-basse__liste">
          {principales.map((e) => (
            <li key={e.id}>
              <LienNavigation entree={e} active={estActive(e, chemin)} forme="barre" />
            </li>
          ))}
          <li>
            <button
              type="button"
              className="mp-nav__lien mp-nav__lien--barre"
              aria-haspopup="dialog"
              aria-expanded={ouvert}
              onClick={() => setOuvert(true)}
            >
              <Icone nom="menu" />
              <span className="mp-nav__libelle">Menu</span>
            </button>
          </li>
        </ul>
      </nav>
      <dialog
        ref={dialogue}
        className="mp-menu"
        aria-labelledby="mp-menu-titre"
        onClose={() => setOuvert(false)}
        onClick={(ev) => {
          // Clic sur le fond (hors du contenu) : fermer.
          if (ev.target === ev.currentTarget) setOuvert(false);
        }}
      >
        <div className="mp-menu__contenu">
          <div className="mp-menu__entete">
            <h2 id="mp-menu-titre" className="mp-menu__titre">
              Menu
            </h2>
            <button
              type="button"
              className="mp-bouton mp-bouton--discret mp-bouton--icone"
              onClick={() => setOuvert(false)}
            >
              <Icone nom="fermer" libelle="Fermer le menu" />
            </button>
          </div>
          <p className="mp-menu__utilisateur">
            <strong>{nom}</strong>
            <span>{roles}</span>
          </p>
          <nav aria-label="Toutes les rubriques">
            <ul className="mp-nav__liste">
              {entrees.map((e) => (
                <li key={e.id}>
                  <LienNavigation
                    entree={e}
                    active={estActive(e, chemin)}
                    forme="liste"
                    onNaviguer={() => setOuvert(false)}
                  />
                </li>
              ))}
            </ul>
          </nav>
          <BoutonDeconnexion pleineLargeur />
        </div>
      </dialog>
    </>
  );
}
