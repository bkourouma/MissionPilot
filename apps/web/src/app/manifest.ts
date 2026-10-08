import type { MetadataRoute } from "next";

/**
 * Servi à /manifest.webmanifest. Le service worker (`public/sw.js`, enregistré par
 * `components/hors-ligne/HorsLigne.tsx`) ne garde que les ressources statiques et sert une page
 * « hors ligne » ; aucune page ni réponse d'API n'est mise en cache.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MissionPilot",
    short_name: "MissionPilot",
    description: "Gestion des missions, du temps et de la facturation des cabinets de conseil.",
    lang: "fr",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#f5f6f8",
    theme_color: "#1b4f7a",
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
