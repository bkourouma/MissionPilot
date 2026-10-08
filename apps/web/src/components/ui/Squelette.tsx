export interface SqueletteProps {
  /** Nombre de lignes de texte simulées. */
  lignes?: number;
  /** Bloc de titre au-dessus des lignes. */
  avecTitre?: boolean;
  /** Message annoncé aux lecteurs d'écran. */
  libelle?: string;
}

/**
 * Espace réservé pendant un chargement. Les formes sont masquées aux technologies
 * d'assistance ; seul `libelle` est annoncé (role="status"). L'animation est coupée si
 * l'utilisateur préfère réduire les animations.
 */
export function Squelette({
  lignes = 3,
  avecTitre = false,
  libelle = "Chargement…",
}: SqueletteProps) {
  return (
    <div className="mp-squelette" role="status">
      <span className="mp-visuellement-cache">{libelle}</span>
      <div aria-hidden="true">
        {avecTitre ? <div className="mp-squelette__forme mp-squelette__titre" /> : null}
        {Array.from({ length: lignes }, (_, i) => (
          <div
            key={i}
            className="mp-squelette__forme mp-squelette__ligne"
            style={{ width: i === lignes - 1 && lignes > 1 ? "60%" : "100%" }}
          />
        ))}
      </div>
    </div>
  );
}
