import type { Metadata } from "next";
import { aPermission } from "@missionpilot/shared";
import { Carte } from "../../../../../components/ui/Carte";
import { EtatErreur } from "../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../lib/api-serveur";
import { budgetsParNoeud, type Decoupage, type NoeudSynthese } from "../../../../../lib/decoupage";
import { obtenirLangue, obtenirT } from "../../../../../lib/i18n/serveur";
import { droitsMission } from "../../../../../lib/missions";
import { chargerMission } from "../../../../../lib/missions-serveur";
import { chargerGradesActifs } from "../../../../../lib/referentiels-serveur";
import { exigerPermission } from "../../../../../lib/session";
import { SyntheseBudgetJours } from "../SyntheseBudgetJours";
import { ArbreDecoupage } from "./ArbreDecoupage";
import { Jalons } from "./Jalons";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Découpage de la mission", "Engagement work breakdown") };
}

export default async function PageDecoupage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const { utilisateur } = await exigerPermission("mission.lire");
  const roles = utilisateur.roles;
  const r = await chargerMission(id);
  if (!r.ok) return null;
  const m = r.donnees;
  const droits = droitsMission(m, roles, utilisateur.id, langue);
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
        titre={t("Le découpage n'a pas pu être chargé.", "The work breakdown could not be loaded.")}
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
            titre={t(
              "La synthèse du budget en jours n'a pas pu être chargée.",
              "The budget-in-days summary could not be loaded.",
            )}
            message={synthese.message}
            hrefReessayer={`/missions/${m.id}/decoupage`}
          />
        ) : racine ? (
          <SyntheseBudgetJours racine={racine} />
        ) : null
      ) : null}

      <section aria-labelledby="titre-arbre" className="mp-pile">
        <h2 id="titre-arbre" className="mp-section__titre">
          {t("Phases, lots et tâches", "Phases, work packages and tasks")}
        </h2>
        {droits.planifier ? (
          <p className="mp-texte-doux">
            {t(
              "Réorganisez avec « Monter », « Descendre » et « Déplacer vers… » ; le budget en jours se saisit par tâche et remonte automatiquement aux lots et aux phases.",
              "Reorder with \u201cMove up\u201d, \u201cMove down\u201d and \u201cMove to…\u201d; the budget in days is entered per task and rolls up automatically to work packages and phases.",
            )}
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

      <Carte titre={t("Jalons", "Milestones")}>
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
