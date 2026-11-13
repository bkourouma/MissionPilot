import Link from "next/link";
import { formaterDateHeure, formaterNombre } from "../../lib/format";
import {
  formaterProbabilite,
  hrefSimulation,
  type ResumeSimulation,
} from "../../lib/plan-montecarlo";
import { obtenirLangue } from "../../lib/i18n/serveur";
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
export async function ListeSimulations({
  missionId,
  planId,
  simulations,
  affichee,
  curseur,
  curseurSuivant,
}: ListeSimulationsProps) {
  const langue = await obtenirLangue();
  const t = (fr: string, en: string) => (langue === "en" ? en : fr);
  return (
    <>
      <Tableau
        legende={t("Simulations enregistrées", "Saved simulations")}
        cleLigne={(s) => s.id}
        lignes={simulations}
        messageVide={t(
          "Aucune simulation enregistrée pour ce plan.",
          "No simulation saved for this plan.",
        )}
        colonnes={[
          {
            cle: "cree_le",
            entete: t("Date", "Date"),
            rendu: (s) => formaterDateHeure(s.cree_le, undefined, langue),
          },
          { cle: "version", entete: t("Version du modèle", "Model version") },
          { cle: "graine", entete: t("Graine", "Seed"), alignement: "droite" },
          {
            cle: "tirages",
            entete: t("Tirages", "Draws"),
            alignement: "droite",
            rendu: (s) => formaterNombre(s.tirages, 0, langue),
          },
          {
            cle: "probabilite_van_negative",
            entete: t("VAN négative", "Negative NPV"),
            alignement: "droite",
            rendu: (s) => formaterProbabilite(s.probabilite_van_negative, langue),
          },
          {
            cle: "probabilite_tension",
            entete: t("Tension de trésorerie", "Cash strain"),
            alignement: "droite",
            rendu: (s) => formaterProbabilite(s.probabilite_tension, langue),
          },
          { cle: "auteur_nom", entete: t("Auteur", "Author") },
          {
            cle: "action",
            entete: t("Résultat", "Result"),
            rendu: (s) =>
              s.id === affichee ? (
                <span>{t("Affichée", "Shown")}</span>
              ) : (
                <Link
                  href={hrefSimulation(missionId, planId, { simulation: s.id, curseur })}
                  aria-label={`${t("Afficher la simulation du", "Show the simulation of")} ${formaterDateHeure(s.cree_le, undefined, langue)}`}
                >
                  {t("Afficher", "Show")}
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
        libelle={t("Pagination des simulations", "Simulations pagination")}
      />
    </>
  );
}
