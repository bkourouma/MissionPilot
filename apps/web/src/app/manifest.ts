import type { MetadataRoute } from "next";
import { obtenirLangue } from "../lib/i18n/serveur";

/**
 * Servi à /manifest.webmanifest. Le service worker (`public/sw.js`, enregistré par
 * `components/hors-ligne/HorsLigne.tsx`) ne garde que les ressources statiques et sert une page
 * « hors ligne » ; aucune page ni réponse d'API n'est mise en cache.
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const en = (await obtenirLangue()) === "en";
  return {
    name: "CabinetPilot",
    short_name: "CabinetPilot",
    description: en
      ? "Engagement, time and invoicing management for consulting firms."
      : "Gestion des missions, du temps et de la facturation des cabinets de conseil.",
    lang: en ? "en" : "fr",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#f4f1fb",
    theme_color: "#2b1468",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icones/icone.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      {
        src: "/icones/icone-masquable.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
