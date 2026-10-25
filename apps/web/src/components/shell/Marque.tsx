/**
 * Marque CabinetPilot : dossier violet, feuille lavande, flèche orbitale or (le logo fourni),
 * redessiné en SVG pour rester net à toute taille. À poser sur un fond violet nuit : le mot
 * « Pilot » en or n'a pas le contraste d'un texte sur fond clair.
 */
export function SymboleMarque({ taille = 32 }: { taille?: number }) {
  return (
    <svg
      className="mp-marque__symbole"
      viewBox="0 0 64 64"
      width={taille}
      height={taille}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M8 20a3 3 0 0 1 3-3h14l4 5h24a3 3 0 0 1 3 3v26a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3z"
        fill="#5b2fc4"
      />
      <rect x="19" y="8" width="24" height="26" rx="3" fill="#e9e4f7" />
      <path
        d="M6 50C16 56 38 50 56 28"
        stroke="#e5a72f"
        strokeWidth="4"
        fill="none"
        strokeLinecap="round"
      />
      <path d="M52 19l10-3-5 10z" fill="#e5a72f" />
    </svg>
  );
}

/** Symbole et mot-symbole, sur fond violet nuit. */
export function Marque({ tailleSymbole = 32 }: { tailleSymbole?: number }) {
  return (
    <span className="mp-marque">
      <SymboleMarque taille={tailleSymbole} />
      <span className="mp-marque__mot">
        Cabinet<span className="mp-marque__or">Pilot</span>
      </span>
    </span>
  );
}
