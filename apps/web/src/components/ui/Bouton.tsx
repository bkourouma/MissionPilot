import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icone, type NomIcone } from "./Icone";

export type VarianteBouton = "primaire" | "secondaire" | "discret" | "danger";

/** Classes d'un bouton, réutilisables sur un lien (`<Link className={classesBouton()}>`). */
export function classesBouton(variante: VarianteBouton = "primaire", pleineLargeur = false) {
  return ["mp-bouton", `mp-bouton--${variante}`, pleineLargeur ? "mp-bouton--plein" : ""]
    .filter(Boolean)
    .join(" ");
}

export interface BoutonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: VarianteBouton;
  /** Désactive le bouton, affiche un indicateur et `texteChargement`. */
  chargement?: boolean;
  texteChargement?: string;
  icone?: NomIcone;
  pleineLargeur?: boolean;
  children: ReactNode;
}

export function Bouton({
  variante = "primaire",
  chargement = false,
  texteChargement,
  icone,
  pleineLargeur = false,
  type = "button",
  disabled,
  className,
  children,
  ...reste
}: BoutonProps) {
  const classes = classesBouton(variante, pleineLargeur);
  return (
    <button
      {...reste}
      type={type}
      className={className ? `${classes} ${className}` : classes}
      disabled={disabled || chargement}
      aria-busy={chargement || undefined}
    >
      {chargement ? (
        <span className="mp-bouton__indicateur" aria-hidden="true" />
      ) : icone ? (
        <Icone nom={icone} />
      ) : null}
      <span>{chargement && texteChargement ? texteChargement : children}</span>
    </button>
  );
}
