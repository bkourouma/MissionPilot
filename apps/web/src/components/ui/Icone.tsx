/**
 * Jeu d'icônes en SVG en ligne (trait 24×24), sans dépendance. Décoratives par défaut
 * (aria-hidden) : le texte voisin porte le sens.
 */
const TRACES = {
  accueil: "M3 11.5 12 4l9 7.5M5.5 9.5V20h5v-6h3v6h5V9.5",
  calendrier: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  horloge: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3.5 2",
  dossier: "M3 6.5h6l2 2H21V19H3zM3 10h18",
  immeuble: "M5 21V4h10v17M15 9h4v12M3 21h18M8 7.5h1M11 7.5h1M8 11h1M11 11h1M8 14.5h1M11 14.5h1",
  livre: "M5 4.5h10a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h10",
  barres: "M4 20h16M7 17v-6M12 17V7M17 17v-9",
  facture: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3",
  courbe: "M4 4v16h16M7 15l4-5 3 3 5-6",
  reglages:
    "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1",
  menu: "M4 7h16M4 12h16M4 17h16",
  fermer: "M6 6l12 12M18 6 6 18",
  deconnexion: "M10 4H5v16h5M14 8l4 4-4 4M18 12H9",
  succes: "M5 12.5l4.5 4.5L19 7.5",
  attention: "M12 4 2.5 20h19zM12 10v4.5M12 17.2v.3",
  danger: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9 9l6 6M15 9l-6 6",
  info: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7.5v.3",
  neutre: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8 12h8",
  cadenas: "M6 11h12v10H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3",
  chevronGauche: "M15 5l-7 7 7 7",
  chevronDroit: "M9 5l7 7-7 7",
  personnes:
    "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.3a3.5 3.5 0 0 1 0 6.4M18 14.2a6.5 6.5 0 0 1 3.5 5.8",
  plus: "M12 5v14M5 12h14",
  crayon: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
  corbeille: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6",
  copie: "M8 8h12v12H8zM16 8V4H4v12h4",
  recherche: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4",
  courrier: "M3 6h18v12H3zM3 7l9 6 9-6",
  oeil: "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z",
} as const;

export type NomIcone = keyof typeof TRACES;

export interface IconeProps {
  nom: NomIcone;
  taille?: number;
  /** Fournir un libellé seulement si l'icône est seule à porter le sens. */
  libelle?: string;
  className?: string;
}

export function Icone({ nom, taille = 20, libelle, className }: IconeProps) {
  return (
    <svg
      className={className ? `mp-icone ${className}` : "mp-icone"}
      width={taille}
      height={taille}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      {...(libelle ? { role: "img", "aria-label": libelle } : { "aria-hidden": true })}
    >
      <path d={TRACES[nom]} />
    </svg>
  );
}
