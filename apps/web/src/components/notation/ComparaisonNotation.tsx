import { formaterDate } from "../../lib/format";
import { obtenirLangue } from "../../lib/i18n/serveur";
import {
  formaterEcart,
  formaterEcartClasses,
  formaterScore,
  libelleEvolution,
  type ComparaisonNotation as Comparaison,
} from "../../lib/notation";
import { creerTraduire, type Langue } from "@missionpilot/shared";
import { Tableau, type ColonneTableau } from "../ui/Tableau";
import { BadgeClasse } from "./BadgeClasse";

export interface ComparaisonNotationProps {
  comparaison: Comparaison | null;
}

type LigneComparaison = Comparaison["dimensions"][number];

function colonnes(langue: Langue): readonly ColonneTableau<LigneComparaison>[] {
  const t = creerTraduire(langue);
  const nonNotable = t("Non notable", "Not rated");
  return [
    { cle: "libelle", entete: t("Dimension", "Dimension") },
    {
      cle: "avant",
      entete: t("Précédente", "Previous"),
      alignement: "droite",
      rendu: (l) => (l.avant === null ? nonNotable : formaterScore(l.avant, langue)),
    },
    {
      cle: "apres",
      entete: t("Cette version", "This version"),
      alignement: "droite",
      rendu: (l) => (l.apres === null ? nonNotable : formaterScore(l.apres, langue)),
    },
    {
      cle: "ecart",
      entete: t("Écart", "Difference"),
      alignement: "droite",
      rendu: (l) => formaterEcart(l.ecart, langue),
    },
    {
      cle: "evolution",
      entete: t("Évolution", "Trend"),
      rendu: (l) => libelleEvolution(l.evolution, langue),
    },
  ];
}

/**
 * Comparaison avec la notation PUBLIÉE précédente du même client (autre mission visible) :
 * écarts calculés par le moteur (`comparerNotations`), affichés tels quels.
 */
export async function ComparaisonNotation({ comparaison }: ComparaisonNotationProps) {
  const langue = await obtenirLangue();
  const t = creerTraduire(langue);
  if (!comparaison) {
    return (
      <p className="mp-texte-doux">
        {t(
          "Aucune notation publiée antérieure pour ce client parmi les missions que vous pouvez consulter : pas de comparaison possible.",
          "No earlier published rating for this client among the engagements you can view: no comparison possible.",
        )}
      </p>
    );
  }
  const p = comparaison.precedente;
  const g = comparaison.global;
  const nonNotable = t("non notable", "not rated");
  return (
    <div className="mp-notation__section">
      <p>
        {t(
          `Notation précédente : mission « ${p.mission_intitule} », version ${p.numero}, publiée le ${formaterDate(p.publiee_le, "UTC", langue)}.`,
          `Previous rating: engagement "${p.mission_intitule}", version ${p.numero}, published on ${formaterDate(p.publiee_le, "UTC", langue)}.`,
        )}
      </p>
      <dl className="mp-liste-def mp-liste-def--compacte">
        <div>
          <dt>{t("Score global", "Overall score")}</dt>
          <dd>
            {g.avant === null ? nonNotable : formaterScore(g.avant, langue)} →{" "}
            {g.apres === null ? nonNotable : formaterScore(g.apres, langue)}
            {g.ecart === null
              ? ""
              : ` (${t("écart", "difference")} ${formaterEcart(g.ecart, langue)})`}{" "}
            — {libelleEvolution(g.evolution, langue)}
          </dd>
        </div>
        <div>
          <dt>{t("Classe", "Class")}</dt>
          <dd>
            <BadgeClasse classe={comparaison.classeAvant} /> →{" "}
            <BadgeClasse classe={comparaison.classeApres} />{" "}
            {comparaison.ecartClasses === null
              ? ""
              : `(${formaterEcartClasses(comparaison.ecartClasses, langue)})`}
          </dd>
        </div>
      </dl>
      <Tableau
        legende={t(
          "Comparaison par dimension avec la notation précédente",
          "Comparison by dimension with the previous rating",
        )}
        colonnes={colonnes(langue)}
        lignes={comparaison.dimensions}
        cleLigne={(l) => l.dimension}
      />
    </div>
  );
}
