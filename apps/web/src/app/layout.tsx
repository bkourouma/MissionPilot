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
// Après les styles globaux : la feuille de style de l'indicateur de connexion vient ensuite.
import { HorsLigne } from "../components/hors-ligne/HorsLigne";
import { DebloqueurRendu } from "../components/shell/DebloqueurRendu";

export const metadata: Metadata = {
  title: { default: "CabinetPilot", template: "%s — CabinetPilot" },
  description: "Gestion des missions, du temps et de la facturation des cabinets de conseil.",
  applicationName: "CabinetPilot",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "CabinetPilot", statusBarStyle: "default" },
  formatDetection: { telephone: false },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "light",
  themeColor: "#2b1468",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <HorsLigne />
        <DebloqueurRendu />
        {children}
      </body>
    </html>
  );
}
