import {
  ANALYSES_MODELE_LIBELLES,
  pointsParCategorie,
  type ModeleSecteur,
} from "../../lib/due-diligence-modeles";

/**
 * Encart discret des « points à examiner » du modèle du cabinet pour le secteur du dossier (DD-07).
 * Ne s'affiche que s'il existe un modèle ; ce sont des rappels, pas des constats du dossier.
 */
export function EncartModeleSecteur({ modeles }: { modeles: readonly ModeleSecteur[] }) {
  if (modeles.length === 0) return null;
  return (
    <details className="mp-dd-details">
      <summary>Points à examiner (modèle du cabinet pour ce secteur)</summary>
      <div className="mp-dd-details__corps mp-dd-pile">
        <p className="mp-texte-doux mp-texte-petit">
          Rappels rédigés par le cabinet : ils ne créent aucun point dans le dossier.
        </p>
        {modeles.map((m) => (
          <div key={m.id} className="mp-dd-pile">
            <p className="mp-texte-petit">
              {`${ANALYSES_MODELE_LIBELLES[m.analyse]}, version ${m.version}`}
            </p>
            {pointsParCategorie(m.analyse, m.points).map((g) => (
              <section key={g.categorie} aria-label={`${g.libelle}, points à examiner`}>
                <h4 className="mp-dd-categorie__titre">{g.libelle}</h4>
                <ul>
                  {g.points.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ))}
      </div>
    </details>
  );
}
