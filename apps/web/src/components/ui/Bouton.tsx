import { useId, type ButtonHTMLAttributes, type ReactNode, type Ref } from "react";
import { T } from "../i18n/T";
import { accessibiliteBouton } from "./Bouton.aide";
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
  /**
   * Désactive le bouton, affiche un indicateur (à la place de l'icône) et `texteChargement`.
   * La largeur ne change pas : le plus long des deux textes la fixe.
   */
  chargement?: boolean;
  texteChargement?: string;
  icone?: NomIcone;
  /** Icône après le texte (ex. « Suivant »). */
  iconeFin?: NomIcone;
  /**
   * Explique pourquoi le bouton est désactivé (visible au survol, annoncé aux lecteurs d'écran).
   * Sans effet si le bouton n'est pas `disabled`.
   */
  raisonDesactive?: string;
  pleineLargeur?: boolean;
  children: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

export function Bouton({
  variante = "primaire",
  chargement = false,
  texteChargement,
  icone,
  iconeFin,
  raisonDesactive,
  pleineLargeur = false,
  type = "button",
  disabled,
  className,
  children,
  id,
  title,
  "aria-describedby": describedByAppelant,
  ...reste
}: BoutonProps) {
  const auto = useId();
  const a11y = accessibiliteBouton({
    id: id ?? auto,
    disabled,
    chargement,
    raisonDesactive,
    describedBy: describedByAppelant,
    title,
  });
  const classes = [classesBouton(variante, pleineLargeur), className ?? ""]
    .filter(Boolean)
    .join(" ");
  return (
    <>
      <button
        {...reste}
        id={id}
        type={type}
        className={classes}
        disabled={a11y.desactive}
        aria-busy={a11y.ariaBusy}
        aria-describedby={a11y.ariaDescribedBy}
        title={a11y.title}
      >
        {chargement ? (
          <span className="mp-bouton__indicateur" aria-hidden="true" />
        ) : icone ? (
          <Icone nom={icone} />
        ) : null}
        {/* Les deux textes occupent la même cellule : la largeur reste celle du plus long. */}
        <span className="mp-bouton__texte">
          <span className={chargement && texteChargement ? "mp-bouton__masque" : undefined}>
            {children}
          </span>
          {texteChargement ? (
            <span
              className={chargement ? undefined : "mp-bouton__masque"}
              aria-hidden={chargement ? undefined : true}
            >
              {texteChargement}
            </span>
          ) : null}
        </span>
        {chargement && !texteChargement ? (
          <span className="mp-visuellement-cache">
            <T fr="En cours…" en="In progress…" />
          </span>
        ) : null}
        {iconeFin ? <Icone nom={iconeFin} /> : null}
      </button>
      {/* Hors du bouton : le texte décrit le bouton sans entrer dans son nom accessible. */}
      {a11y.idRaison ? (
        <span id={a11y.idRaison} className="mp-visuellement-cache">
          {raisonDesactive}
        </span>
      ) : null}
    </>
  );
}
