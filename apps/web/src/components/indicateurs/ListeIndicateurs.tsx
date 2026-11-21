import { creerTraduire, type Langue } from "@missionpilot/shared";
import { messageReserve, type IndicateurAffiche } from "../../lib/indicateurs";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Icone } from "../ui/Icone";
import "./tableau-de-bord.css";

/**
 * Indicateurs du cabinet en liste lisible (une ligne par indicateur : libellé et définition à
 * gauche, valeur en chiffres tabulaires alignée à droite, statut en texte et icône). Remplace la
 * rangée de cartes de chiffres identiques sur l'accueil ; mêmes données que `GrilleIndicateurs`.
 * Un indicateur absent de la réponse (droit manquant) affiche un message neutre, sans valeur.
 */
export function ListeIndicateurs({
  indicateurs,
  langue = "fr",
  idTitre,
}: {
  indicateurs: readonly IndicateurAffiche[];
  langue?: Langue;
  /** Identifiant du titre qui nomme la liste (aria-labelledby). */
  idTitre?: string;
}) {
  const t = creerTraduire(langue);
  if (indicateurs.length === 0) {
    return (
      <p className="mp-tdb-vide mp-texte-doux" role="status">
        {t("Aucun indicateur à afficher.", "No indicator to display.")}
      </p>
    );
  }
  return (
    <ul className="mp-tdb-kpi" aria-labelledby={idTitre}>
      {indicateurs.map((i) => {
        const d = i.definition;
        return (
          <li key={d.id} className="mp-tdb-kpi__ligne">
            <h4 className="mp-tdb-kpi__titre">{d.libelle}</h4>
            <p className="mp-tdb-kpi__definition">{d.definition}</p>
            {i.present ? (
              <>
                <p className="mp-tdb-kpi__valeur">{i.valeur}</p>
                {i.statut || i.detail ? (
                  <div className="mp-tdb-kpi__etat">
                    {i.statut ? (
                      <BadgeStatut tonalite={i.statut.tonalite}>{i.statut.libelle}</BadgeStatut>
                    ) : null}
                    {i.detail ? <p className="mp-tdb-kpi__detail">{i.detail}</p> : null}
                  </div>
                ) : null}
              </>
            ) : (
              <p className="mp-tdb-kpi__reserve">
                <Icone nom="cadenas" taille={16} />
                <span>{messageReserve(langue)}</span>
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
