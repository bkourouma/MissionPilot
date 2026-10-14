"use client";

import type { RedEcartPlanVue, RedPlanVersionVue } from "@missionpilot/shared";
import { formaterDate, formaterDateHeure } from "../../lib/format";
import {
  cheminValidationPlan,
  cheminVersionsPlan,
  libelleEcartPlan,
  libelleStatutVersionPlan,
  TEXTE_VALIDATION_PLAN,
} from "../../lib/redressement";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Tableau } from "../ui/Tableau";
import { BoutonActionRed } from "./BoutonActionRed";

/**
 * Versions du plan : « Créer une version à valider » (droit d'écriture) et « Valider cette
 * version » (droit de validation ; désactivé avec sa raison quand l'API annonce `peut_valider`
 * faux : séparation des tâches). Le contenu validé est reconstruit et vérifié par l'API ; un
 * déplacement dans le kanban ne change pas le plan.
 */
export function VersionsPlan({
  dossierId,
  versions,
  ecart,
  peutEcrire,
  peutValider,
}: {
  dossierId: string;
  versions: RedPlanVersionVue[];
  ecart: RedEcartPlanVue | null;
  peutEcrire: boolean;
  peutValider: boolean;
}) {
  return (
    <div className="mp-red-section">
      {ecart ? <p>{libelleEcartPlan(ecart)}</p> : null}
      <Tableau
        legende="Versions du plan"
        messageVide="Aucune version du plan : créez-en une pour la soumettre à validation."
        colonnes={[
          { cle: "version", entete: "Version", rendu: (v: RedPlanVersionVue) => v.version },
          {
            cle: "statut",
            entete: "Statut",
            rendu: (v) => (
              <BadgeStatut tonalite={v.statut === "valide" ? "succes" : "attention"}>
                {libelleStatutVersionPlan(v.statut)}
              </BadgeStatut>
            ),
          },
          {
            cle: "reference",
            entete: "Date de référence",
            rendu: (v) => formaterDate(v.date_reference),
          },
          {
            cle: "auteur",
            entete: "Auteur",
            rendu: (v) => `${v.cree_par.nom}, le ${formaterDateHeure(v.cree_le)}`,
          },
          {
            cle: "validation",
            entete: "Validation",
            rendu: (v) =>
              v.valide_par ? `${v.valide_par.nom}, le ${formaterDateHeure(v.valide_le)}` : "—",
          },
          {
            cle: "action",
            entete: "Action",
            rendu: (v) =>
              v.statut === "brouillon" && peutValider ? (
                <BoutonActionRed
                  libelle="Valider cette version"
                  chemin={cheminValidationPlan(v.id)}
                  corps={{}}
                  succes="Version du plan validée."
                  variante="primaire"
                  desactiveParce={v.peut_valider ? undefined : TEXTE_VALIDATION_PLAN}
                  confirmation={{
                    question: `Valider la version ${v.version} du plan ?`,
                    libelleConfirmation: "Oui, valider",
                  }}
                />
              ) : (
                "—"
              ),
          },
        ]}
        lignes={versions}
        cleLigne={(v) => v.id}
      />
      {peutEcrire ? (
        <BoutonActionRed
          libelle="Créer une version à valider"
          chemin={cheminVersionsPlan(dossierId)}
          corps={{}}
          succes="Version du plan créée : elle attend sa validation."
          variante="secondaire"
        />
      ) : null}
    </div>
  );
}
