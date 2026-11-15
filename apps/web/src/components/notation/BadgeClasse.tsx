import { obtenirLangue } from "../../lib/i18n/serveur";
import { detailClasse, estClasse, tonaliteClasse, type Classe } from "../../lib/notation";

export interface BadgeClasseProps {
  classe: Classe | null | undefined;
  /** Grand format (score global) : pastille de la lettre plus grande. */
  grand?: boolean;
}

/**
 * Classe A à E : la lettre ET son libellé sont toujours écrits (la couleur ne porte jamais
 * seule le sens). Sans classe : « Non notable ». Composant serveur (jamais rendu par un client).
 */
export async function BadgeClasse({ classe, grand = false }: BadgeClasseProps) {
  const langue = await obtenirLangue();
  const en = langue === "en";
  if (!estClasse(classe)) {
    return <span className="mp-badge mp-badge--neutre">{en ? "Not rated" : "Non notable"}</span>;
  }
  const { libelle } = detailClasse(classe, langue);
  if (!grand) {
    return (
      <span className={`mp-badge mp-badge--${tonaliteClasse(classe)}`}>
        <span className="mp-visuellement-cache">{en ? "Class " : "Classe "}</span>
        {classe} — {libelle}
      </span>
    );
  }
  return (
    <span className={`mp-notation-classe mp-notation-classe--${tonaliteClasse(classe)}`}>
      <span className="mp-visuellement-cache">{en ? "Class " : "Classe "}</span>
      <span className="mp-notation-classe__lettre">{classe}</span>
      <span>{libelle}</span>
    </span>
  );
}
