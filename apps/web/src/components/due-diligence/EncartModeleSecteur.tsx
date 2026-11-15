import { creerTraduire } from "@missionpilot/shared";
import {
  ANALYSES_MODELE_LIBELLES,
  ANALYSES_MODELE_LIBELLES_EN,
  pointsParCategorie,
  type ModeleSecteur,
} from "../../lib/due-diligence-modeles";
import { obtenirLangue } from "../../lib/i18n/serveur";

/**
 * Encart discret des « points à examiner » du modèle du cabinet pour le secteur du dossier (DD-07).
 * Ne s'affiche que s'il existe un modèle ; ce sont des rappels, pas des constats du dossier.
 */
export async function EncartModeleSecteur({ modeles }: { modeles: readonly ModeleSecteur[] }) {
  if (modeles.length === 0) return null;
  const langue = await obtenirLangue();
  const t = creerTraduire(langue);
  const analyses = langue === "en" ? ANALYSES_MODELE_LIBELLES_EN : ANALYSES_MODELE_LIBELLES;
  return (
    <details className="mp-dd-details">
      <summary>
        {t(
          "Points à examiner (modèle du cabinet pour ce secteur)",
          "Points to examine (firm template for this sector)",
        )}
      </summary>
      <div className="mp-dd-details__corps mp-dd-pile">
        <p className="mp-texte-doux mp-texte-petit">
          {t(
            "Rappels rédigés par le cabinet : ils ne créent aucun point dans le dossier.",
            "Reminders written by the firm: they do not create any item in the file.",
          )}
        </p>
        {modeles.map((m) => (
          <div key={m.id} className="mp-dd-pile">
            <p className="mp-texte-petit">
              {`${analyses[m.analyse]}, ${t("version", "version")} ${m.version}`}
            </p>
            {pointsParCategorie(m.analyse, m.points, langue).map((g) => (
              <section
                key={g.categorie}
                aria-label={t(`${g.libelle}, points à examiner`, `${g.libelle}, points to examine`)}
              >
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
