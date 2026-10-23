import {
  formaterCouverture,
  formaterScore,
  libelleConclusion,
  libelleCritere,
  libelleMotifRevue,
  tonaliteConclusion,
  type ResultatMoteur,
} from "../../lib/qualite-froide";
import { BadgeStatut } from "../ui/BadgeStatut";

/**
 * Résultat du moteur de calcul (score, couverture, conclusion, motifs). Aucun chiffre n'est
 * recalculé ici ni produit par un modèle de langage : l'API renvoie ce que le moteur a calculé.
 */
export function FroideResultat({
  resultat,
  definitif,
}: {
  resultat: ResultatMoteur;
  definitif: boolean;
}) {
  return (
    <div className="mp-froide__pile" aria-live="polite">
      <p className="mp-texte-doux mp-texte-petit">
        {definitif ? "Résultat figé de la revue" : "Résultat provisoire"} : calculé par le moteur de
        calcul, pas par l&apos;IA.
      </p>
      <div className="mp-froide__ligne">
        <BadgeStatut tonalite={tonaliteConclusion(resultat.conclusion)}>
          {libelleConclusion(resultat.conclusion)}
        </BadgeStatut>
        <span>Score : {formaterScore(resultat.score)}</span>
        <span>Couverture de la grille : {formaterCouverture(resultat.couverture)}</span>
      </div>
      {!resultat.complete && resultat.manquants.length > 0 ? (
        <p>
          Critères restant à évaluer :{" "}
          {resultat.manquants.map((c) => libelleCritere(c)).join(" ; ")}.
        </p>
      ) : null}
      {resultat.motifs.length > 0 ? (
        <ul>
          {resultat.motifs.map((m, i) => (
            <li key={i}>{libelleMotifRevue(m)}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
