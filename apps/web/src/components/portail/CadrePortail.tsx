import Link from "next/link";
import type { ReactNode } from "react";
import type { EntreePortail } from "../../lib/portail";
import { CHEMIN_PORTAIL, CHEMIN_SECURITE_PORTAIL } from "../../lib/portail-routes";
import { BoutonDeconnexion } from "../shell/BoutonDeconnexion";
import { Alerte } from "../ui/Alerte";
import { NavigationPortail } from "./NavigationPortail";

export interface CadrePortailProps {
  nom: string;
  /** Raison sociale de l'entreprise cliente, si le profil a pu être chargé. */
  entreprise: string | null;
  entrees: readonly EntreePortail[];
  /** Le cabinet exige la double authentification et elle n'est pas encore activée. */
  tfaAConfigurer: boolean;
  children: ReactNode;
}

/** Logo MissionPilot (décoratif : le texte voisin porte le nom). */
function Logo() {
  return (
    <svg
      className="mp-portail__logo"
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
  );
}

/** Cadre de l'espace client : en-tête sobre, navigation courte, contenu principal. */
export function CadrePortail({
  nom,
  entreprise,
  entrees,
  tfaAConfigurer,
  children,
}: CadrePortailProps) {
  return (
    <div className="mp-portail">
      <a className="mp-lien-evitement" href="#contenu">
        Aller au contenu principal
      </a>
      <header className="mp-portail__entete">
        <Link href={CHEMIN_PORTAIL} className="mp-portail__marque">
          <Logo />
          <span className="mp-portail__marque-textes">
            <span className="mp-portail__produit">MissionPilot</span>
            <span className="mp-portail__espace">
              {entreprise ? `Espace client · ${entreprise}` : "Espace client"}
            </span>
          </span>
        </Link>
        <div className="mp-portail__compte">
          <p className="mp-portail__nom">{nom}</p>
          <BoutonDeconnexion />
        </div>
      </header>
      <NavigationPortail entrees={entrees} />
      <main id="contenu" className="mp-portail__contenu" tabIndex={-1}>
        {tfaAConfigurer ? (
          <div className="mp-portail__bandeau">
            <Alerte
              tonalite="attention"
              annonce="aucune"
              titre="Activez la double authentification"
            >
              <p>
                Votre cabinet la demande pour protéger vos documents et vos factures : une fois
                activée, un code affiché sur votre téléphone vous sera demandé à la connexion.{" "}
                <Link href={CHEMIN_SECURITE_PORTAIL}>L&apos;activer maintenant</Link>
              </p>
            </Alerte>
          </div>
        ) : null}
        {children}
      </main>
    </div>
  );
}
