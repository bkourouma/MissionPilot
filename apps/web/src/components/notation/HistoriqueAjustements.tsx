import { formaterDate } from "../../lib/format";
import { obtenirLangue, obtenirT } from "../../lib/i18n/serveur";
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
export async function HistoriqueAjustements({ vue }: HistoriqueAjustementsProps) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const colonnes: readonly ColonneTableau<AjustementNotation>[] = [
    { cle: "rang", entete: t("N°", "No."), alignement: "droite" },
    { cle: "date", entete: t("Date", "Date"), rendu: (a) => formaterDate(a.date, "UTC", langue) },
    {
      cle: "dimension",
      entete: t("Dimension", "Dimension"),
      rendu: (a) => libelleDimension(vue, a.dimension),
    },
    {
      cle: "delta",
      entete: t("Écart", "Difference"),
      alignement: "droite",
      rendu: (a) => `${formaterEcart(a.delta, langue)} ${t("pt", "pt")}`,
    },
    {
      cle: "scores",
      entete: t("Score avant → après", "Score before → after"),
      alignement: "droite",
      rendu: (a) => (
        <>
          {formaterScore(a.score_avant, langue)} → {formaterScore(a.score_apres, langue)}
          {a.plafonne ? (
            <>
              {" "}
              <span className="mp-texte-doux">{t("(borné à 0–100)", "(capped to 0–100)")}</span>
            </>
          ) : null}
        </>
      ),
    },
    { cle: "auteur", entete: t("Auteur", "Author"), rendu: (a) => a.auteur.nom },
    {
      cle: "motif",
      entete: t("Motif", "Reason"),
      rendu: (a) => <span className="mp-notation-motif">{a.motif}</span>,
    },
  ];
  return (
    <Tableau
      legende={t(
        `Historique des ajustements de la version ${vue.numero}`,
        `Adjustment history of version ${vue.numero}`,
      )}
      colonnes={colonnes}
      lignes={vue.ajustements}
      cleLigne={(a) => String(a.rang)}
      messageVide={t(
        "Aucun ajustement : les scores retenus sont ceux du calcul.",
        "No adjustment: the retained scores are those of the computation.",
      )}
    />
  );
}
