import type { ReactNode } from "react";
import type { RedClotureContenu } from "@missionpilot/shared";
import { formaterMontantMineur, formaterNombre } from "../../lib/format";
import { obtenirLangue, obtenirT } from "../../lib/i18n/serveur";
import { formaterPart, libelleAvancement, libelleVolet } from "../../lib/redressement";
import { libelleSurTotal } from "../../lib/redressement-cloture";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Carte } from "../ui/Carte";

function Liste({ lignes, legende }: { lignes: [string, ReactNode][]; legende: string }) {
  return (
    <dl className="mp-clo-liste-def" aria-label={legende}>
      {lignes.map(([terme, valeur]) => (
        <div key={terme}>
          <dt>{terme}</dt>
          <dd>{valeur}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Plan, créanciers, covenants, check-lists et causes racines du bilan : décomptes, montants et
 * parts déjà calculés par le serveur, mis en forme sans aucune addition.
 */
export async function ClotureAvancement({ contenu }: { contenu: RedClotureContenu }) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const { plan, creanciers: cr, covenants, checklists, causes, devise } = contenu;
  const mt = (v: number) => formaterMontantMineur(v, devise, langue);
  const nb = (v: number) => formaterNombre(v, 0, langue);
  const sur = (n: number, total: number) => libelleSurTotal(n, total, langue);
  return (
    <div className="mp-red-cartes">
      <Carte titre={t("Plan d'action", "Action plan")} niveauTitre={3}>
        <Liste
          legende={t("Avancement du plan", "Plan progress")}
          lignes={[
            [t("Actions terminées", "Completed actions"), sur(plan.terminees, plan.total)],
            [t("Actions abandonnées", "Abandoned actions"), nb(plan.abandonnees)],
            [t("Actions en retard", "Overdue actions"), nb(plan.en_retard)],
            [t("Avancement", "Progress"), libelleAvancement(plan.avancement_pb, langue)],
            [
              `${t("Volet", "Track")} ${libelleVolet("quick_win", langue)}`,
              sur(plan.par_volet.quick_win.terminees, plan.par_volet.quick_win.total),
            ],
            [
              `${t("Volet", "Track")} ${libelleVolet("restructuration", langue)}`,
              sur(plan.par_volet.restructuration.terminees, plan.par_volet.restructuration.total),
            ],
            [
              t("Impact retenu sur la trésorerie", "Retained impact on cash"),
              mt(plan.leviers.impact_tresorerie_unique_retenu),
            ],
            [
              t("Impact réalisé sur la trésorerie", "Realized impact on cash"),
              mt(plan.leviers.impact_tresorerie_unique_realise),
            ],
            [
              t("Impact retenu sur le résultat annuel", "Retained impact on annual result"),
              mt(plan.leviers.impact_resultat_annuel_retenu),
            ],
            [
              t("Impact réalisé sur le résultat annuel", "Realized impact on annual result"),
              mt(plan.leviers.impact_resultat_annuel_realise),
            ],
          ]}
        />
      </Carte>
      <Carte titre={t("Créanciers", "Creditors")} niveauTitre={3}>
        <Liste
          legende={t("Situation des créanciers", "Creditor position")}
          lignes={[
            [t("Créanciers suivis", "Creditors tracked"), nb(cr.nombre)],
            [t("Encours initial", "Initial outstanding"), mt(cr.encours_initial)],
            [t("Encours restant", "Remaining outstanding"), mt(cr.encours_restant)],
            [t("Montant échu", "Amount past due"), mt(cr.echu)],
            [t("Remises obtenues", "Write-offs obtained"), mt(cr.remises_obtenues)],
            [t("Total payé", "Total paid"), mt(cr.total_paye)],
            [t("Apurement", "Settlement"), formaterPart(cr.apurement_pb, langue)],
            [
              t("Accords respectés", "Agreements honored"),
              sur(cr.accords.respectes, cr.accords.total),
            ],
            [t("Accords en retard", "Agreements overdue"), nb(cr.accords.en_retard)],
            [t("Accords soldés", "Agreements settled"), nb(cr.accords.soldes)],
            [t("Accords rompus", "Agreements broken"), nb(cr.accords.rompus)],
          ]}
        />
      </Carte>
      <Carte
        titre={t("Covenants, check-lists et causes", "Covenants, checklists and causes")}
        niveauTitre={3}
      >
        <Liste
          legende={t(
            "Covenants, check-lists et causes racines",
            "Covenants, checklists and root causes",
          )}
          lignes={[
            [
              t("Covenants non respectés", "Covenants not met"),
              covenants.en_defaut === null
                ? t("Aucun covenant défini", "No covenant defined")
                : nb(covenants.en_defaut),
            ],
            [
              t("Check-lists complètes", "Complete checklists"),
              sur(checklists.completes, checklists.nombre),
            ],
            [
              t("Complétude moyenne", "Average completeness"),
              formaterPart(checklists.completude_moyenne_pb, langue),
            ],
            [
              t("Conformité moyenne", "Average compliance"),
              formaterPart(checklists.conformite_moyenne_pb, langue),
            ],
            [
              t("Conformité minimale", "Minimum compliance"),
              formaterPart(checklists.conformite_minimale_pb, langue),
            ],
            [
              t("Causes racines", "Root causes"),
              causes.validee ? (
                <BadgeStatut tonalite="succes">
                  {t(`Validées (${nb(causes.nombre)})`, `Approved (${nb(causes.nombre)})`)}
                </BadgeStatut>
              ) : (
                <BadgeStatut tonalite="attention">{t("Non validées", "Not approved")}</BadgeStatut>
              ),
            ],
          ]}
        />
      </Carte>
    </div>
  );
}
