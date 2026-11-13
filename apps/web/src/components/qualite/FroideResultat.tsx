import {
  formaterCouverture,
  formaterScore,
  libelleConclusion,
  libelleCritere,
  libelleMotifRevue,
  tonaliteConclusion,
  type ResultatMoteur,
} from "../../lib/qualite-froide";
import { obtenirLangue, obtenirT } from "../../lib/i18n/serveur";
import { BadgeStatut } from "../ui/BadgeStatut";

/**
 * Résultat du moteur de calcul (score, couverture, conclusion, motifs). Aucun chiffre n'est
 * recalculé ici ni produit par un modèle de langage : l'API renvoie ce que le moteur a calculé.
 */
export async function FroideResultat({
  resultat,
  definitif,
}: {
  resultat: ResultatMoteur;
  definitif: boolean;
}) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  return (
    <div className="mp-froide__pile" aria-live="polite">
      <p className="mp-texte-doux mp-texte-petit">
        {definitif
          ? t(
              "Résultat figé de la revue : calculé par le moteur de calcul, pas par l'IA.",
              "Frozen review result: computed by the calculation engine, not by AI.",
            )
          : t(
              "Résultat provisoire : calculé par le moteur de calcul, pas par l'IA.",
              "Provisional result: computed by the calculation engine, not by AI.",
            )}
      </p>
      <div className="mp-froide__ligne">
        <BadgeStatut tonalite={tonaliteConclusion(resultat.conclusion)}>
          {libelleConclusion(resultat.conclusion, langue)}
        </BadgeStatut>
        <span>
          {t("Score", "Score")} : {formaterScore(resultat.score, langue)}
        </span>
        <span>
          {t("Couverture de la grille", "Grid coverage")} :{" "}
          {formaterCouverture(resultat.couverture, langue)}
        </span>
      </div>
      {!resultat.complete && resultat.manquants.length > 0 ? (
        <p>
          {t("Critères restant à évaluer", "Criteria still to assess")} :{" "}
          {resultat.manquants.map((c) => libelleCritere(c, langue)).join(" ; ")}.
        </p>
      ) : null}
      {resultat.motifs.length > 0 ? (
        <ul>
          {resultat.motifs.map((m, i) => (
            <li key={i}>{libelleMotifRevue(m, langue)}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
