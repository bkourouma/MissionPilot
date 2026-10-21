import type {
  RedClotureContenu,
  RedClotureLigneRatio,
  RedEvolutionCloture,
} from "@missionpilot/shared";
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

export function EvolutionBadge({ evolution }: { evolution: RedEvolutionCloture }) {
  return (
    <BadgeStatut tonalite={tonaliteEvolution(evolution)}>{libelleEvolution(evolution)}</BadgeStatut>
  );
}

const COLONNES: ColonneTableau<RedClotureLigneRatio>[] = [
  { cle: "cle", entete: "Ratio", rendu: (l) => libelleRatioCloture(l.cle) },
  {
    cle: "ouverture",
    entete: "Ouverture",
    alignement: "droite",
    rendu: (l) => formaterValeurRatio(l.cle, l.ouverture),
  },
  {
    cle: "fin",
    entete: "Fin",
    alignement: "droite",
    rendu: (l) => formaterValeurRatio(l.cle, l.fin),
  },
  {
    cle: "variation",
    entete: "Variation (points)",
    alignement: "droite",
    rendu: (l) => formaterVariationRatio(l.cle, l.variation),
  },
  {
    cle: "evolution",
    entete: "Évolution",
    rendu: (l) => <EvolutionBadge evolution={l.evolution} />,
  },
];

/** Ratios à l'ouverture et à la fin : valeurs, variation (points de pourcentage pour les parts) et évolution. */
export function ClotureRatios({ contenu }: { contenu: RedClotureContenu }) {
  return (
    <Carte titre="Ratios" niveauTitre={3}>
      <Tableau
        legende="Ratios à l'ouverture et à la fin du dossier"
        colonnes={COLONNES}
        lignes={contenu.ratios}
        cleLigne={(l) => l.cle}
        messageVide="Aucun ratio dans ce bilan."
      />
    </Carte>
  );
}
