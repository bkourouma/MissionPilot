import Link from "next/link";
import type { ReactNode } from "react";
import { ROLE_LIBELLES, type Role } from "@missionpilot/shared";
import type { EntreeNavigation } from "../../lib/navigation";
import { ClocheNotifications } from "./ClocheNotifications";
import { Marque } from "./Marque";
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
        <Link href="/" className="mp-entete__marque" aria-label="CabinetPilot, accueil">
          <Marque />
        </Link>
        <ClocheNotifications />
      </header>
      <div className="mp-cadre__corps">
        <NavigationLaterale entrees={entrees} nom={nom} roles={libelles} />
        <main id="contenu" className="mp-contenu" tabIndex={-1}>
          {children}
        </main>
      </div>
      <BarreNavigationBasse entrees={entrees} nom={nom} roles={libelles} />
    </div>
  );
}
