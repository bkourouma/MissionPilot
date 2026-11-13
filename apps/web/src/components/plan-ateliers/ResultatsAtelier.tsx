import type { Langue } from "@missionpilot/shared";
import {
  formaterCentiemes,
  formaterTauxCentiemes,
  libelleOption,
  libelleQuadrant,
  phraseMasque,
  lignesParRang,
  type MethodeMasquee,
  type OptionAtelierApi,
  type ResultatsAtelier as Resultats,
} from "../../lib/plan-ateliers";
import { obtenirLangue } from "../../lib/i18n/serveur";
import { Carte } from "../ui/Carte";
import { Tableau } from "../ui/Tableau";

export interface ResultatsAtelierProps {
  resultats: Resultats;
  options: readonly Pick<OptionAtelierApi, "id" | "libelle">[];
}

const participation = (
  p: {
    participants: number;
    invites: number;
    tauxCentiemesPourcent: number | null;
  },
  langue: Langue,
) =>
  langue === "en"
    ? `${p.participants} ${p.participants > 1 ? "participants" : "participant"} out of ${p.invites} invited (${formaterTauxCentiemes(p.tauxCentiemesPourcent, langue)})`
    : `${p.participants} participant${p.participants > 1 ? "s" : ""} sur ${p.invites} invité${p.invites > 1 ? "s" : ""} (${formaterTauxCentiemes(p.tauxCentiemesPourcent)})`;

/**
 * Résultats figés d'un atelier clos : agrégats du moteur de calcul, jamais une contribution
 * individuelle (le vote est anonyme). Composant d'affichage pur : aucun calcul.
 */
/** Méthode sous le seuil de participants : message seul, aucun chiffre. */
function CarteMasquee({
  titre,
  masque,
  langue,
}: {
  titre: string;
  masque: MethodeMasquee;
  langue: Langue;
}) {
  return (
    <Carte titre={titre} niveauTitre={3}>
      <p className="mp-texte-doux">{phraseMasque(masque.seuil_participants, langue)}</p>
    </Carte>
  );
}

export async function ResultatsAtelier({ resultats, options }: ResultatsAtelierProps) {
  const langue = await obtenirLangue();
  const t = (fr: string, en: string) => (langue === "en" ? en : fr);
  const nom = (id: string) => libelleOption(options, id, langue);
  const { vote, priorisation, matrice } = resultats;
  return (
    <div className="mp-pile">
      {vote && vote.resultat === null ? (
        <CarteMasquee titre={t("Vote par points", "Point voting")} masque={vote} langue={langue} />
      ) : vote ? (
        <Carte titre={t("Vote par points", "Point voting")} niveauTitre={3}>
          <p className="mp-texte-doux">{`${participation(vote.resultat.participation, langue)} · ${vote.resultat.totalPoints} ${t("points répartis", "points allocated")}.`}</p>
          <Tableau
            legende={t("Résultats du vote par points", "Point voting results")}
            lignes={lignesParRang(vote.resultat.options)}
            cleLigne={(l) => l.optionId}
            colonnes={[
              { cle: "rang", entete: t("Rang", "Rank"), alignement: "droite" },
              { cle: "option", entete: t("Option", "Option"), rendu: (l) => nom(l.optionId) },
              { cle: "points", entete: t("Points", "Points"), alignement: "droite" },
              { cle: "votants", entete: t("Votants", "Voters"), alignement: "droite" },
              {
                cle: "part",
                entete: t("Part des points", "Share of points"),
                alignement: "droite",
                rendu: (l) => formaterTauxCentiemes(l.partCentiemesPourcent, langue),
              },
            ]}
          />
        </Carte>
      ) : null}
      {priorisation && priorisation.resultat === null ? (
        <CarteMasquee
          titre={t("Priorisation par classement", "Ranking")}
          masque={priorisation}
          langue={langue}
        />
      ) : priorisation ? (
        <Carte titre={t("Priorisation par classement", "Ranking")} niveauTitre={3}>
          <p className="mp-texte-doux">
            {participation(priorisation.resultat.participation, langue)}
          </p>
          <Tableau
            legende={t("Résultats de la priorisation par classement", "Ranking results")}
            lignes={lignesParRang(priorisation.resultat.options)}
            cleLigne={(l) => l.optionId}
            colonnes={[
              { cle: "rang", entete: t("Rang", "Rank"), alignement: "droite" },
              { cle: "option", entete: t("Option", "Option"), rendu: (l) => nom(l.optionId) },
              {
                cle: "pointsBorda",
                entete: t("Points (Borda)", "Points (Borda)"),
                alignement: "droite",
              },
              {
                cle: "rangMoyen",
                entete: t("Rang moyen", "Average rank"),
                alignement: "droite",
                rendu: (l) => formaterCentiemes(l.rangMoyenCentiemes, langue),
              },
              {
                cle: "foisPremiere",
                entete: t("Fois première", "Times ranked first"),
                alignement: "droite",
              },
            ]}
          />
        </Carte>
      ) : null}
      {matrice && matrice.resultat === null ? (
        <CarteMasquee titre={t("Matrice", "Matrix")} masque={matrice} langue={langue} />
      ) : matrice ? (
        <Carte titre={t("Matrice", "Matrix")} niveauTitre={3}>
          <p className="mp-texte-doux">
            {`${participation(matrice.resultat.participation, langue)} · ${t("axes", "axes")} : ${matrice.resultat.axes.x.libelle} ${t("et", "and")} ${matrice.resultat.axes.y.libelle}.`}
          </p>
          <Tableau
            legende={t("Résultats de la matrice", "Matrix results")}
            lignes={lignesParRang(matrice.resultat.options)}
            cleLigne={(l) => l.optionId}
            colonnes={[
              { cle: "rang", entete: t("Rang", "Rank"), alignement: "droite" },
              { cle: "option", entete: t("Option", "Option"), rendu: (l) => nom(l.optionId) },
              {
                cle: "quadrant",
                entete: t("Quadrant", "Quadrant"),
                rendu: (l) => libelleQuadrant(l.quadrant, langue),
              },
              {
                cle: "x",
                entete: matrice.resultat.axes.x.libelle,
                alignement: "droite",
                rendu: (l) => formaterCentiemes(l.moyenneXCentiemes, langue),
              },
              {
                cle: "y",
                entete: matrice.resultat.axes.y.libelle,
                alignement: "droite",
                rendu: (l) => formaterCentiemes(l.moyenneYCentiemes, langue),
              },
              {
                cle: "consensus",
                entete: t("Consensus", "Consensus"),
                rendu: (l) =>
                  l.quadrant === null ? "—" : l.consensus ? t("Oui", "Yes") : t("Non", "No"),
              },
            ]}
          />
        </Carte>
      ) : null}
    </div>
  );
}
