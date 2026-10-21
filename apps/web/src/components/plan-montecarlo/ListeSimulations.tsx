import Link from "next/link";
import { formaterDateHeure, formaterNombre } from "../../lib/format";
import {
  formaterProbabilite,
  hrefSimulation,
  type ResumeSimulation,
} from "../../lib/plan-montecarlo";
import { PaginationCurseur } from "../ui/EtatListe";
import { Tableau } from "../ui/Tableau";

export interface ListeSimulationsProps {
  missionId: string;
  planId: string;
  simulations: readonly ResumeSimulation[];
  affichee: string | null;
  curseur: string | null;
  curseurSuivant: string | null;
}

/** Simulations passées du plan, de la plus récente à la plus ancienne (pagination par curseur). */
export function ListeSimulations({
  missionId,
  planId,
  simulations,
  affichee,
  curseur,
  curseurSuivant,
}: ListeSimulationsProps) {
  return (
    <>
      <Tableau
        legende="Simulations enregistrées"
        cleLigne={(s) => s.id}
        lignes={simulations}
        messageVide="Aucune simulation enregistrée pour ce plan."
        colonnes={[
          { cle: "cree_le", entete: "Date", rendu: (s) => formaterDateHeure(s.cree_le) },
          { cle: "version", entete: "Version du modèle" },
          { cle: "graine", entete: "Graine", alignement: "droite" },
          {
            cle: "tirages",
            entete: "Tirages",
            alignement: "droite",
            rendu: (s) => formaterNombre(s.tirages, 0),
          },
          {
            cle: "probabilite_van_negative",
            entete: "VAN négative",
            alignement: "droite",
            rendu: (s) => formaterProbabilite(s.probabilite_van_negative),
          },
          {
            cle: "probabilite_tension",
            entete: "Tension de trésorerie",
            alignement: "droite",
            rendu: (s) => formaterProbabilite(s.probabilite_tension),
          },
          { cle: "auteur_nom", entete: "Auteur" },
          {
            cle: "action",
            entete: "Résultat",
            rendu: (s) =>
              s.id === affichee ? (
                <span>Affichée</span>
              ) : (
                <Link
                  href={hrefSimulation(missionId, planId, { simulation: s.id, curseur })}
                  aria-label={`Afficher la simulation du ${formaterDateHeure(s.cree_le)}`}
                >
                  Afficher
                </Link>
              ),
          },
        ]}
      />
      <PaginationCurseur
        hrefSuivante={
          curseurSuivant
            ? hrefSimulation(missionId, planId, { simulation: affichee, curseur: curseurSuivant })
            : null
        }
        hrefDebut={curseur ? hrefSimulation(missionId, planId, { simulation: affichee }) : null}
        libelle="Pagination des simulations"
      />
    </>
  );
}
