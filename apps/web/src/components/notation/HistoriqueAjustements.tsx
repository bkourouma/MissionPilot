import { formaterDate } from "../../lib/format";
import {
  formaterEcart,
  formaterScore,
  libelleDimension,
  type AjustementNotation,
  type VueVersionNotation,
} from "../../lib/notation";
import { Tableau, type ColonneTableau } from "../ui/Tableau";

export interface HistoriqueAjustementsProps {
  vue: VueVersionNotation;
}

/**
 * Historique immuable des ajustements motivés (NOT-04) de la version : rang, date, dimension,
 * écart, score avant et après (calculés par le moteur), auteur et motif. Il ne se modifie ni ne
 * se supprime : une correction passe par un nouvel ajustement ou un nouveau calcul.
 */
export function HistoriqueAjustements({ vue }: HistoriqueAjustementsProps) {
  const colonnes: readonly ColonneTableau<AjustementNotation>[] = [
    { cle: "rang", entete: "N°", alignement: "droite" },
    { cle: "date", entete: "Date", rendu: (a) => formaterDate(a.date) },
    { cle: "dimension", entete: "Dimension", rendu: (a) => libelleDimension(vue, a.dimension) },
    {
      cle: "delta",
      entete: "Écart",
      alignement: "droite",
      rendu: (a) => `${formaterEcart(a.delta)} pt`,
    },
    {
      cle: "scores",
      entete: "Score avant → après",
      alignement: "droite",
      rendu: (a) => (
        <>
          {formaterScore(a.score_avant)} → {formaterScore(a.score_apres)}
          {a.plafonne ? (
            <>
              {" "}
              <span className="mp-texte-doux">(borné à 0–100)</span>
            </>
          ) : null}
        </>
      ),
    },
    { cle: "auteur", entete: "Auteur", rendu: (a) => a.auteur.nom },
    {
      cle: "motif",
      entete: "Motif",
      rendu: (a) => <span className="mp-notation-motif">{a.motif}</span>,
    },
  ];
  return (
    <Tableau
      legende={`Historique des ajustements de la version ${vue.numero}`}
      colonnes={colonnes}
      lignes={vue.ajustements}
      cleLigne={(a) => String(a.rang)}
      messageVide="Aucun ajustement : les scores retenus sont ceux du calcul."
    />
  );
}
