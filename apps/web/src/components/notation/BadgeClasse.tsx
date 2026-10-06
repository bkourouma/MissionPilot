import { CLASSES, estClasse, tonaliteClasse, type Classe } from "../../lib/notation";

export interface BadgeClasseProps {
  classe: Classe | null | undefined;
  /** Grand format (score global) : pastille de la lettre plus grande. */
  grand?: boolean;
}

/**
 * Classe A à E : la lettre ET son libellé sont toujours écrits (la couleur ne porte jamais
 * seule le sens). Sans classe : « Non notable ».
 */
export function BadgeClasse({ classe, grand = false }: BadgeClasseProps) {
  if (!estClasse(classe)) {
    return <span className="mp-badge mp-badge--neutre">Non notable</span>;
  }
  const { libelle } = CLASSES[classe];
  if (!grand) {
    return (
      <span className={`mp-badge mp-badge--${tonaliteClasse(classe)}`}>
        <span className="mp-visuellement-cache">Classe </span>
        {classe} — {libelle}
      </span>
    );
  }
  return (
    <span className={`mp-notation-classe mp-notation-classe--${tonaliteClasse(classe)}`}>
      <span className="mp-visuellement-cache">Classe </span>
      <span className="mp-notation-classe__lettre">{classe}</span>
      <span>{libelle}</span>
    </span>
  );
}
