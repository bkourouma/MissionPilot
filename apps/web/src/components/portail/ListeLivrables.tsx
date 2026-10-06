import { affichableEnLigne, formaterTaille, libelleType } from "../../lib/fichiers";
import { formaterDate } from "../../lib/format";
import { hrefLivrable, libelleTypeLivrable, type LivrablePortail } from "../../lib/portail";
import { classesBouton } from "../ui/Bouton";
import { Icone } from "../ui/Icone";

/** « PDF · 1,2 Mo », ce qui est connu du fichier. */
function descriptionFichier(l: LivrablePortail): string | null {
  const morceaux = [
    l.type_mime ? libelleType(l.type_mime, l.nom) : null,
    l.taille !== null ? formaterTaille(l.taille) : null,
  ].filter(Boolean);
  return morceaux.length > 0 ? morceaux.join(" · ") : null;
}

/**
 * Documents partagés d'une mission : téléchargement (et ouverture dans un onglet pour un PDF
 * ou une image). Liens de même origine : le cookie de session httpOnly part tout seul ; l'API
 * revérifie le partage à chaque téléchargement.
 */
export function ListeLivrables({
  livrables,
  idTitre,
}: {
  livrables: readonly LivrablePortail[];
  idTitre: string;
}) {
  return (
    <ul className="mp-liste-lignes" aria-labelledby={idTitre}>
      {livrables.map((l) => {
        const fichier = descriptionFichier(l);
        return (
          <li key={l.id} className="mp-liste-lignes__ligne">
            <div className="mp-liste-lignes__texte">
              <span className="mp-portail-ligne__titre">{l.nom}</span>
              <span className="mp-portail-ligne__detail">
                {`${libelleTypeLivrable(l.type)} · version ${l.version} · déposé le ${formaterDate(l.depose_le, "Africa/Abidjan")}`}
              </span>
              {fichier ? <span className="mp-portail-ligne__detail">{fichier}</span> : null}
            </div>
            <div className="mp-portail-ligne__actions">
              {l.telechargeable ? (
                <>
                  {l.type_mime && affichableEnLigne(l.type_mime) ? (
                    <a
                      href={hrefLivrable(l.id, "inline")}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={classesBouton("discret")}
                    >
                      <Icone nom="oeil" />
                      <span>Ouvrir</span>
                      <span className="mp-visuellement-cache"> {l.nom} (nouvel onglet)</span>
                    </a>
                  ) : null}
                  <a href={hrefLivrable(l.id)} className={classesBouton("secondaire")}>
                    <Icone nom="telechargement" />
                    <span>Télécharger</span>
                    <span className="mp-visuellement-cache"> {l.nom}</span>
                  </a>
                </>
              ) : (
                <span className="mp-texte-doux mp-texte-petit">Fichier pas encore disponible</span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
