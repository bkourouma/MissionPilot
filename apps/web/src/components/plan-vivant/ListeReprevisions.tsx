import Link from "next/link";
import { formaterDateHeure, type Devise } from "../../lib/format";
import {
  formaterEcart,
  formaterEcartRelatif,
  hrefPlanVivant,
  libelleMethode,
  montantOuNonSaisi,
  type ResumeReprevision,
} from "../../lib/plan-vivant";
import { PaginationCurseur } from "../ui/EtatListe";
import { Tableau } from "../ui/Tableau";

export interface ListeReprevisionsProps {
  missionId: string;
  planId: string;
  devise: Devise;
  reprevisions: readonly ResumeReprevision[];
  affichee: string | null;
  curseur: string | null;
  curseurSuivant: string | null;
}

/** Re-prévisions passées du plan, de la plus récente à la plus ancienne (pagination par curseur). */
export function ListeReprevisions({
  missionId,
  planId,
  devise,
  reprevisions,
  affichee,
  curseur,
  curseurSuivant,
}: ListeReprevisionsProps) {
  return (
    <>
      <Tableau
        legende="Re-prévisions enregistrées"
        cleLigne={(r) => r.id}
        lignes={reprevisions}
        messageVide="Aucune re-prévision enregistrée pour ce plan."
        colonnes={[
          { cle: "cree_le", entete: "Date", rendu: (r) => formaterDateHeure(r.cree_le) },
          {
            cle: "exercice",
            entete: "Exercice",
            rendu: (r) => `${r.exercice} (re-prévision ${r.version})`,
          },
          {
            cle: "dernier_trimestre",
            entete: "Trimestres réalisés",
            alignement: "droite",
          },
          { cle: "methode", entete: "Méthode", rendu: (r) => libelleMethode(r.methode) },
          {
            cle: "ca",
            entete: "Chiffre d'affaires re-prévu",
            alignement: "droite",
            rendu: (r) => montantOuNonSaisi(r.reprevision.chiffreAffaires, devise),
          },
          {
            cle: "ecart",
            entete: "Écart annuel de chiffre d'affaires",
            alignement: "droite",
            rendu: (r) =>
              `${formaterEcart(r.ecarts_annuels.chiffreAffaires.ecart, devise)} (${formaterEcartRelatif(r.ecarts_annuels.chiffreAffaires.ecartRelatifPointsDeBase)})${r.ecarts_annuels.chiffreAffaires.significatif ? " — significatif" : ""}`,
          },
          { cle: "auteur_nom", entete: "Auteur" },
          {
            cle: "action",
            entete: "Résultat",
            rendu: (r) =>
              r.id === affichee ? (
                <span>Affichée</span>
              ) : (
                <Link
                  href={hrefPlanVivant(missionId, planId, {
                    exercice: r.exercice,
                    reprevision: r.id,
                    curseur,
                  })}
                  aria-label={`Afficher la re-prévision ${r.version} de l'exercice ${r.exercice}`}
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
            ? hrefPlanVivant(missionId, planId, { reprevision: affichee, curseur: curseurSuivant })
            : null
        }
        hrefDebut={curseur ? hrefPlanVivant(missionId, planId, { reprevision: affichee }) : null}
        libelle="Pagination des re-prévisions"
      />
    </>
  );
}
