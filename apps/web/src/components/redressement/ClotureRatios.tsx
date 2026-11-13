import type {
  RedClotureContenu,
  RedClotureLigneRatio,
  RedEvolutionCloture,
} from "@missionpilot/shared";
import type { Langue } from "@missionpilot/shared";
import { obtenirLangue, obtenirT } from "../../lib/i18n/serveur";
import { formaterValeurRatio } from "../../lib/redressement";
import {
  formaterVariationRatio,
  libelleEvolution,
  libelleRatioCloture,
  tonaliteEvolution,
} from "../../lib/redressement-cloture";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Carte } from "../ui/Carte";
import { Tableau, type ColonneTableau } from "../ui/Tableau";

export function EvolutionBadge({
  evolution,
  langue = "fr",
}: {
  evolution: RedEvolutionCloture;
  langue?: Langue;
}) {
  return (
    <BadgeStatut tonalite={tonaliteEvolution(evolution)}>
      {libelleEvolution(evolution, langue)}
    </BadgeStatut>
  );
}

/** Ratios à l'ouverture et à la fin : valeurs, variation (points de pourcentage pour les parts) et évolution. */
export async function ClotureRatios({ contenu }: { contenu: RedClotureContenu }) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const colonnes: ColonneTableau<RedClotureLigneRatio>[] = [
    { cle: "cle", entete: "Ratio", rendu: (l) => libelleRatioCloture(l.cle, langue) },
    {
      cle: "ouverture",
      entete: t("Ouverture", "Opening"),
      alignement: "droite",
      rendu: (l) => formaterValeurRatio(l.cle, l.ouverture, langue),
    },
    {
      cle: "fin",
      entete: t("Fin", "End"),
      alignement: "droite",
      rendu: (l) => formaterValeurRatio(l.cle, l.fin, langue),
    },
    {
      cle: "variation",
      entete: t("Variation (points)", "Change (points)"),
      alignement: "droite",
      rendu: (l) => formaterVariationRatio(l.cle, l.variation, langue),
    },
    {
      cle: "evolution",
      entete: t("Évolution", "Trend"),
      rendu: (l) => <EvolutionBadge evolution={l.evolution} langue={langue} />,
    },
  ];
  return (
    <Carte titre="Ratios" niveauTitre={3}>
      <Tableau
        legende={t(
          "Ratios à l'ouverture et à la fin du dossier",
          "Ratios at the opening and at the end of the file",
        )}
        colonnes={colonnes}
        lignes={contenu.ratios}
        cleLigne={(l) => l.cle}
        messageVide={t("Aucun ratio dans ce bilan.", "No ratio in this review.")}
      />
    </Carte>
  );
}
