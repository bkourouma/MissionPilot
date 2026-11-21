import Link from "next/link";
import type { ReactNode } from "react";
import { libelleRole, type Langue, type Role } from "@missionpilot/shared";
import { obtenirLangue } from "../../lib/i18n/serveur";
import { SelecteurLangue } from "../i18n/SelecteurLangue";
import type { EntreeNavigation } from "../../lib/navigation";
import { AnnonceNavigation } from "./AnnonceNavigation";
import { ClocheNotifications } from "./ClocheNotifications";
import { Marque } from "./Marque";
import { BarreNavigationBasse, NavigationLaterale } from "./Navigation";

export function libellesRoles(roles: readonly Role[], langue: Langue = "fr"): string {
  if (roles.length === 0) return langue === "en" ? "No role" : "Aucun rôle";
  return roles.map((r) => libelleRole(r, langue)).join(", ");
}

export interface CadreApplicationProps {
  nom: string;
  roles: readonly Role[];
  entrees: readonly EntreeNavigation[];
  children: ReactNode;
}

/** En-tête, navigation latérale (grand écran) ou barre basse (téléphone), contenu principal. */
export async function CadreApplication({ nom, roles, entrees, children }: CadreApplicationProps) {
  const langue = await obtenirLangue();
  const en = langue === "en";
  const libelles = libellesRoles(roles, langue);
  return (
    <div className="mp-cadre">
      <a className="mp-lien-evitement" href="#contenu">
        {en ? "Skip to main content" : "Aller au contenu principal"}
      </a>
      <header className="mp-entete">
        <Link
          href="/"
          className="mp-entete__marque"
          aria-label={en ? "CabinetPilot, home" : "CabinetPilot, accueil"}
        >
          <Marque />
        </Link>
        <div className="mp-entete__actions">
          {/* Au grand écran, le sélecteur passe en pied de rail (la colonne du logo est étroite). */}
          <SelecteurLangue className="mp-langue--nuit mp-entete__langue" />
          <ClocheNotifications />
        </div>
      </header>
      <div className="mp-cadre__corps">
        <NavigationLaterale entrees={entrees} nom={nom} roles={libelles} />
        <main id="contenu" className="mp-contenu" tabIndex={-1}>
          {children}
        </main>
      </div>
      <AnnonceNavigation />
      <BarreNavigationBasse entrees={entrees} nom={nom} roles={libelles} />
    </div>
  );
}
