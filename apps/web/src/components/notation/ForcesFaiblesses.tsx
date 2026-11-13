import { obtenirLangue, obtenirT } from "../../lib/i18n/serveur";
import { formaterScore, type DonneesRapport } from "../../lib/notation";

export interface ForcesFaiblessesProps {
  forces: DonneesRapport["forces"];
  faiblesses: DonneesRapport["faiblesses"];
}

async function Liste({
  titre,
  elements,
  vide,
}: {
  titre: string;
  elements: DonneesRapport["forces"];
  vide: string;
}) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  return (
    <section className="mp-notation__section" aria-label={titre}>
      <h3 className="mp-notation-barres__famille">{titre}</h3>
      {elements.length === 0 ? (
        <p className="mp-texte-doux">{vide}</p>
      ) : (
        <ul className="mp-notation-liste">
          {elements.map((d) => (
            <li key={d.dimension}>
              <span>{d.libelle}</span>
              <span className="mp-notation-chiffre">
                {formaterScore(d.score, langue)} {t("sur 100", "out of 100")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Points forts (score de 65 et plus, du meilleur au moins bon) et points faibles (score sous
 * 50, du plus faible au moins faible), listés et ordonnés par le moteur.
 */
export async function ForcesFaiblesses({ forces, faiblesses }: ForcesFaiblessesProps) {
  const t = await obtenirT();
  return (
    <div className="mp-notation__colonnes">
      <Liste
        titre={t("Points forts", "Strengths")}
        elements={forces}
        vide={t("Aucune dimension n'atteint 65 sur 100.", "No dimension reaches 65 out of 100.")}
      />
      <Liste
        titre={t("Points faibles", "Weaknesses")}
        elements={faiblesses}
        vide={t("Aucune dimension sous 50 sur 100.", "No dimension below 50 out of 100.")}
      />
    </div>
  );
}
