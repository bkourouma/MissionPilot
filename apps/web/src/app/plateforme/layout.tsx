import type { Metadata } from "next";
import type { ReactNode } from "react";
import { obtenirT } from "../../lib/i18n/serveur";
import "./plateforme.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return {
    title: {
      default: t("Console plateforme", "Platform console"),
      template: t("%s — Console plateforme CabinetPilot", "%s — CabinetPilot platform console"),
    },
  };
}

/**
 * Racine de la console de plateforme (super administrateur) : styles propres. La connexion est
 * publique ; la garde de session est dans le groupe `(console)`. Le `noindex` vient du layout
 * racine.
 */
export default function LayoutPlateforme({ children }: { children: ReactNode }) {
  return children;
}
