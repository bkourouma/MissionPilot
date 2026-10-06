import { formaterScore, type DonneesRapport } from "../../lib/notation";

export interface ForcesFaiblessesProps {
  forces: DonneesRapport["forces"];
  faiblesses: DonneesRapport["faiblesses"];
}

function Liste({
  titre,
  elements,
  vide,
}: {
  titre: string;
  elements: DonneesRapport["forces"];
  vide: string;
}) {
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
              <span className="mp-notation-chiffre">{formaterScore(d.score)} sur 100</span>
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
export function ForcesFaiblesses({ forces, faiblesses }: ForcesFaiblessesProps) {
  return (
    <div className="mp-notation__colonnes">
      <Liste titre="Points forts" elements={forces} vide="Aucune dimension n'atteint 65 sur 100." />
      <Liste
        titre="Points faibles"
        elements={faiblesses}
        vide="Aucune dimension sous 50 sur 100."
      />
    </div>
  );
}
