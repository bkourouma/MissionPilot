import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/sora";
import "@fontsource-variable/figtree";
import "../styles/tokens.css";
import "../styles/base.css";
import "../styles/composants.css";
import "../styles/cadre.css";
import "../styles/referentiels.css";
import "../styles/missions.css";
import "../styles/temps.css";
import "../styles/facturation.css";
import "../styles/finance.css";
import "../styles/collaboration.css";
// Socle : en dernier, pour primer sur les anciennes copies des règles de composants partagés.
import "../styles/socle-formulaires.css";
import "../styles/socle-donnees.css";
// Après les styles globaux : la feuille de style de l'indicateur de connexion vient ensuite.
import { HorsLigne } from "../components/hors-ligne/HorsLigne";
import { DebloqueurRendu } from "../components/shell/DebloqueurRendu";
import { FournisseurLangue } from "../components/i18n/FournisseurLangue";
import { obtenirLangue, obtenirT } from "../lib/i18n/serveur";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return {
    title: { default: "CabinetPilot", template: "%s — CabinetPilot" },
    description: t(
      "Gestion des missions, du temps et de la facturation des cabinets de conseil.",
      "Engagement, time and billing management for consulting firms.",
    ),
    applicationName: "CabinetPilot",
    manifest: "/manifest.webmanifest",
    appleWebApp: { capable: true, title: "CabinetPilot", statusBarStyle: "default" },
    formatDetection: { telephone: false },
    robots: { index: false, follow: false },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "light",
  themeColor: "#2b1468",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const langue = await obtenirLangue();
  return (
    <html lang={langue}>
      <body>
        <FournisseurLangue langue={langue}>
          <HorsLigne />
          <DebloqueurRendu />
          {children}
        </FournisseurLangue>
      </body>
    </html>
  );
}
