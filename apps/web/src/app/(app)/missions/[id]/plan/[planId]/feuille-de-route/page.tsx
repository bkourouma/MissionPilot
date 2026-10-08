import Link from "next/link";
import type { Metadata } from "next";
import { FeuilleDeRoute } from "../../../../../../../components/plan/FeuilleDeRoute";
import { RecalageFeuilleDeRoute } from "../../../../../../../components/plan/RecalageFeuilleDeRoute";
import { Alerte } from "../../../../../../../components/ui/Alerte";
import { Carte } from "../../../../../../../components/ui/Carte";
import { EtatErreur, EtatVide } from "../../../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../../../lib/api-serveur";
import { chargerMission } from "../../../../../../../lib/missions-serveur";
import {
  cheminFeuilleDeRoute,
  hrefFeuilleDeRoute,
  initiativesARecaler,
  lirePas,
  PAS_FEUILLE_DE_ROUTE,
  resumeRecalage,
  type FeuilleDeRoute as Feuille,
} from "../../../../../../../lib/plan-feuille-de-route";
import { chargerPlan } from "../../../../../../../lib/plan-serveur";
import {
  droitsPlan,
  MESSAGE_MISSION_CLOTUREE,
  type ContextePlan,
} from "../../../../../../../lib/plan-strategique";
import { exigerPermission } from "../../../../../../../lib/session";

export const metadata: Metadata = { title: "Feuille de route du plan" };

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
          <p>{MESSAGE_MISSION_CLOTUREE}</p>
        </Alerte>
      ) : null}
      <Carte titre="Feuille de route" niveauTitre={3}>
        <div className="mp-plan__section">
          <nav aria-label="Pas de la feuille de route" className="mp-plan__badges">
            {PAS_FEUILLE_DE_ROUTE.map((p) =>
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
              titre="La feuille de route n'a pas pu être calculée."
              message={f.message}
              hrefReessayer={hrefFeuilleDeRoute(id, plan.id, pas)}
            />
          ) : f.donnees.initiatives.length === 0 ? (
            <EtatVide titre="Aucune initiative active." icone="calendrier">
              <p>
                Ajoutez des initiatives (avec leur échéance) dans l&apos;onglet « Contenus » ;
                indiquez pour chacune les initiatives dont elle dépend.
              </p>
            </EtatVide>
          ) : (
            <>
              <p>{resumeRecalage(f.donnees)}</p>
              <p className="mp-texte-doux mp-texte-petit">
                Une initiative ne commence qu&apos;au lendemain de la fin de celles dont elle
                dépend. Les initiatives à lancer ou suspendues sont recalées automatiquement ;
                celles en cours ou terminées gardent leurs dates et le conflit est signalé. Le
                chemin critique est la chaîne d&apos;initiatives qui fixe la fin du plan.
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
