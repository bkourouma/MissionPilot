import type { ReactNode } from "react";
import { Icone, type NomIcone } from "./Icone";

export type TonaliteStatut = "succes" | "attention" | "danger" | "neutre";

const ICONES: Record<TonaliteStatut, NomIcone> = {
  succes: "succes",
  attention: "attention",
  danger: "danger",
  neutre: "neutre",
};

export interface BadgeStatutProps {
  tonalite: TonaliteStatut;
  /** Texte toujours visible : la couleur et l'icône ne portent jamais seules le sens. */
  children: ReactNode;
  /** Masque l'icône (le texte reste). */
  sansIcone?: boolean;
}

/** Vert (succès), orange (attention), rouge (danger), gris (neutre). */
export function BadgeStatut({ tonalite, children, sansIcone = false }: BadgeStatutProps) {
  return (
    <span className={`mp-badge mp-badge--${tonalite}`}>
      {sansIcone ? null : <Icone nom={ICONES[tonalite]} taille={14} />}
      <span>{children}</span>
    </span>
  );
}
