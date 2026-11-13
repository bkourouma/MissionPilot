import { creerTraduire, type Langue } from "@missionpilot/shared";
import {
  formaterCouverture,
  formaterEcart,
  formaterScore,
  libelleFamille,
  lignesDimensions,
  type LigneDimension,
  type VueVersionNotation,
} from "../../lib/notation";
import { formaterNombre } from "../../lib/format";
import { obtenirLangue } from "../../lib/i18n/serveur";
import { Tableau, type ColonneTableau } from "../ui/Tableau";
import { BadgeClasse } from "./BadgeClasse";

export interface TableauDimensionsProps {
  vue: VueVersionNotation;
}

function colonnes(langue: Langue): readonly ColonneTableau<LigneDimension>[] {
  const t = creerTraduire(langue);
  return [
    { cle: "libelle", entete: t("Dimension", "Dimension") },
    {
      cle: "famille",
      entete: t("Famille", "Family"),
      rendu: (l) => libelleFamille(l.famille, langue),
    },
    {
      cle: "poids",
      entete: t("Poids", "Weight"),
      alignement: "droite",
      rendu: (l) => (l.poids === null ? "—" : formaterNombre(l.poids, 2, langue)),
    },
    {
      cle: "couverture",
      entete: t("Couverture", "Coverage"),
      alignement: "droite",
      rendu: (l) => formaterCouverture(l.couverture, langue),
    },
    {
      cle: "scoreCalcule",
      entete: t("Score calculé", "Computed score"),
      alignement: "droite",
      rendu: (l) =>
        l.notable ? formaterScore(l.scoreCalcule, langue) : t("Non notable", "Not rated"),
    },
    {
      cle: "deltaCumule",
      entete: t("Ajustement", "Adjustment"),
      alignement: "droite",
      rendu: (l) => (l.deltaCumule === 0 ? "—" : formaterEcart(l.deltaCumule, langue)),
    },
    {
      cle: "score",
      entete: t("Score retenu", "Retained score"),
      alignement: "droite",
      rendu: (l) => (l.notable ? formaterScore(l.score, langue) : "—"),
    },
    {
      cle: "classe",
      entete: t("Classe", "Class"),
      rendu: (l) =>
        l.notable ? (
          <BadgeClasse classe={l.classe} />
        ) : (
          <span className="mp-texte-doux">
            {t("Réponses insuffisantes", "Insufficient answers")}
          </span>
        ),
    },
  ];
}

/**
 * Tableau des scores par dimension (alternative textuelle des graphiques) : poids normalisé,
 * couverture, score calculé, ajustement cumulé et score retenu, tels que rendus par l'API.
 */
export async function TableauDimensions({ vue }: TableauDimensionsProps) {
  const langue = await obtenirLangue();
  const t = creerTraduire(langue);
  return (
    <Tableau
      legende={t(
        `Scores par dimension, version ${vue.numero} (sur 100)`,
        `Scores by dimension, version ${vue.numero} (out of 100)`,
      )}
      legendeVisible
      colonnes={colonnes(langue)}
      lignes={lignesDimensions(vue)}
      cleLigne={(l) => l.dimension}
      messageVide={t("Aucune dimension dans cette version.", "No dimension in this version.")}
    />
  );
}
