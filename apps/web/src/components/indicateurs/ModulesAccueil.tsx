import Link from "next/link";
import { creerTraduire, type Langue } from "@missionpilot/shared";
import { descriptionEntree, libelleEntree, type EntreeNavigation } from "../../lib/navigation";
import { EtatVide } from "../ui/EtatListe";
import { Icone } from "../ui/Icone";
import { pluriel, type RepartitionModules } from "./modules-accueil";
import "./tableau-de-bord.css";

/** Tuile dense : icône, libellé (lien sur toute la tuile) et description courte. */
function Tuile({
  entree,
  langue,
  quotidien = false,
}: {
  entree: EntreeNavigation;
  langue: Langue;
  quotidien?: boolean;
}) {
  const idDescription = `module-${entree.id}-description`;
  const description = descriptionEntree(entree, langue);
  const classes = [
    "mp-tdb-tuile",
    quotidien ? "mp-tdb-tuile--quotidien" : "",
    entree.disponible ? "" : "mp-tdb-tuile--indisponible",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <li className={classes}>
      <span className="mp-tdb-tuile__icone">
        <Icone nom={entree.icone} taille={20} />
      </span>
      <div className="mp-tdb-tuile__texte">
        {entree.disponible ? (
          <Link href={entree.href} className="mp-tdb-tuile__lien" aria-describedby={idDescription}>
            {libelleEntree(entree, langue)}
          </Link>
        ) : (
          <span className="mp-tdb-tuile__nom">{libelleEntree(entree, langue)}</span>
        )}
        <p id={idDescription} className="mp-tdb-tuile__description" title={description}>
          {description}
        </p>
      </div>
    </li>
  );
}

function ListeTuiles({
  entrees,
  langue,
  quotidien = false,
}: {
  entrees: readonly EntreeNavigation[];
  langue: Langue;
  quotidien?: boolean;
}) {
  return (
    <ul className="mp-tdb-tuiles">
      {entrees.map((e) => (
        <Tuile key={e.id} entree={e} langue={langue} quotidien={quotidien} />
      ))}
    </ul>
  );
}

/**
 * Accès aux modules : les modules du quotidien d'abord, puis les autres par métier, en tuiles
 * denses ; les modules « pas encore disponibles » sont repliés (fermés par défaut) avec leur
 * nombre pour ne pas se mélanger aux modules utilisables.
 */
export function ModulesAccueil({
  repartition,
  langue,
}: {
  repartition: RepartitionModules;
  langue: Langue;
}) {
  const t = creerTraduire(langue);
  const { quotidien, groupes, indisponibles, nbDisponibles } = repartition;
  const vide = nbDisponibles === 0 && indisponibles.length === 0;
  return (
    <section aria-labelledby="titre-modules" className="mp-tdb-modules">
      <div className="mp-tdb-section__entete">
        <h2 id="titre-modules" className="mp-section__titre">
          {t("Vos modules", "Your modules")}
        </h2>
        {nbDisponibles > 0 ? (
          <p className="mp-texte-doux mp-tdb-modules__compte">
            {t(
              `${nbDisponibles} module${pluriel(nbDisponibles) ? "s" : ""} accessible${pluriel(nbDisponibles) ? "s" : ""} avec votre rôle`,
              `${nbDisponibles} module${pluriel(nbDisponibles) ? "s" : ""} available with your role`,
            )}
          </p>
        ) : null}
      </div>

      {vide ? (
        <EtatVide
          titre={t("Aucun module pour votre rôle", "No module for your role")}
          icone="dossier"
        >
          <p>
            {t(
              "Votre rôle ne donne accès à aucun module pour l'instant. Demandez à un administrateur du cabinet d'ajuster vos droits.",
              "Your role does not give access to any module yet. Ask a firm administrator to adjust your access.",
            )}
          </p>
        </EtatVide>
      ) : (
        <>
          {quotidien.length > 0 ? (
            <div className="mp-tdb-groupe">
              <h3 className="mp-tdb-groupe__titre">{t("Au quotidien", "Every day")}</h3>
              <ListeTuiles entrees={quotidien} langue={langue} quotidien />
            </div>
          ) : null}

          {groupes.map((g) => (
            <div key={g.id} className="mp-tdb-groupe">
              <h3 className="mp-tdb-groupe__titre">{g.libelle}</h3>
              <ListeTuiles entrees={g.entrees} langue={langue} />
            </div>
          ))}

          {indisponibles.length > 0 ? (
            <details className="mp-tdb-indisponibles">
              <summary className="mp-tdb-indisponibles__resume">
                <span>{t("Pas encore disponibles", "Not yet available")}</span>
                <span className="mp-tdb-indisponibles__compteur">{indisponibles.length}</span>
              </summary>
              <p className="mp-texte-doux">
                {t(
                  "Ces modules seront ouverts au fil des livraisons.",
                  "These modules will open as releases are delivered.",
                )}
              </p>
              <ListeTuiles entrees={indisponibles} langue={langue} />
            </details>
          ) : null}
        </>
      )}
    </section>
  );
}
