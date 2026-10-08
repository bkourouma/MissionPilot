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
import { Tableau, type ColonneTableau } from "../ui/Tableau";
import { BadgeClasse } from "./BadgeClasse";

export interface TableauDimensionsProps {
  vue: VueVersionNotation;
}

const COLONNES: readonly ColonneTableau<LigneDimension>[] = [
  { cle: "libelle", entete: "Dimension" },
  { cle: "famille", entete: "Famille", rendu: (l) => libelleFamille(l.famille) },
  {
    cle: "poids",
    entete: "Poids",
    alignement: "droite",
    rendu: (l) => (l.poids === null ? "—" : formaterNombre(l.poids, 2)),
  },
  {
    cle: "couverture",
    entete: "Couverture",
    alignement: "droite",
    rendu: (l) => formaterCouverture(l.couverture),
  },
  {
    cle: "scoreCalcule",
    entete: "Score calculé",
    alignement: "droite",
    rendu: (l) => (l.notable ? formaterScore(l.scoreCalcule) : "Non notable"),
  },
  {
    cle: "deltaCumule",
    entete: "Ajustement",
    alignement: "droite",
    rendu: (l) => (l.deltaCumule === 0 ? "—" : formaterEcart(l.deltaCumule)),
  },
  {
    cle: "score",
    entete: "Score retenu",
    alignement: "droite",
    rendu: (l) => (l.notable ? formaterScore(l.score) : "—"),
  },
  {
    cle: "classe",
    entete: "Classe",
    rendu: (l) =>
      l.notable ? (
        <BadgeClasse classe={l.classe} />
      ) : (
        <span className="mp-texte-doux">Réponses insuffisantes</span>
      ),
  },
];

/**
 * Tableau des scores par dimension (alternative textuelle des graphiques) : poids normalisé,
 * couverture, score calculé, ajustement cumulé et score retenu, tels que rendus par l'API.
 */
export function TableauDimensions({ vue }: TableauDimensionsProps) {
  return (
    <Tableau
      legende={`Scores par dimension, version ${vue.numero} (sur 100)`}
      legendeVisible
      colonnes={COLONNES}
      lignes={lignesDimensions(vue)}
      cleLigne={(l) => l.dimension}
      messageVide="Aucune dimension dans cette version."
    />
  );
}
