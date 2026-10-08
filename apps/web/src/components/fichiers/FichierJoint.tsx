import {
  affichableEnLigne,
  formaterTaille,
  hrefFichier,
  libelleType,
  type FichierMeta,
} from "../../lib/fichiers";
import { Icone } from "../ui/Icone";

export interface FichierJointProps {
  fichier: Pick<FichierMeta, "id" | "nom" | "type_mime" | "taille">;
  /** Texte avant le nom, ex. « Justificatif ». */
  prefixe?: string;
  /** Contexte ajouté aux noms accessibles des liens, ex. « du débours Taxi ». */
  contexte?: string;
}

/**
 * Fichier rattaché : nom, type, taille, et liens authentifiés (même origine, cookie httpOnly)
 * ouverts dans un nouvel onglet sans accès à cette page (`noopener`). Le lien de
 * téléchargement est toujours présent : certains navigateurs refusent d'afficher un PDF servi
 * sous la politique de sécurité « sandbox » de l'API.
 */
export function FichierJoint({ fichier: f, prefixe, contexte }: FichierJointProps) {
  const suffixe = contexte ? ` ${contexte}` : "";
  return (
    <span className="mp-fichier-joint">
      <Icone nom="trombone" taille={18} />
      <span className="mp-fichier-joint__texte">
        <span className="mp-coupure">
          {prefixe ? <span className="mp-texte-doux">{`${prefixe} : `}</span> : null}
          {f.nom}
        </span>
        <span className="mp-texte-doux mp-texte-petit">
          {`${libelleType(f.type_mime, f.nom)} · ${formaterTaille(f.taille)}`}
        </span>
      </span>
      <span className="mp-fichier-joint__liens">
        {affichableEnLigne(f.type_mime) ? (
          <a
            className="mp-lien-action"
            href={hrefFichier(f.id, "inline")}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Ouvrir ${f.nom}${suffixe} (nouvel onglet)`}
          >
            <Icone nom="oeil" taille={18} />
            <span>Ouvrir</span>
          </a>
        ) : null}
        <a
          className="mp-lien-action"
          href={hrefFichier(f.id, "attachment")}
          target="_blank"
          rel="noopener noreferrer"
          download={f.nom}
          aria-label={`Télécharger ${f.nom}${suffixe}`}
        >
          <Icone nom="telechargement" taille={18} />
          <span>Télécharger</span>
        </a>
      </span>
    </span>
  );
}
