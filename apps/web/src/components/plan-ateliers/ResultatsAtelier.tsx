import {
  formaterCentiemes,
  formaterTauxCentiemes,
  libelleOption,
  libelleQuadrant,
  lignesParRang,
  type OptionAtelierApi,
  type ResultatsAtelier as Resultats,
} from "../../lib/plan-ateliers";
import { Carte } from "../ui/Carte";
import { Tableau } from "../ui/Tableau";

export interface ResultatsAtelierProps {
  resultats: Resultats;
  options: readonly Pick<OptionAtelierApi, "id" | "libelle">[];
}

const participation = (p: {
  participants: number;
  invites: number;
  tauxCentiemesPourcent: number | null;
}) =>
  `${p.participants} participant${p.participants > 1 ? "s" : ""} sur ${p.invites} invité${p.invites > 1 ? "s" : ""} (${formaterTauxCentiemes(p.tauxCentiemesPourcent)})`;

/**
 * Résultats figés d'un atelier clos : agrégats du moteur de calcul, jamais une contribution
 * individuelle (le vote est anonyme). Composant d'affichage pur : aucun calcul.
 */
export function ResultatsAtelier({ resultats, options }: ResultatsAtelierProps) {
  const nom = (id: string) => libelleOption(options, id);
  const { vote, priorisation, matrice } = resultats;
  return (
    <div className="mp-pile">
      {vote ? (
        <Carte titre="Vote par points" niveauTitre={3}>
          <p className="mp-texte-doux">{`${participation(vote.resultat.participation)} · ${vote.resultat.totalPoints} points répartis.`}</p>
          <Tableau
            legende="Résultats du vote par points"
            lignes={lignesParRang(vote.resultat.options)}
            cleLigne={(l) => l.optionId}
            colonnes={[
              { cle: "rang", entete: "Rang", alignement: "droite" },
              { cle: "option", entete: "Option", rendu: (l) => nom(l.optionId) },
              { cle: "points", entete: "Points", alignement: "droite" },
              { cle: "votants", entete: "Votants", alignement: "droite" },
              {
                cle: "part",
                entete: "Part des points",
                alignement: "droite",
                rendu: (l) => formaterTauxCentiemes(l.partCentiemesPourcent),
              },
            ]}
          />
        </Carte>
      ) : null}
      {priorisation ? (
        <Carte titre="Priorisation par classement" niveauTitre={3}>
          <p className="mp-texte-doux">{participation(priorisation.resultat.participation)}</p>
          <Tableau
            legende="Résultats de la priorisation par classement"
            lignes={lignesParRang(priorisation.resultat.options)}
            cleLigne={(l) => l.optionId}
            colonnes={[
              { cle: "rang", entete: "Rang", alignement: "droite" },
              { cle: "option", entete: "Option", rendu: (l) => nom(l.optionId) },
              { cle: "pointsBorda", entete: "Points (Borda)", alignement: "droite" },
              {
                cle: "rangMoyen",
                entete: "Rang moyen",
                alignement: "droite",
                rendu: (l) => formaterCentiemes(l.rangMoyenCentiemes),
              },
              { cle: "foisPremiere", entete: "Fois première", alignement: "droite" },
            ]}
          />
        </Carte>
      ) : null}
      {matrice ? (
        <Carte titre="Matrice" niveauTitre={3}>
          <p className="mp-texte-doux">
            {`${participation(matrice.resultat.participation)} · axes : ${matrice.resultat.axes.x.libelle} et ${matrice.resultat.axes.y.libelle}.`}
          </p>
          <Tableau
            legende="Résultats de la matrice"
            lignes={lignesParRang(matrice.resultat.options)}
            cleLigne={(l) => l.optionId}
            colonnes={[
              { cle: "rang", entete: "Rang", alignement: "droite" },
              { cle: "option", entete: "Option", rendu: (l) => nom(l.optionId) },
              {
                cle: "quadrant",
                entete: "Quadrant",
                rendu: (l) => libelleQuadrant(l.quadrant),
              },
              {
                cle: "x",
                entete: matrice.resultat.axes.x.libelle,
                alignement: "droite",
                rendu: (l) => formaterCentiemes(l.moyenneXCentiemes),
              },
              {
                cle: "y",
                entete: matrice.resultat.axes.y.libelle,
                alignement: "droite",
                rendu: (l) => formaterCentiemes(l.moyenneYCentiemes),
              },
              {
                cle: "consensus",
                entete: "Consensus",
                rendu: (l) => (l.quadrant === null ? "—" : l.consensus ? "Oui" : "Non"),
              },
            ]}
          />
        </Carte>
      ) : null}
    </div>
  );
}
