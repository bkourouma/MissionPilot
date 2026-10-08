import type { Metadata } from "next";
import { aPermission } from "@missionpilot/shared";
import { Carte } from "../../../../../components/ui/Carte";
import { EtatErreur } from "../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../lib/api-serveur";
import { budgetsParNoeud, type Decoupage, type NoeudSynthese } from "../../../../../lib/decoupage";
import { droitsMission } from "../../../../../lib/missions";
import { chargerMission } from "../../../../../lib/missions-serveur";
import { chargerGradesActifs } from "../../../../../lib/referentiels-serveur";
import { exigerPermission } from "../../../../../lib/session";
import { SyntheseBudgetJours } from "../SyntheseBudgetJours";
import { ArbreDecoupage } from "./ArbreDecoupage";
import { Jalons } from "./Jalons";

export const metadata: Metadata = { title: "Découpage de la mission" };

export default async function PageDecoupage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { utilisateur } = await exigerPermission("mission.lire");
  const roles = utilisateur.roles;
  const r = await chargerMission(id);
  if (!r.ok) return null;
  const m = r.donnees;
  const droits = droitsMission(m, roles, utilisateur.id);
  const [decoupage, synthese, grades] = await Promise.all([
    chargerServeur<Decoupage>(`/api/missions/${m.id}/decoupage`),
    droits.lireBudget
      ? chargerServeur<{ arborescence: NoeudSynthese }>(`/api/missions/${m.id}/synthese`)
      : Promise.resolve(null),
    droits.budgeterJours ? chargerGradesActifs(roles) : Promise.resolve([]),
  ]);
  if (!decoupage.ok) {
    return (
      <EtatErreur
        titre="Le découpage n'a pas pu être chargé."
        message={decoupage.message}
        hrefReessayer={`/missions/${m.id}/decoupage`}
      />
    );
  }
  const racine = synthese?.ok ? synthese.donnees.arborescence : null;
  const d = decoupage.donnees;

  return (
    <div className="mp-pile mp-pile--large">
      {droits.lireBudget ? (
        synthese && !synthese.ok ? (
          <EtatErreur
            titre="La synthèse du budget en jours n'a pas pu être chargée."
            message={synthese.message}
            hrefReessayer={`/missions/${m.id}/decoupage`}
          />
        ) : racine ? (
          <SyntheseBudgetJours racine={racine} />
        ) : null
      ) : null}

      <section aria-labelledby="titre-arbre" className="mp-pile">
        <h2 id="titre-arbre" className="mp-section__titre">
          Phases, lots et tâches
        </h2>
        {droits.planifier ? (
          <p className="mp-texte-doux">
            Réorganisez avec « Monter », « Descendre » et « Déplacer vers… » ; le budget en jours se
            saisit par tâche et remonte automatiquement aux lots et aux phases.
          </p>
        ) : null}
        <ArbreDecoupage
          missionId={m.id}
          decoupage={{ phases: d.phases }}
          grades={grades.map((g) => ({ id: g.id, code: g.code, libelle: g.libelle }))}
          droits={{
            planifier: droits.planifier,
            budgeter: droits.budgeterJours && aPermission(roles, "catalogue.lire"),
            lireBudget: droits.lireBudget,
          }}
          budgets={budgetsParNoeud(racine)}
          collaboration={{ utilisateurId: utilisateur.id, associe: roles.includes("associe") }}
        />
      </section>

      <Carte titre="Jalons">
        <Jalons
          missionId={m.id}
          jalons={d.jalons}
          phases={d.phases.map((p) => ({ valeur: p.id, libelle: p.libelle }))}
          modifiable={droits.planifier}
        />
      </Carte>
    </div>
  );
}
