import { obtenirLangue, obtenirT } from "../../lib/i18n/serveur";
import { affichableEnLigne, formaterTaille, libelleType } from "../../lib/fichiers";
import { formaterDate } from "../../lib/format";
import { hrefLivrable, libelleTypeLivrable, type LivrablePortail } from "../../lib/portail";
import type { Langue } from "@missionpilot/shared";
import { classesBouton } from "../ui/Bouton";
import { Icone } from "../ui/Icone";

/** « PDF · 1,2 Mo », ce qui est connu du fichier. */
function descriptionFichier(l: LivrablePortail, langue: Langue): string | null {
  const morceaux = [
    l.type_mime ? libelleType(l.type_mime, l.nom, langue) : null,
    l.taille !== null ? formaterTaille(l.taille, langue) : null,
  ].filter(Boolean);
  return morceaux.length > 0 ? morceaux.join(" · ") : null;
}

/**
 * Documents partagés d'une mission : téléchargement (et ouverture dans un onglet pour un PDF
 * ou une image). Liens de même origine : le cookie de session httpOnly part tout seul ; l'API
 * revérifie le partage à chaque téléchargement.
 */
export async function ListeLivrables({
  livrables,
  idTitre,
}: {
  livrables: readonly LivrablePortail[];
  idTitre: string;
}) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  return (
    <ul className="mp-liste-lignes" aria-labelledby={idTitre}>
      {livrables.map((l) => {
        const fichier = descriptionFichier(l, langue);
        return (
          <li key={l.id} className="mp-liste-lignes__ligne">
            <div className="mp-liste-lignes__texte">
              <span className="mp-portail-ligne__titre">{l.nom}</span>
              <span className="mp-portail-ligne__detail">
                {t(
                  `${libelleTypeLivrable(l.type)} · version ${l.version} · déposé le ${formaterDate(l.depose_le, "Africa/Abidjan")}`,
                  `${libelleTypeLivrable(l.type, langue)} · version ${l.version} · uploaded on ${formaterDate(l.depose_le, "Africa/Abidjan", langue)}`,
                )}
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
                      <span>{t("Ouvrir", "Open")}</span>
                      <span className="mp-visuellement-cache">
                        {" "}
                        {l.nom} {t("(nouvel onglet)", "(new tab)")}
                      </span>
                    </a>
                  ) : null}
                  <a href={hrefLivrable(l.id)} className={classesBouton("secondaire")}>
                    <Icone nom="telechargement" />
                    <span>{t("Télécharger", "Download")}</span>
                    <span className="mp-visuellement-cache"> {l.nom}</span>
                  </a>
                </>
              ) : (
                <span className="mp-texte-doux mp-texte-petit">
                  {t("Fichier pas encore disponible", "File not yet available")}
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
