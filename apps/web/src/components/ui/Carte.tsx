import type { HTMLAttributes, ReactNode } from "react";

export interface CarteProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  titre?: ReactNode;
  /** Niveau du titre dans la page (2 par défaut). */
  niveauTitre?: 2 | 3 | 4;
  /** Zone à droite du titre (badge, bouton). */
  actions?: ReactNode;
  piedDePage?: ReactNode;
  /**
   * Ton de la carte : « creux » (lavande profonde, module indisponible ou zone secondaire) ou
   * fond de statut (« info », « attention », « danger »). Le sens ne passe jamais par la couleur
   * seule : mettre aussi un titre ou une icône explicite.
   */
  ton?: TonCarte;
  /** Marges et écarts réduits (listes denses, cartes imbriquées). */
  dense?: boolean;
  children?: ReactNode;
}

export type TonCarte = "defaut" | "creux" | "info" | "attention" | "danger";

export function Carte({
  titre,
  niveauTitre = 2,
  actions,
  piedDePage,
  ton = "defaut",
  dense = false,
  className,
  children,
  ...reste
}: CarteProps) {
  const Titre = `h${niveauTitre}` as const;
  const classes = [
    "mp-carte",
    ton !== "defaut" ? `mp-carte--${ton}` : "",
    dense ? "mp-carte--dense" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <section {...reste} className={classes}>
      {titre || actions ? (
        <header className="mp-carte__entete">
          {titre ? <Titre className="mp-carte__titre">{titre}</Titre> : null}
          {actions ? <div className="mp-carte__actions">{actions}</div> : null}
        </header>
      ) : null}
      {children ? <div className="mp-carte__corps">{children}</div> : null}
      {piedDePage ? <footer className="mp-carte__pied">{piedDePage}</footer> : null}
    </section>
  );
}
