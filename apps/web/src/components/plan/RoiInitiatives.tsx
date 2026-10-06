import { formaterMontantMineur, formaterPourcentage, type Devise } from "../../lib/format";
import { noteTauxRoi, type RoiPlan } from "../../lib/plan-modele";
import { Tableau } from "../ui/Tableau";
import { BadgeStatutPlan } from "./BadgeStatutPlan";

/**
 * ROI par initiative (PLA-07) : budget (année 0) et gains nets annuels saisis, VAN et TRI
 * calculés par le moteur de l'API sur [−budget, gains]. Une initiative sans gains estimés n'a
 * pas de ROI. Les initiatives retirées ne figurent pas.
 */
export function RoiInitiatives({ roi, devise }: { roi: RoiPlan; devise: Devise }) {
  return (
    <div className="mp-plan__section">
      <p className="mp-texte-doux mp-texte-petit">{noteTauxRoi(roi)}</p>
      <Tableau
        legende="Retour sur investissement des initiatives"
        lignes={roi.initiatives}
        cleLigne={(i) => i.id}
        messageVide="Aucune initiative active dans le plan : ajoutez-en depuis l'onglet « Contenus »."
        colonnes={[
          {
            cle: "titre",
            entete: "Initiative",
            rendu: (i) => (
              <span className="mp-plan__badges">
                <span>{i.titre}</span>
                <BadgeStatutPlan statut={i.statut_contenu} />
              </span>
            ),
          },
          {
            cle: "budget",
            entete: "Budget (année 0)",
            alignement: "droite",
            rendu: (i) => formaterMontantMineur(i.budget, devise),
          },
          {
            cle: "gains",
            entete: "Gains nets annuels",
            rendu: (i) =>
              i.gains_annuels ? (
                <ol className="mp-liste-simple">
                  {i.gains_annuels.map((g, n) => (
                    <li key={n}>{`Année ${n + 1} : ${formaterMontantMineur(g, devise)}`}</li>
                  ))}
                </ol>
              ) : (
                "Non estimés"
              ),
          },
          {
            cle: "van",
            entete: "VAN",
            alignement: "droite",
            rendu: (i) =>
              i.valeur_actuelle_nette === null
                ? "Non calculée"
                : formaterMontantMineur(i.valeur_actuelle_nette, devise),
          },
          {
            cle: "tri",
            entete: "TRI",
            alignement: "droite",
            rendu: (i) =>
              i.gains_annuels === null
                ? "Non calculé"
                : i.taux_rendement_interne === null
                  ? "Non défini"
                  : formaterPourcentage(i.taux_rendement_interne, 1),
          },
        ]}
      />
      <p className="mp-texte-doux mp-texte-petit">
        TRI « non défini » : les flux ne changent pas de signe exactement une fois (aucun taux
        unique ne les équilibre).
      </p>
    </div>
  );
}
