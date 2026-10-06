import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "../styles/tokens.css";
import "../styles/base.css";
import "../styles/composants.css";
import "../styles/cadre.css";
import "../styles/referentiels.css";

export const metadata: Metadata = {
  title: { default: "MissionPilot", template: "%s — MissionPilot" },
  description: "Gestion des missions, du temps et de la facturation des cabinets de conseil.",
  applicationName: "MissionPilot",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "MissionPilot", statusBarStyle: "default" },
  formatDetection: { telephone: false },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#1b4f7a" },
    { media: "(prefers-color-scheme: dark)", color: "#0e141b" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
