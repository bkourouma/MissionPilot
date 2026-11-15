"use client";

import type { RedEcartPlanVue, RedPlanVersionVue } from "@missionpilot/shared";
import { formaterDate, formaterDateHeure } from "../../lib/format";
import {
  cheminValidationPlan,
  cheminVersionsPlan,
  libelleEcartPlan,
  libelleStatutVersionPlan,
  TEXTE_VALIDATION_PLAN,
  TEXTE_VALIDATION_PLAN_EN,
} from "../../lib/redressement";
import { useLangue, useT } from "../i18n/FournisseurLangue";
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
  const t = useT();
  const langue = useLangue();
  return (
    <div className="mp-red-section">
      {ecart ? <p>{libelleEcartPlan(ecart, langue)}</p> : null}
      <Tableau
        legende={t("Versions du plan", "Plan versions")}
        messageVide={t(
          "Aucune version du plan : créez-en une pour la soumettre à validation.",
          "No plan version: create one to submit it for approval.",
        )}
        colonnes={[
          {
            cle: "version",
            entete: t("Version", "Version"),
            rendu: (v: RedPlanVersionVue) => v.version,
          },
          {
            cle: "statut",
            entete: t("Statut", "Status"),
            rendu: (v) => (
              <BadgeStatut tonalite={v.statut === "valide" ? "succes" : "attention"}>
                {libelleStatutVersionPlan(v.statut, langue)}
              </BadgeStatut>
            ),
          },
          {
            cle: "reference",
            entete: t("Date de référence", "Reference date"),
            rendu: (v) => formaterDate(v.date_reference, "UTC", langue),
          },
          {
            cle: "auteur",
            entete: t("Auteur", "Author"),
            rendu: (v) =>
              `${v.cree_par.nom}, ${t("le", "on")} ${formaterDateHeure(v.cree_le, undefined, langue)}`,
          },
          {
            cle: "validation",
            entete: t("Validation", "Approval"),
            rendu: (v) =>
              v.valide_par
                ? `${v.valide_par.nom}, ${t("le", "on")} ${formaterDateHeure(v.valide_le, undefined, langue)}`
                : "—",
          },
          {
            cle: "action",
            entete: "Action",
            rendu: (v) =>
              v.statut === "brouillon" && peutValider ? (
                <BoutonActionRed
                  libelle={t("Valider cette version", "Approve this version")}
                  chemin={cheminValidationPlan(v.id)}
                  corps={{}}
                  succes={t("Version du plan validée.", "Plan version approved.")}
                  variante="primaire"
                  desactiveParce={
                    v.peut_valider ? undefined : t(TEXTE_VALIDATION_PLAN, TEXTE_VALIDATION_PLAN_EN)
                  }
                  confirmation={{
                    question: t(
                      `Valider la version ${v.version} du plan ?`,
                      `Approve version ${v.version} of the plan?`,
                    ),
                    libelleConfirmation: t("Oui, valider", "Yes, approve"),
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
          libelle={t("Créer une version à valider", "Create a version for approval")}
          chemin={cheminVersionsPlan(dossierId)}
          corps={{}}
          succes={t(
            "Version du plan créée : elle attend sa validation.",
            "Plan version created: it awaits approval.",
          )}
          variante="secondaire"
        />
      ) : null}
    </div>
  );
}
