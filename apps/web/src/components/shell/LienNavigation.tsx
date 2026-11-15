"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { libelleEntree, type EntreeNavigation } from "../../lib/navigation";
import { T } from "../i18n/T";
import { useLangue } from "../i18n/FournisseurLangue";
import { Icone } from "../ui/Icone";

export interface LienNavigationProps {
  entree: EntreeNavigation;
  active: boolean;
  /** « liste » : navigation latérale et menu ; « barre » : barre basse du téléphone. */
  forme: "liste" | "barre";
  onNaviguer?: () => void;
  /** Pastille de compteur (ex. tâches ouvertes), dont le texte accessible complète le libellé. */
  pastille?: ReactNode;
}

/**
 * Entrée de menu. Un écran pas encore disponible est rendu désactivé (aria-disabled, hors de
 * l'ordre de tabulation) au lieu d'un lien vers une page absente.
 */
export function LienNavigation({
  entree,
  active,
  forme,
  onNaviguer,
  pastille,
}: LienNavigationProps) {
  const langue = useLangue();
  const classe = `mp-nav__lien mp-nav__lien--${forme}`;
  const libelle = libelleEntree(entree, langue, forme === "barre");
  if (!entree.disponible) {
    return (
      <span className={`${classe} mp-nav__lien--indisponible`} role="link" aria-disabled="true">
        <Icone nom={entree.icone} />
        <span className="mp-nav__libelle">{libelle}</span>
        <span className="mp-visuellement-cache">
          {" "}
          <T fr="(pas encore disponible)" en="(not yet available)" />
        </span>
      </span>
    );
  }
  return (
    <Link
      href={entree.href}
      className={classe}
      aria-current={active ? "page" : undefined}
      onClick={onNaviguer}
    >
      <Icone nom={entree.icone} />
      <span className="mp-nav__libelle">{libelle}</span>
      {pastille}
    </Link>
  );
}
