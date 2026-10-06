import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./portail.css";

export const metadata: Metadata = {
  title: { default: "Espace client", template: "%s — Espace client MissionPilot" },
};

/**
 * Racine de l'espace client (portail, SOC-09) : styles propres au portail. Le cadre et la garde
 * de session sont dans le groupe `(espace)` ; l'acceptation d'une invitation reste publique.
 */
export default function LayoutPortail({ children }: { children: ReactNode }) {
  return children;
}
