import type { Metadata } from "next";
import { RED_CODES_LEVIER, type RedPlanVue } from "@missionpilot/shared";
import { EtatContexteRed } from "../../../../../../components/redressement/EtatsContexte";
import { FormulaireAction } from "../../../../../../components/redressement/FormulaireAction";
import { KanbanActions } from "../../../../../../components/redressement/KanbanActions";
import { ResumePlan } from "../../../../../../components/redressement/ResumePlan";
import { VersionsPlan } from "../../../../../../components/redressement/VersionsPlan";
import { Alerte } from "../../../../../../components/ui/Alerte";
import { Carte } from "../../../../../../components/ui/Carte";
import { EtatErreur, EtatVide } from "../../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../../lib/api-serveur";
import { obtenirLangue, obtenirT } from "../../../../../../lib/i18n/serveur";
import { aujourdhui as aujourdhuiIso } from "../../../../../../lib/periode";
import {
  cheminPlan,
  hrefRedressement,
  raisonSansEcriture,
  TEXTE_PLAN_MODIFIE,
  TEXTE_PLAN_MODIFIE_EN,
} from "../../../../../../lib/redressement";
import {
  chargerContexteRed,
  chargerReferentielRed,
  chargerResponsablesPossibles,
} from "../../../../../../lib/redressement-serveur";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Plan de redressement", "Turnaround plan") };
}

/**
 * Plan de redressement (RED-05, RED-07) : résumé calculé par le moteur, kanban sans
 * glisser-déposer, formulaire d'action (levier facultatif, simulation) et versions du plan avec
 * validation (séparation des tâches jugée par l'API).
 */
export default async function PagePlan({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const brutLevier = (await searchParams).levier;
  const ctx = await chargerContexteRed(id);
  if (ctx.etat !== "ok") {
    return (
      <EtatContexteRed contexte={ctx} missionId={id} hrefReessayer={hrefRedressement(id, "plan")} />
    );
  }
  const { mission, dossier, droits } = ctx;
  const [plan, referentiel, responsables] = await Promise.all([
    chargerServeur<RedPlanVue>(cheminPlan(dossier.id)),
    chargerReferentielRed(),
    chargerResponsablesPossibles(ctx.session, mission),
  ]);
  if (!plan.ok) {
    return (
      <EtatErreur
        titre={t("Le plan n'a pas pu être chargé.", "The plan could not be loaded.")}
        message={plan.message}
        hrefReessayer={hrefRedressement(id, "plan")}
      />
    );
  }
  const p = plan.donnees;
  const leviers = referentiel.ok ? referentiel.donnees.leviers : [];
  const levierDemande = Array.isArray(brutLevier) ? brutLevier[0] : brutLevier;
  const levierInitial = (RED_CODES_LEVIER as readonly string[]).includes(levierDemande ?? "")
    ? levierDemande
    : undefined;
  const nombreActions =
    Object.values(p.kanban.colonnes).reduce((n, l) => n + l.length, 0) +
    p.kanban.abandonnees.length;
  const responsableParDefaut =
    responsables.find((r) => r.valeur === ctx.session.utilisateur.id)?.valeur ??
    responsables[0]?.valeur ??
    "";

  return (
    <div className="mp-red">
      {dossier.plan.modifie_depuis_validation ? (
        <Alerte tonalite="attention" annonce="aucune">
          <p>{t(TEXTE_PLAN_MODIFIE, TEXTE_PLAN_MODIFIE_EN)}</p>
        </Alerte>
      ) : null}

      <section className="mp-red-section" aria-labelledby="titre-resume-plan">
        <h2 id="titre-resume-plan" className="mp-red-section__titre">
          {t("Résumé", "Summary")}
        </h2>
        <ResumePlan evaluation={p.evaluation} devise={dossier.devise} />
      </section>

      <section className="mp-red-section" aria-labelledby="titre-kanban">
        <h2 id="titre-kanban" className="mp-red-section__titre">
          {t("Actions", "Actions")}
        </h2>
        {nombreActions === 0 ? (
          <EtatVide titre={t("Aucune action pour l'instant.", "No action yet.")} icone="taches">
            <p>
              {t(
                "Aucune action pour l'instant. Ajoutez des quick wins (3 à 6 mois) puis, si besoin, des actions de restructuration (6 à 24 mois).",
                "No action yet. Add quick wins (3 to 6 months) and, if needed, restructuring actions (6 to 24 months).",
              )}
            </p>
          </EtatVide>
        ) : null}
        <KanbanActions
          kanban={p.kanban}
          dossierId={dossier.id}
          peutEcrire={droits.ecrire}
          devise={dossier.devise}
          responsables={responsables}
          leviers={leviers}
          aujourdhui={aujourdhuiIso()}
          peutAssignerTache={droits.assignerTache}
        />
      </section>

      {droits.ecrire ? (
        <Carte titre={t("Ajouter une action", "Add an action")}>
          {responsables.length === 0 ? (
            <Alerte tonalite="attention" annonce="aucune">
              <p>
                {t(
                  "Aucun responsable possible : la mission n'a ni directeur, ni chef, ni équipe.",
                  "No possible owner: the engagement has no director, manager or team.",
                )}
              </p>
            </Alerte>
          ) : (
            <FormulaireAction
              key={levierInitial ?? "libre"}
              dossierId={dossier.id}
              devise={dossier.devise}
              responsables={responsables}
              leviers={leviers}
              aujourdhui={aujourdhuiIso()}
              peutAssignerTache={droits.assignerTache}
              levierInitial={levierInitial}
              responsableParDefaut={responsableParDefaut}
            />
          )}
        </Carte>
      ) : (
        <p className="mp-texte-doux">
          {raisonSansEcriture(mission, dossier, ctx.session.utilisateur.roles, langue)}
        </p>
      )}

      <section className="mp-red-section" aria-labelledby="titre-versions-plan">
        <h2 id="titre-versions-plan" className="mp-red-section__titre">
          {t("Versions du plan", "Plan versions")}
        </h2>
        <VersionsPlan
          dossierId={dossier.id}
          versions={p.versions}
          ecart={p.ecart_avec_version_validee}
          peutEcrire={droits.ecrire}
          peutValider={droits.valider}
        />
      </section>
    </div>
  );
}
