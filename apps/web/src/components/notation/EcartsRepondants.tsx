import { creerTraduire, type Langue } from "@missionpilot/shared";
import { obtenirLangue } from "../../lib/i18n/serveur";
import { nomRepondant, pluriel, type EcartRepondants as Ecart } from "../../lib/notation";
import { Tableau, type ColonneTableau } from "../ui/Tableau";

export interface EcartsRepondantsProps {
  ecarts: Ecart[];
  /** Questionnaire collectif : une seule réponse partagée, pas d'écart possible. */
  collectif: boolean;
}

function colonnes(langue: Langue): readonly ColonneTableau<Ecart>[] {
  const t = creerTraduire(langue);
  const liste = (r: Ecart["repondants_min"]) =>
    r.map((x) => nomRepondant(x, langue)).join(", ") || "—";
  return [
    { cle: "libelle", entete: t("Question", "Question") },
    {
      cle: "min",
      entete: t("Niveau le plus bas", "Lowest level"),
      rendu: (e) => `${e.min} (${liste(e.repondants_min)})`,
    },
    {
      cle: "max",
      entete: t("Niveau le plus haut", "Highest level"),
      rendu: (e) => `${e.max} (${liste(e.repondants_max)})`,
    },
    {
      cle: "ecart",
      entete: t("Écart", "Difference"),
      alignement: "droite",
      rendu: (e) => pluriel(e.ecart, t("niveau", "level"), t("niveaux", "levels")),
    },
    {
      cle: "nombre_repondants",
      entete: t("Répondants", "Respondents"),
      alignement: "droite",
      rendu: (e) => String(e.nombre_repondants),
    },
  ];
}

/**
 * Écarts entre répondants (NOT-05) détectés par le moteur au calcul (questions à échelle sur
 * lesquelles les réponses divergent d'au moins deux niveaux) : ils signalent un point à
 * creuser en entretien, ils ne modifient pas le score.
 */
export async function EcartsRepondants({ ecarts, collectif }: EcartsRepondantsProps) {
  const langue = await obtenirLangue();
  const t = creerTraduire(langue);
  if (collectif) {
    return (
      <p className="mp-texte-doux">
        {t(
          "Questionnaire collectif : une seule réponse partagée, donc aucun écart entre répondants.",
          "Collective questionnaire: a single shared answer, so no difference between respondents.",
        )}
      </p>
    );
  }
  if (ecarts.length === 0) {
    return (
      <p className="mp-texte-doux">
        {t(
          "Aucun écart notable entre répondants : les réponses convergent à moins de deux niveaux près.",
          "No notable difference between respondents: answers are within two levels of each other.",
        )}
      </p>
    );
  }
  return (
    <Tableau
      legende={`${pluriel(
        ecarts.length,
        t("question", "question"),
        t("questions", "questions"),
      )} ${t("avec un écart entre répondants", "with a difference between respondents")}`}
      legendeVisible
      colonnes={colonnes(langue)}
      lignes={ecarts}
      cleLigne={(e) => e.question}
    />
  );
}
