import { nomRepondant, pluriel, type EcartRepondants as Ecart } from "../../lib/notation";
import { Tableau, type ColonneTableau } from "../ui/Tableau";

export interface EcartsRepondantsProps {
  ecarts: Ecart[];
  /** Questionnaire collectif : une seule réponse partagée, pas d'écart possible. */
  collectif: boolean;
}

const liste = (r: Ecart["repondants_min"]) => r.map(nomRepondant).join(", ") || "—";

const COLONNES: readonly ColonneTableau<Ecart>[] = [
  { cle: "libelle", entete: "Question" },
  {
    cle: "min",
    entete: "Niveau le plus bas",
    rendu: (e) => `${e.min} (${liste(e.repondants_min)})`,
  },
  {
    cle: "max",
    entete: "Niveau le plus haut",
    rendu: (e) => `${e.max} (${liste(e.repondants_max)})`,
  },
  {
    cle: "ecart",
    entete: "Écart",
    alignement: "droite",
    rendu: (e) => pluriel(e.ecart, "niveau"),
  },
  {
    cle: "nombre_repondants",
    entete: "Répondants",
    alignement: "droite",
    rendu: (e) => String(e.nombre_repondants),
  },
];

/**
 * Écarts entre répondants (NOT-05) détectés par le moteur au calcul (questions à échelle sur
 * lesquelles les réponses divergent d'au moins deux niveaux) : ils signalent un point à
 * creuser en entretien, ils ne modifient pas le score.
 */
export function EcartsRepondants({ ecarts, collectif }: EcartsRepondantsProps) {
  if (collectif) {
    return (
      <p className="mp-texte-doux">
        Questionnaire collectif : une seule réponse partagée, donc aucun écart entre répondants.
      </p>
    );
  }
  if (ecarts.length === 0) {
    return (
      <p className="mp-texte-doux">
        Aucun écart notable entre répondants : les réponses convergent à moins de deux niveaux près.
      </p>
    );
  }
  return (
    <Tableau
      legende={`${pluriel(ecarts.length, "question", "questions")} avec un écart entre répondants`}
      legendeVisible
      colonnes={COLONNES}
      lignes={ecarts}
      cleLigne={(e) => e.question}
    />
  );
}
