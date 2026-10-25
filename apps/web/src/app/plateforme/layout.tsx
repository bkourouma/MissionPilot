import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./plateforme.css";

export const metadata: Metadata = {
  title: { default: "Console plateforme", template: "%s — Console plateforme CabinetPilot" },
};

/**
 * Racine de la console de plateforme (super administrateur) : styles propres. La connexion est
 * publique ; la garde de session est dans le groupe `(console)`. Le `noindex` vient du layout
 * racine.
 */
export default function LayoutPlateforme({ children }: { children: ReactNode }) {
  return children;
}
