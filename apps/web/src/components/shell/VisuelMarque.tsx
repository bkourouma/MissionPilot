import { Marque } from "./Marque";

/**
 * Panneau de marque des pages d'accès (connexion, invitation) : logo, accroche, et la
 * trajectoire du logo en grand (cap prévu en tirets violets, cap réel en or). Le tracé est un
 * décor sans texte ; sur téléphone, seul le logo reste.
 */
export function VisuelMarque({ titre, texte }: { titre: string; texte: string }) {
  return (
    <aside className="mp-connexion__visuel">
      <Marque tailleSymbole={44} />
      <div className="mp-connexion__accroche">
        <h2>{titre}</h2>
        <p>{texte}</p>
      </div>
      <svg
        className="mp-connexion__trajectoire"
        viewBox="0 0 800 340"
        preserveAspectRatio="xMinYMax slice"
        aria-hidden="true"
        focusable="false"
      >
        <path
          d="M-10 330C170 336 420 300 640 190C720 150 770 110 800 80"
          fill="none"
          stroke="#5b2fc4"
          strokeWidth="3"
          strokeDasharray="10 12"
          strokeLinecap="round"
        />
        <path
          d="M-10 262C120 286 290 280 450 210C570 156 650 110 722 52"
          fill="none"
          stroke="#e5a72f"
          strokeWidth="6"
          strokeLinecap="round"
        />
        <path d="M741 28L704 36 735 79z" fill="#e5a72f" />
        <circle cx="300" cy="271" r="13" fill="#e5a72f" />
        <circle cx="300" cy="271" r="21" fill="#e5a72f" fillOpacity="0.22" />
      </svg>
    </aside>
  );
}
