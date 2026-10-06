import type { HTMLAttributes, ReactNode } from "react";

export interface CarteProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  titre?: ReactNode;
  /** Niveau du titre dans la page (2 par défaut). */
  niveauTitre?: 2 | 3 | 4;
  /** Zone à droite du titre (badge, bouton). */
  actions?: ReactNode;
  piedDePage?: ReactNode;
  children?: ReactNode;
}

export function Carte({
  titre,
  niveauTitre = 2,
  actions,
  piedDePage,
  className,
  children,
  ...reste
}: CarteProps) {
  const Titre = `h${niveauTitre}` as const;
  return (
    <section {...reste} className={className ? `mp-carte ${className}` : "mp-carte"}>
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
