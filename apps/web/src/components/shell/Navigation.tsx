"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import {
  CHEMIN_SECURITE_COMPTE,
  entreesBarreBasse,
  entreeActive,
  grouperEntrees,
  type EntreeNavigation,
} from "../../lib/navigation";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { SelecteurLangue } from "../i18n/SelecteurLangue";
import { Icone } from "../ui/Icone";
import { BoutonDeconnexion } from "./BoutonDeconnexion";
import { LienNavigation } from "./LienNavigation";
import { PastilleTaches } from "./PastilleTaches";
import {
  basculerTous,
  ecrireMemoireRail,
  groupesAOuvrir,
  indexClavier,
  lireMemoireRail,
  stockageLocalSur,
  toutEstOuvert,
} from "./rail";

/** Pastille propre à une entrée (tâches ouvertes de « Mes tâches »). */
const pastilleDe = (e: EntreeNavigation) => (e.id === "mes-taches" ? <PastilleTaches /> : null);

/** Largeur à partir de laquelle le rail remplace la barre basse et le tiroir (cadre.css). */
const MEDIA_RAIL = "(min-width: 960px)";

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
 * (`repliable`), un groupe se replie : seul celui de la page courante est ouvert au départ, puis
 * l'état choisi est mémorisé sur l'appareil (relu après le montage, pour que le rendu serveur et
 * le premier rendu client restent identiques). Le groupe de la page courante est signalé même
 * replié. Ouvrir un groupe ne ferme pas les autres.
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
  const langue = useLangue();
  const t = useT();
  const actif = entreeActive(entrees, chemin)?.id;
  const groupes = grouperEntrees(entrees, langue);
  const identifiants = groupes.map((g) => g.id);
  const [ouverts, setOuverts] = useState<ReadonlySet<string>>(
    () => new Set(groupesActifs(entrees, chemin)),
  );
  // Mémoire des groupes ouverts : lue une fois après le montage (jamais pendant l'hydratation).
  useEffect(() => {
    if (!repliable) return;
    const memorises = lireMemoireRail(stockageLocalSur(), identifiants);
    if (memorises === null) return;
    setOuverts((avant) => new Set(groupesAOuvrir([...avant, ...memorises], [])));
    // Lecture unique : les identifiants ne changent que si les droits changent (rechargement).
  }, [repliable]);
  // Aller sur une page ouvre son groupe (les autres gardent l'état choisi par la personne).
  useEffect(() => {
    setOuverts((avant) => {
      const actifs = groupesActifs(entrees, chemin);
      return actifs.every((id) => avant.has(id)) ? avant : new Set([...avant, ...actifs]);
    });
  }, [entrees, chemin]);

  const changer = (apres: Set<string>) => {
    setOuverts(apres);
    ecrireMemoireRail(stockageLocalSur(), apres);
  };
  const basculer = (id: string) => {
    const apres = new Set(ouverts);
    if (!apres.delete(id)) apres.add(id);
    changer(apres);
  };
  const toutOuvert = toutEstOuvert(ouverts, identifiants);

  return (
    <div className="mp-nav__groupes">
      {repliable && groupes.length > 1 ? (
        <div className="mp-nav__outils">
          <button
            type="button"
            className="mp-nav__tout"
            onClick={() => changer(basculerTous(ouverts, identifiants))}
          >
            {toutOuvert ? t("Tout replier", "Collapse all") : t("Tout déplier", "Expand all")}
          </button>
        </div>
      ) : null}
      {groupes.map((g) => {
        const idTitre = `${idPrefixe}-${g.id}`;
        const idListe = `${idPrefixe}-liste-${g.id}`;
        const ouvert = !repliable || ouverts.has(g.id);
        const contientPage = g.entrees.some((e) => e.id === actif);
        return (
          <div key={g.id} className="mp-nav__groupe" data-actif={contientPage ? "oui" : undefined}>
            {repliable ? (
              <p className="mp-nav__groupe-titre mp-nav__groupe-titre--repliable" id={idTitre}>
                <button
                  type="button"
                  className="mp-nav__groupe-bouton"
                  aria-expanded={ouvert}
                  aria-controls={idListe}
                  onClick={() => basculer(g.id)}
                >
                  <span className="mp-nav__groupe-texte">
                    {g.libelle}
                    {contientPage ? (
                      <>
                        <span className="mp-nav__repere" aria-hidden="true" />
                        <span className="mp-visuellement-cache">
                          {" "}
                          {t("(contient la page courante)", "(contains the current page)")}
                        </span>
                      </>
                    ) : null}
                  </span>
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

/** Éléments du rail atteignables aux flèches : boutons de groupe et liens, hors groupes repliés. */
function elementsFocalisables(nav: HTMLElement): HTMLElement[] {
  return Array.from(
    nav.querySelectorAll<HTMLElement>(".mp-nav__tout, .mp-nav__groupe-bouton, a.mp-nav__lien"),
  ).filter((el) => !el.closest("[hidden]"));
}

/** Rail de navigation (grand écran) : groupes par métier, puis la personne connectée. */
export function NavigationLaterale({
  entrees,
  nom,
  roles,
}: Pick<NavigationProps, "entrees" | "nom" | "roles">) {
  const chemin = usePathname();
  const t = useT();
  const nav = useRef<HTMLElement>(null);
  // L'entrée active reste visible dans le rail défilant, même au bas d'une longue liste. Le groupe
  // peut s'ouvrir dans le même rendu : on attend l'image suivante pour mesurer.
  useEffect(() => {
    const image = requestAnimationFrame(() => {
      nav.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(image);
  }, [chemin]);
  // Flèches haut/bas, début et fin : se déplacer d'une entrée à l'autre sans tabuler partout.
  const surTouche = (ev: KeyboardEvent<HTMLElement>) => {
    if (ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey || !nav.current) return;
    const liste = elementsFocalisables(nav.current);
    const courant = liste.indexOf(ev.target as HTMLElement);
    if (courant < 0) return;
    const cible = indexClavier(ev.key, courant, liste.length);
    if (cible === null) return;
    ev.preventDefault();
    liste[cible]?.focus();
  };
  return (
    <div className="mp-rail">
      <nav
        ref={nav}
        className="mp-nav-laterale"
        aria-label={t("Navigation principale", "Main navigation")}
        onKeyDown={surTouche}
      >
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
              aria-label={t("Sécurité du compte", "Account security")}
              title={t("Sécurité du compte", "Account security")}
            >
              <Icone nom="cadenas" />
            </Link>
            <BoutonDeconnexion iconeSeule />
          </div>
        </div>
        <SelecteurLangue className="mp-langue--nuit mp-rail__langue" />
      </div>
    </div>
  );
}

/**
 * Barre basse (téléphone et tablette) : premières entrées + bouton « Menu » ouvrant le tiroir
 * avec la liste complète. Le tiroir est un `<dialog>` modal : focus piégé, Échap ferme, arrière-plan
 * inerte ; en plus, la page ne défile plus derrière, le focus revient au bouton « Menu » et le
 * tiroir se ferme au changement de page.
 */
export function BarreNavigationBasse({ entrees, nom, roles }: NavigationProps) {
  const chemin = usePathname();
  const t = useT();
  const dialogue = useRef<HTMLDialogElement>(null);
  const boutonMenu = useRef<HTMLButtonElement>(null);
  const boutonFermer = useRef<HTMLButtonElement>(null);
  const aNavigue = useRef(false);
  const [ouvert, setOuvert] = useState(false);

  useEffect(() => {
    const d = dialogue.current;
    if (!d) return;
    if (ouvert && !d.open) {
      d.showModal();
      boutonFermer.current?.focus();
    }
    if (!ouvert && d.open) d.close();
  }, [ouvert]);

  // Page figée derrière le tiroir ouvert (cadre.css : html[data-menu-ouvert]).
  useEffect(() => {
    if (!ouvert) return;
    const racine = document.documentElement;
    racine.setAttribute("data-menu-ouvert", "");
    return () => racine.removeAttribute("data-menu-ouvert");
  }, [ouvert]);

  // Changement de page (lien du tiroir, retour arrière…) : le tiroir se ferme.
  useEffect(() => {
    setOuvert(false);
  }, [chemin]);

  // Passage en largeur « rail » (rotation, redimensionnement) : le tiroir n'a plus lieu d'être.
  useEffect(() => {
    if (!ouvert) return;
    const media = window.matchMedia(MEDIA_RAIL);
    const surChangement = () => {
      if (media.matches) setOuvert(false);
    };
    media.addEventListener("change", surChangement);
    return () => media.removeEventListener("change", surChangement);
  }, [ouvert]);

  const fermerApresNavigation = () => {
    aNavigue.current = true;
    setOuvert(false);
  };
  const surFermeture = () => {
    setOuvert(false);
    if (aNavigue.current) {
      // Navigation : le focus part vers le contenu de la nouvelle page, pas vers « Menu ».
      aNavigue.current = false;
      (document.activeElement as HTMLElement | null)?.blur();
    } else {
      boutonMenu.current?.focus();
    }
  };

  const principales = entreesBarreBasse(entrees);
  const actifBarre = entreeActive(principales, chemin)?.id;
  const actifMenu = entreeActive(entrees, chemin)?.id;
  // La page courante est dans « Menu » quand elle n'a pas sa place dans la barre.
  const pageDansMenu = actifMenu !== undefined && actifBarre !== actifMenu;
  return (
    <>
      <nav className="mp-barre-basse" aria-label={t("Navigation principale", "Main navigation")}>
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
              ref={boutonMenu}
              type="button"
              className="mp-nav__lien mp-nav__lien--barre"
              aria-haspopup="dialog"
              aria-expanded={ouvert}
              data-page-courante={pageDansMenu ? "oui" : undefined}
              onClick={() => setOuvert(true)}
            >
              <Icone nom="menu" />
              <span className="mp-nav__libelle">{t("Menu", "Menu")}</span>
            </button>
          </li>
        </ul>
      </nav>
      <dialog
        ref={dialogue}
        className="mp-menu"
        aria-labelledby="mp-menu-titre"
        onClose={surFermeture}
        onClick={(ev) => {
          // Clic sur le fond (hors du contenu) : fermer.
          if (ev.target === ev.currentTarget) setOuvert(false);
        }}
      >
        <div className="mp-menu__contenu">
          <div className="mp-menu__entete">
            <h2 id="mp-menu-titre" className="mp-menu__titre">
              {t("Menu", "Menu")}
            </h2>
            <button
              ref={boutonFermer}
              type="button"
              className="mp-bouton mp-bouton--discret mp-bouton--icone"
              onClick={() => setOuvert(false)}
            >
              <Icone nom="fermer" libelle={t("Fermer le menu", "Close menu")} />
            </button>
          </div>
          <p className="mp-menu__utilisateur">
            <strong>{nom}</strong>
            <span>{roles}</span>
          </p>
          <nav aria-label={t("Toutes les rubriques", "All sections")}>
            <ListeGroupee
              entrees={entrees}
              chemin={chemin}
              onNaviguer={fermerApresNavigation}
              idPrefixe="menu"
            />
          </nav>
          <div className="mp-menu__pied">
            <Link
              href={CHEMIN_SECURITE_COMPTE}
              className="mp-bouton mp-bouton--secondaire mp-bouton--plein"
              aria-current={chemin === CHEMIN_SECURITE_COMPTE ? "page" : undefined}
              onClick={fermerApresNavigation}
            >
              <Icone nom="cadenas" />
              <span>{t("Sécurité du compte", "Account security")}</span>
            </Link>
            <BoutonDeconnexion pleineLargeur />
          </div>
        </div>
      </dialog>
    </>
  );
}
