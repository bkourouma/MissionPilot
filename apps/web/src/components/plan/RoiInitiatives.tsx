import { obtenirLangue, obtenirT } from "../../lib/i18n/serveur";
import { formaterMontantMineur, formaterPourcentage, type Devise } from "../../lib/format";
import { noteTauxRoi, type RoiPlan } from "../../lib/plan-modele";
import { Tableau } from "../ui/Tableau";
import { BadgeStatutPlan } from "./BadgeStatutPlan";

/**
 * ROI par initiative (PLA-07) : budget (année 0) et gains nets annuels saisis, VAN et TRI
 * calculés par le moteur de l'API sur [−budget, gains]. Une initiative sans gains estimés n'a
 * pas de ROI. Les initiatives retirées ne figurent pas.
 */
export async function RoiInitiatives({ roi, devise }: { roi: RoiPlan; devise: Devise }) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  return (
    <div className="mp-plan__section">
      <p className="mp-texte-doux mp-texte-petit">{noteTauxRoi(roi, langue)}</p>
      <Tableau
        legende={t(
          "Retour sur investissement des initiatives",
          "Return on investment of initiatives",
        )}
        lignes={roi.initiatives}
        cleLigne={(i) => i.id}
        messageVide={t(
          "Aucune initiative active dans le plan : ajoutez-en depuis l'onglet « Contenus ».",
          "No active initiatives in the plan: add some from the \u201cContent\u201d tab.",
        )}
        colonnes={[
          {
            cle: "titre",
            entete: t("Initiative", "Initiative"),
            rendu: (i) => (
              <span className="mp-plan__badges">
                <span>{i.titre}</span>
                <BadgeStatutPlan statut={i.statut_contenu} />
              </span>
            ),
          },
          {
            cle: "budget",
            entete: t("Budget (année 0)", "Budget (year 0)"),
            alignement: "droite",
            rendu: (i) => formaterMontantMineur(i.budget, devise, langue),
          },
          {
            cle: "gains",
            entete: t("Gains nets annuels", "Annual net gains"),
            rendu: (i) =>
              i.gains_annuels ? (
                <ol className="mp-liste-simple">
                  {i.gains_annuels.map((g, n) => (
                    <li key={n}>
                      {`${t("Année", "Year")} ${n + 1}${langue === "en" ? ":" : " :"} ${formaterMontantMineur(g, devise, langue)}`}
                    </li>
                  ))}
                </ol>
              ) : (
                t("Non estimés", "Not estimated")
              ),
          },
          {
            cle: "van",
            entete: t("VAN", "NPV"),
            alignement: "droite",
            rendu: (i) =>
              i.valeur_actuelle_nette === null
                ? t("Non calculée", "Not computed")
                : formaterMontantMineur(i.valeur_actuelle_nette, devise, langue),
          },
          {
            cle: "tri",
            entete: t("TRI", "IRR"),
            alignement: "droite",
            rendu: (i) =>
              i.gains_annuels === null
                ? t("Non calculé", "Not computed")
                : i.taux_rendement_interne === null
                  ? t("Non défini", "Undefined")
                  : formaterPourcentage(i.taux_rendement_interne, 1, langue),
          },
        ]}
      />
      <p className="mp-texte-doux mp-texte-petit">
        {t(
          "TRI « non défini » : les flux ne changent pas de signe exactement une fois (aucun taux unique ne les équilibre).",
          "IRR \u201cundefined\u201d: the cash flows do not change sign exactly once (no single rate balances them).",
        )}
      </p>
    </div>
  );
}
