"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  CHEMIN_SECURITE_COMPTE,
  entreesBarreBasse,
  entreeActive,
  grouperEntrees,
  type EntreeNavigation,
} from "../../lib/navigation";
import { Icone } from "../ui/Icone";
import { BoutonDeconnexion } from "./BoutonDeconnexion";
import { LienNavigation } from "./LienNavigation";
import { PastilleTaches } from "./PastilleTaches";

/** Pastille propre à une entrée (tâches ouvertes de « Mes tâches »). */
const pastilleDe = (e: EntreeNavigation) => (e.id === "mes-taches" ? <PastilleTaches /> : null);

export interface NavigationProps {
  /** Entrées déjà filtrées par les permissions de l'utilisateur (côté serveur). */
  entrees: readonly EntreeNavigation[];
  nom: string;
  roles: string;
}

/** Identifiants des groupes qui contiennent l'entrée de la page courante. */
function groupesActifs(entrees: readonly EntreeNavigation[], chemin: string): string[] {
  const actif = entreeActive(entrees, chemin)?.id;
  return grouperEntrees(entrees)
    .filter((g) => g.entrees.some((e) => e.id === actif))
    .map((g) => g.id);
}

/**
 * Navigation regroupée par métier : un titre par groupe, puis ses entrées. Dans le rail
 * (`repliable`), un groupe se replie : seul celui de la page courante est ouvert au départ, ce
 * qui garde les six groupes à portée d'un coup d'œil ; l'ouvrir ne ferme pas les autres.
 */
function ListeGroupee({
  entrees,
  chemin,
  onNaviguer,
  idPrefixe,
  repliable = false,
}: {
  entrees: readonly EntreeNavigation[];
  chemin: string;
  onNaviguer?: () => void;
  idPrefixe: string;
  repliable?: boolean;
}) {
  const actif = entreeActive(entrees, chemin)?.id;
  const [ouverts, setOuverts] = useState<ReadonlySet<string>>(
    () => new Set(groupesActifs(entrees, chemin)),
  );
  // Aller sur une page ouvre son groupe (les autres gardent l'état choisi par la personne).
  useEffect(() => {
    setOuverts((avant) => {
      const actifs = groupesActifs(entrees, chemin);
      return actifs.every((id) => avant.has(id)) ? avant : new Set([...avant, ...actifs]);
    });
  }, [entrees, chemin]);
  const basculer = (id: string) =>
    setOuverts((avant) => {
      const apres = new Set(avant);
      if (!apres.delete(id)) apres.add(id);
      return apres;
    });
  return (
    <div className="mp-nav__groupes">
      {grouperEntrees(entrees).map((g) => {
        const idTitre = `${idPrefixe}-${g.id}`;
        const idListe = `${idPrefixe}-liste-${g.id}`;
        const ouvert = !repliable || ouverts.has(g.id);
        return (
          <div key={g.id} className="mp-nav__groupe">
            {repliable ? (
              <p className="mp-nav__groupe-titre mp-nav__groupe-titre--repliable" id={idTitre}>
                <button
                  type="button"
                  className="mp-nav__groupe-bouton"
                  aria-expanded={ouvert}
                  aria-controls={idListe}
                  onClick={() => basculer(g.id)}
                >
                  <span>{g.libelle}</span>
                  <Icone nom="chevronDroit" taille={16} className="mp-nav__chevron" />
                </button>
              </p>
            ) : (
              <p className="mp-nav__groupe-titre" id={idTitre}>
                {g.libelle}
              </p>
            )}
            <ul className="mp-nav__liste" id={idListe} aria-labelledby={idTitre} hidden={!ouvert}>
              {g.entrees.map((e) => (
                <li key={e.id}>
                  <LienNavigation
                    entree={e}
                    active={e.id === actif}
                    forme="liste"
                    pastille={pastilleDe(e)}
                    onNaviguer={onNaviguer}
                  />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/** Rail de navigation (grand écran) : groupes par métier, puis la personne connectée. */
export function NavigationLaterale({
  entrees,
  nom,
  roles,
}: Pick<NavigationProps, "entrees" | "nom" | "roles">) {
  const chemin = usePathname();
  const nav = useRef<HTMLElement>(null);
  // L'entrée active reste visible dans le rail défilant, même au bas d'une longue liste.
  useEffect(() => {
    nav.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest" });
  }, [chemin]);
  return (
    <div className="mp-rail">
      <nav ref={nav} className="mp-nav-laterale" aria-label="Navigation principale">
        <ListeGroupee entrees={entrees} chemin={chemin} idPrefixe="rail" repliable />
      </nav>
      <div className="mp-rail__utilisateur">
        <div className="mp-rail__ligne">
          <p className="mp-rail__identite">
            <span className="mp-rail__nom">{nom}</span>
            <span className="mp-rail__role">{roles}</span>
          </p>
          <div className="mp-rail__actions">
            <Link
              href={CHEMIN_SECURITE_COMPTE}
              className="mp-rail__icone"
              aria-current={chemin === CHEMIN_SECURITE_COMPTE ? "page" : undefined}
              aria-label="Sécurité du compte"
              title="Sécurité du compte"
            >
              <Icone nom="cadenas" />
            </Link>
            <BoutonDeconnexion iconeSeule />
          </div>
        </div>
      </div>
    </div>
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

  const principales = entreesBarreBasse(entrees);
  const actifBarre = entreeActive(principales, chemin)?.id;
  return (
    <>
      <nav className="mp-barre-basse" aria-label="Navigation principale">
        <ul className="mp-barre-basse__liste">
          {principales.map((e) => (
            <li key={e.id}>
              <LienNavigation
                entree={e}
                active={e.id === actifBarre}
                forme="barre"
                pastille={pastilleDe(e)}
              />
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
            <ListeGroupee
              entrees={entrees}
              chemin={chemin}
              onNaviguer={() => setOuvert(false)}
              idPrefixe="menu"
            />
          </nav>
          <Link
            href={CHEMIN_SECURITE_COMPTE}
            className="mp-bouton mp-bouton--secondaire mp-bouton--plein"
            aria-current={chemin === CHEMIN_SECURITE_COMPTE ? "page" : undefined}
            onClick={() => setOuvert(false)}
          >
            <Icone nom="cadenas" />
            <span>Sécurité du compte</span>
          </Link>
          <BoutonDeconnexion pleineLargeur />
        </div>
      </dialog>
    </>
  );
}
