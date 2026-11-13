import type { Metadata } from "next";
import type { ReactNode } from "react";
import { obtenirT } from "../../lib/i18n/serveur";
import "./portail.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return {
    title: {
      default: t("Espace client", "Client space"),
      template: t("%s — Espace client CabinetPilot", "%s — CabinetPilot client space"),
    },
  };
}

/**
 * Racine de l'espace client (portail, SOC-09) : styles propres au portail. Le cadre et la garde
 * de session sont dans le groupe `(espace)` ; l'acceptation d'une invitation reste publique.
 */
export default function LayoutPortail({ children }: { children: ReactNode }) {
  return children;
}
