import type { ReactNode } from "react";
import type { RedClotureContenu } from "@missionpilot/shared";
import { formaterMontantMineur, formaterNombre } from "../../lib/format";
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
export function ClotureAvancement({ contenu }: { contenu: RedClotureContenu }) {
  const { plan, creanciers: cr, covenants, checklists, causes, devise } = contenu;
  const mt = (v: number) => formaterMontantMineur(v, devise);
  return (
    <div className="mp-red-cartes">
      <Carte titre="Plan d'action" niveauTitre={3}>
        <Liste
          legende="Avancement du plan"
          lignes={[
            ["Actions terminées", libelleSurTotal(plan.terminees, plan.total)],
            ["Actions abandonnées", formaterNombre(plan.abandonnees, 0)],
            ["Actions en retard", formaterNombre(plan.en_retard, 0)],
            ["Avancement", libelleAvancement(plan.avancement_pb)],
            [
              `Volet ${libelleVolet("quick_win")}`,
              libelleSurTotal(plan.par_volet.quick_win.terminees, plan.par_volet.quick_win.total),
            ],
            [
              `Volet ${libelleVolet("restructuration")}`,
              libelleSurTotal(
                plan.par_volet.restructuration.terminees,
                plan.par_volet.restructuration.total,
              ),
            ],
            ["Impact retenu sur la trésorerie", mt(plan.leviers.impact_tresorerie_unique_retenu)],
            ["Impact réalisé sur la trésorerie", mt(plan.leviers.impact_tresorerie_unique_realise)],
            [
              "Impact retenu sur le résultat annuel",
              mt(plan.leviers.impact_resultat_annuel_retenu),
            ],
            [
              "Impact réalisé sur le résultat annuel",
              mt(plan.leviers.impact_resultat_annuel_realise),
            ],
          ]}
        />
      </Carte>
      <Carte titre="Créanciers" niveauTitre={3}>
        <Liste
          legende="Situation des créanciers"
          lignes={[
            ["Créanciers suivis", formaterNombre(cr.nombre, 0)],
            ["Encours initial", mt(cr.encours_initial)],
            ["Encours restant", mt(cr.encours_restant)],
            ["Montant échu", mt(cr.echu)],
            ["Remises obtenues", mt(cr.remises_obtenues)],
            ["Total payé", mt(cr.total_paye)],
            ["Apurement", formaterPart(cr.apurement_pb)],
            ["Accords respectés", libelleSurTotal(cr.accords.respectes, cr.accords.total)],
            ["Accords en retard", formaterNombre(cr.accords.en_retard, 0)],
            ["Accords soldés", formaterNombre(cr.accords.soldes, 0)],
            ["Accords rompus", formaterNombre(cr.accords.rompus, 0)],
          ]}
        />
      </Carte>
      <Carte titre="Covenants, check-lists et causes" niveauTitre={3}>
        <Liste
          legende="Covenants, check-lists et causes racines"
          lignes={[
            [
              "Covenants non respectés",
              covenants.en_defaut === null
                ? "Aucun covenant défini"
                : formaterNombre(covenants.en_defaut, 0),
            ],
            ["Check-lists complètes", libelleSurTotal(checklists.completes, checklists.nombre)],
            ["Complétude moyenne", formaterPart(checklists.completude_moyenne_pb)],
            ["Conformité moyenne", formaterPart(checklists.conformite_moyenne_pb)],
            ["Conformité minimale", formaterPart(checklists.conformite_minimale_pb)],
            [
              "Causes racines",
              causes.validee ? (
                <BadgeStatut tonalite="succes">
                  {`Validées (${formaterNombre(causes.nombre, 0)})`}
                </BadgeStatut>
              ) : (
                <BadgeStatut tonalite="attention">Non validées</BadgeStatut>
              ),
            ],
          ]}
        />
      </Carte>
    </div>
  );
}
