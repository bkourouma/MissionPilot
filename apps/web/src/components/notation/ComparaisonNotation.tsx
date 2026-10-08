import { formaterDate } from "../../lib/format";
import {
  formaterEcart,
  formaterEcartClasses,
  formaterScore,
  libelleEvolution,
  type ComparaisonNotation as Comparaison,
} from "../../lib/notation";
import { Tableau, type ColonneTableau } from "../ui/Tableau";
import { BadgeClasse } from "./BadgeClasse";

export interface ComparaisonNotationProps {
  comparaison: Comparaison | null;
}

type LigneComparaison = Comparaison["dimensions"][number];

const COLONNES: readonly ColonneTableau<LigneComparaison>[] = [
  { cle: "libelle", entete: "Dimension" },
  {
    cle: "avant",
    entete: "Précédente",
    alignement: "droite",
    rendu: (l) => (l.avant === null ? "Non notable" : formaterScore(l.avant)),
  },
  {
    cle: "apres",
    entete: "Cette version",
    alignement: "droite",
    rendu: (l) => (l.apres === null ? "Non notable" : formaterScore(l.apres)),
  },
  { cle: "ecart", entete: "Écart", alignement: "droite", rendu: (l) => formaterEcart(l.ecart) },
  { cle: "evolution", entete: "Évolution", rendu: (l) => libelleEvolution(l.evolution) },
];

/**
 * Comparaison avec la notation PUBLIÉE précédente du même client (autre mission visible) :
 * écarts calculés par le moteur (`comparerNotations`), affichés tels quels.
 */
export function ComparaisonNotation({ comparaison }: ComparaisonNotationProps) {
  if (!comparaison) {
    return (
      <p className="mp-texte-doux">
        Aucune notation publiée antérieure pour ce client parmi les missions que vous pouvez
        consulter : pas de comparaison possible.
      </p>
    );
  }
  const p = comparaison.precedente;
  const g = comparaison.global;
  return (
    <div className="mp-notation__section">
      <p>
        Notation précédente : mission « {p.mission_intitule} », version {p.numero}, publiée le{" "}
        {formaterDate(p.publiee_le)}.
      </p>
      <dl className="mp-liste-def mp-liste-def--compacte">
        <div>
          <dt>Score global</dt>
          <dd>
            {g.avant === null ? "non notable" : formaterScore(g.avant)} →{" "}
            {g.apres === null ? "non notable" : formaterScore(g.apres)}
            {g.ecart === null ? "" : ` (écart ${formaterEcart(g.ecart)})`} —{" "}
            {libelleEvolution(g.evolution)}
          </dd>
        </div>
        <div>
          <dt>Classe</dt>
          <dd>
            <BadgeClasse classe={comparaison.classeAvant} /> →{" "}
            <BadgeClasse classe={comparaison.classeApres} />{" "}
            {comparaison.ecartClasses === null
              ? ""
              : `(${formaterEcartClasses(comparaison.ecartClasses)})`}
          </dd>
        </div>
      </dl>
      <Tableau
        legende="Comparaison par dimension avec la notation précédente"
        colonnes={COLONNES}
        lignes={comparaison.dimensions}
        cleLigne={(l) => l.dimension}
      />
    </div>
  );
}
