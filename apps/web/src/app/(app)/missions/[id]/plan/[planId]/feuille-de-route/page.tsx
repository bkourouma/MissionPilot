import Link from "next/link";
import type { Metadata } from "next";
import { FeuilleDeRoute } from "../../../../../../../components/plan/FeuilleDeRoute";
import { RecalageFeuilleDeRoute } from "../../../../../../../components/plan/RecalageFeuilleDeRoute";
import { Alerte } from "../../../../../../../components/ui/Alerte";
import { Carte } from "../../../../../../../components/ui/Carte";
import { EtatErreur, EtatVide } from "../../../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../../../lib/api-serveur";
import { obtenirLangue, obtenirT } from "../../../../../../../lib/i18n/serveur";
import { chargerMission } from "../../../../../../../lib/missions-serveur";
import {
  cheminFeuilleDeRoute,
  hrefFeuilleDeRoute,
  initiativesARecaler,
  lirePas,
  optionsPasFeuilleDeRoute,
  resumeRecalage,
  type FeuilleDeRoute as Feuille,
} from "../../../../../../../lib/plan-feuille-de-route";
import { chargerPlan } from "../../../../../../../lib/plan-serveur";
import {
  droitsPlan,
  messageMissionCloturee,
  type ContextePlan,
} from "../../../../../../../lib/plan-strategique";
import { exigerPermission } from "../../../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Feuille de route du plan", "Plan roadmap") };
}

/**
 * Feuille de route du plan (PLA-05) : initiatives par trimestre ou semestre, dépendances
 * « fin → début » et recalage automatique calculés par le moteur de l'API. Le recalage proposé
 * s'applique en un clic (nouvelles versions à faire valider). Les dépendances se saisissent
 * dans le formulaire de chaque initiative (onglet « Contenus »).
 */
export default async function PageFeuilleDeRoute({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; planId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const { id, planId } = await params;
  const { utilisateur } = await exigerPermission("plan.lire");
  const pas = lirePas((await searchParams).pas);
  const [mission, r] = await Promise.all([chargerMission(id), chargerPlan(planId)]);
  // La mise en page affiche les erreurs de chargement (mission, plan).
  if (!mission.ok || !r.ok || r.donnees.mission_id !== mission.donnees.id) return null;
  const m = mission.donnees;
  const plan = r.donnees;
  const ctx: ContextePlan = { roles: utilisateur.roles, utilisateurId: utilisateur.id, mission: m };
  const droits = droitsPlan(ctx);
  const f = await chargerServeur<Feuille>(cheminFeuilleDeRoute(plan.id, pas));

  return (
    <>
      {droits.cloturee ? (
        <Alerte tonalite="info" annonce="aucune">
          <p>{messageMissionCloturee(langue)}</p>
        </Alerte>
      ) : null}
      <Carte titre={t("Feuille de route", "Roadmap")} niveauTitre={3}>
        <div className="mp-plan__section">
          <nav
            aria-label={t("Pas de la feuille de route", "Roadmap granularity")}
            className="mp-plan__badges"
          >
            {optionsPasFeuilleDeRoute(langue).map((p) =>
              p.valeur === pas ? (
                <span key={p.valeur} aria-current="page" className="mp-texte-petit">
                  <strong>{p.libelle}</strong>
                </span>
              ) : (
                <Link
                  key={p.valeur}
                  className="mp-texte-petit"
                  href={hrefFeuilleDeRoute(id, plan.id, p.valeur)}
                >
                  {p.libelle}
                </Link>
              ),
            )}
          </nav>
          {!f.ok ? (
            <EtatErreur
              titre={t(
                "La feuille de route n'a pas pu être calculée.",
                "The roadmap could not be computed.",
              )}
              message={f.message}
              hrefReessayer={hrefFeuilleDeRoute(id, plan.id, pas)}
            />
          ) : f.donnees.initiatives.length === 0 ? (
            <EtatVide
              titre={t("Aucune initiative active.", "No active initiatives.")}
              icone="calendrier"
            >
              <p>
                {t(
                  "Ajoutez des initiatives (avec leur échéance) dans l'onglet « Contenus » ; indiquez pour chacune les initiatives dont elle dépend.",
                  "Add initiatives (with their due date) in the \u201cContent\u201d tab; for each, indicate the initiatives it depends on.",
                )}
              </p>
            </EtatVide>
          ) : (
            <>
              <p>{resumeRecalage(f.donnees, langue)}</p>
              <p className="mp-texte-doux mp-texte-petit">
                {t(
                  "Une initiative ne commence qu'au lendemain de la fin de celles dont elle dépend. Les initiatives à lancer ou suspendues sont recalées automatiquement ; celles en cours ou terminées gardent leurs dates et le conflit est signalé. Le chemin critique est la chaîne d'initiatives qui fixe la fin du plan.",
                  "An initiative only starts the day after those it depends on end. Initiatives to launch or on hold are rescheduled automatically; those in progress or completed keep their dates and the conflict is flagged. The critical path is the chain of initiatives that sets the end of the plan.",
                )}
              </p>
              {droits.rediger && initiativesARecaler(f.donnees).length ? (
                <RecalageFeuilleDeRoute
                  planId={plan.id}
                  initiatives={initiativesARecaler(f.donnees)}
                  partage={plan.partage_client}
                />
              ) : null}
              <FeuilleDeRoute feuille={f.donnees} />
            </>
          )}
        </div>
      </Carte>
    </>
  );
}
