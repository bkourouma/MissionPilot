import Link from "next/link";
import type { ReactNode } from "react";
import { ROLE_LIBELLES, type Role } from "@missionpilot/shared";
import type { EntreeNavigation } from "../../lib/navigation";
import { BoutonDeconnexion } from "./BoutonDeconnexion";
import { ClocheNotifications } from "./ClocheNotifications";
import { BarreNavigationBasse, NavigationLaterale } from "./Navigation";

export function libellesRoles(roles: readonly Role[]): string {
  return roles.length === 0 ? "Aucun rôle" : roles.map((r) => ROLE_LIBELLES[r]).join(", ");
}

export interface CadreApplicationProps {
  nom: string;
  roles: readonly Role[];
  entrees: readonly EntreeNavigation[];
  children: ReactNode;
}

/** En-tête, navigation latérale (grand écran) ou barre basse (téléphone), contenu principal. */
export function CadreApplication({ nom, roles, entrees, children }: CadreApplicationProps) {
  const libelles = libellesRoles(roles);
  return (
    <div className="mp-cadre">
      <a className="mp-lien-evitement" href="#contenu">
        Aller au contenu principal
      </a>
      <header className="mp-entete">
        <Link href="/" className="mp-entete__marque">
          <svg
            className="mp-entete__logo"
            viewBox="0 0 32 32"
            width="28"
            height="28"
            aria-hidden="true"
            focusable="false"
          >
            <rect width="32" height="32" rx="7" fill="currentColor" />
            <path
              d="M8 23V10l8 8 8-8v13"
              fill="none"
              stroke="var(--mp-sur-primaire)"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>MissionPilot</span>
        </Link>
        <div className="mp-entete__utilisateur">
          <ClocheNotifications />
          <p className="mp-entete__identite">
            <span className="mp-entete__nom">{nom}</span>
            <span className="mp-entete__role">{libelles}</span>
          </p>
          <div className="mp-entete__deconnexion">
            <BoutonDeconnexion />
          </div>
        </div>
      </header>
      <div className="mp-cadre__corps">
        <NavigationLaterale entrees={entrees} />
        <main id="contenu" className="mp-contenu" tabIndex={-1}>
          {children}
        </main>
      </div>
      <BarreNavigationBasse entrees={entrees} nom={nom} roles={libelles} />
    </div>
  );
}
