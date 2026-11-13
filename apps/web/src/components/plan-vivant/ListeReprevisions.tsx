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
import { obtenirLangue } from "../../lib/i18n/serveur";
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
export async function ListeReprevisions({
  missionId,
  planId,
  devise,
  reprevisions,
  affichee,
  curseur,
  curseurSuivant,
}: ListeReprevisionsProps) {
  const langue = await obtenirLangue();
  const t = (fr: string, en: string) => (langue === "en" ? en : fr);
  return (
    <>
      <Tableau
        legende={t("Re-prévisions enregistrées", "Saved re-forecasts")}
        cleLigne={(r) => r.id}
        lignes={reprevisions}
        messageVide={t(
          "Aucune re-prévision enregistrée pour ce plan.",
          "No re-forecast saved for this plan.",
        )}
        colonnes={[
          {
            cle: "cree_le",
            entete: t("Date", "Date"),
            rendu: (r) => formaterDateHeure(r.cree_le, undefined, langue),
          },
          {
            cle: "exercice",
            entete: t("Exercice", "Fiscal year"),
            rendu: (r) => `${r.exercice} (${t("re-prévision", "re-forecast")} ${r.version})`,
          },
          {
            cle: "dernier_trimestre",
            entete: t("Trimestres réalisés", "Actual quarters"),
            alignement: "droite",
          },
          {
            cle: "methode",
            entete: t("Méthode", "Method"),
            rendu: (r) => libelleMethode(r.methode, langue),
          },
          {
            cle: "ca",
            entete: t("Chiffre d'affaires re-prévu", "Re-forecast revenue"),
            alignement: "droite",
            rendu: (r) => montantOuNonSaisi(r.reprevision.chiffreAffaires, devise, langue),
          },
          {
            cle: "ecart",
            entete: t("Écart annuel de chiffre d'affaires", "Annual revenue variance"),
            alignement: "droite",
            rendu: (r) =>
              `${formaterEcart(r.ecarts_annuels.chiffreAffaires.ecart, devise, langue)} (${formaterEcartRelatif(r.ecarts_annuels.chiffreAffaires.ecartRelatifPointsDeBase, langue)})${r.ecarts_annuels.chiffreAffaires.significatif ? t(" — significatif", " — significant") : ""}`,
          },
          { cle: "auteur_nom", entete: t("Auteur", "Author") },
          {
            cle: "action",
            entete: t("Résultat", "Result"),
            rendu: (r) =>
              r.id === affichee ? (
                <span>{t("Affichée", "Shown")}</span>
              ) : (
                <Link
                  href={hrefPlanVivant(missionId, planId, {
                    exercice: r.exercice,
                    reprevision: r.id,
                    curseur,
                  })}
                  aria-label={t(
                    `Afficher la re-prévision ${r.version} de l'exercice ${r.exercice}`,
                    `Show re-forecast ${r.version} for fiscal year ${r.exercice}`,
                  )}
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
            ? hrefPlanVivant(missionId, planId, { reprevision: affichee, curseur: curseurSuivant })
            : null
        }
        hrefDebut={curseur ? hrefPlanVivant(missionId, planId, { reprevision: affichee }) : null}
        libelle={t("Pagination des re-prévisions", "Re-forecasts pagination")}
      />
    </>
  );
}
