import Link from "next/link";
import type { Metadata } from "next";
import { aPermission } from "@missionpilot/shared";
import "../../../../../../../components/plan-montecarlo/plan-montecarlo.css";
import { FormulaireSimulation } from "../../../../../../../components/plan-montecarlo/FormulaireSimulation";
import { ListeSimulations } from "../../../../../../../components/plan-montecarlo/ListeSimulations";
import { ResultatSimulation } from "../../../../../../../components/plan-montecarlo/ResultatSimulation";
import { Alerte } from "../../../../../../../components/ui/Alerte";
import { Carte } from "../../../../../../../components/ui/Carte";
import { EtatErreur, EtatVide } from "../../../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../../../lib/api-serveur";
import { obtenirLangue, obtenirT } from "../../../../../../../lib/i18n/serveur";
import { chargerMission } from "../../../../../../../lib/missions-serveur";
import { cheminListeModeles, type PageVersionsModele } from "../../../../../../../lib/plan-modele";
import {
  cheminDefauts,
  cheminListeSimulations,
  cheminSimulation,
  hrefSimulation,
  lireIdSimulation,
  mentionIndicative,
  versionParDefaut,
  type DefautsMonteCarlo,
  type PageSimulations,
  type SimulationMonteCarlo,
  type VersionProposee,
} from "../../../../../../../lib/plan-montecarlo";
import { chargerPlan } from "../../../../../../../lib/plan-serveur";
import {
  droitsPlan,
  hrefModele,
  lireCurseur,
  messageMissionCloturee,
  type ContextePlan,
} from "../../../../../../../lib/plan-strategique";
import { exigerPermission } from "../../../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Simulation de Monte-Carlo du plan", "Plan Monte Carlo simulation") };
}

const SIMULATIONS_PAR_PAGE = 10;
/** Versions proposées au choix : les 100 plus récentes (maximum d'une page de l'API). */
const VERSIONS_PROPOSEES = 100;

/**
 * Simulation de Monte-Carlo du plan financier (PLA-16) : lancement sur une version du modèle,
 * résultat enregistré (distribution de la VAN, probabilités, graine et empreinte), rejeu à
 * l'identique et simulations passées. Tous les chiffres viennent de l'API (moteur) ; la
 * simulation est indicative et ne modifie ni le plan ni le modèle.
 */
export default async function PageSimulationPlan({
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
  const sp = await searchParams;
  const [mission, r] = await Promise.all([chargerMission(id), chargerPlan(planId)]);
  // La mise en page affiche les erreurs de chargement (mission, plan).
  if (!mission.ok || !r.ok || r.donnees.mission_id !== mission.donnees.id) return null;
  const m = mission.donnees;
  const plan = r.donnees;
  const ctx: ContextePlan = { roles: utilisateur.roles, utilisateurId: utilisateur.id, mission: m };
  const droits = droitsPlan(ctx);
  const peutEcrire = aPermission(utilisateur.roles, "plan.ecrire");
  const curseur = lireCurseur(sp.curseur);
  const demandee = lireIdSimulation(sp.simulation);

  const [modeles, defauts, liste, detailDemande] = await Promise.all([
    plan.modele
      ? chargerServeur<PageVersionsModele>(cheminListeModeles(plan.id, VERSIONS_PROPOSEES, null))
      : null,
    plan.modele && peutEcrire ? chargerServeur<DefautsMonteCarlo>(cheminDefauts(plan.id)) : null,
    chargerServeur<PageSimulations>(cheminListeSimulations(plan.id, SIMULATIONS_PAR_PAGE, curseur)),
    demandee ? chargerServeur<SimulationMonteCarlo>(cheminSimulation(plan.id, demandee)) : null,
  ]);
  // Sans simulation demandée, on affiche la plus récente de la première page.
  const premiere = liste.ok && !curseur ? liste.donnees.elements[0] : undefined;
  const detail =
    detailDemande ??
    (premiere
      ? await chargerServeur<SimulationMonteCarlo>(cheminSimulation(plan.id, premiere.id))
      : null);
  const introuvable =
    demandee !== null &&
    detailDemande !== null &&
    !detailDemande.ok &&
    detailDemande.statut === 404;
  const simulation = detail?.ok ? detail.donnees : null;

  const versions: VersionProposee[] = modeles?.ok
    ? modeles.donnees.elements.map((v) => ({ version: v.version, validee: v.validation !== null }))
    : [];
  const lancement = droits.rediger
    ? null
    : droits.cloturee
      ? messageMissionCloturee(langue)
      : t(
          "Lancer une simulation est réservé aux rédacteurs du plan.",
          "Running a simulation is restricted to plan authors.",
        );

  return (
    <>
      <Alerte tonalite="info" annonce="aucune">
        <p>{mentionIndicative(langue)}</p>
      </Alerte>

      <Carte titre={t("Lancer une simulation", "Run a simulation")} niveauTitre={3}>
        {!plan.modele ? (
          <EtatVide
            titre={t(
              "Aucune version du modèle financier à simuler.",
              "No financial model version to simulate.",
            )}
            icone="courbe"
          >
            <p>
              {t("Enregistrez d'abord une version dans l'onglet", "First save a version in the")}{" "}
              <Link href={hrefModele(m.id, plan.id)}>
                {t("Modèle financier", "Financial model")}
              </Link>
              {t(".", " tab.")}
            </p>
          </EtatVide>
        ) : lancement ? (
          <Alerte tonalite="attention" annonce="aucune">
            <p>{lancement}</p>
          </Alerte>
        ) : modeles && !modeles.ok ? (
          <EtatErreur
            titre={t(
              "Les versions du modèle n'ont pas pu être chargées.",
              "The model versions could not be loaded.",
            )}
            message={modeles.message}
            hrefReessayer={hrefSimulation(m.id, plan.id, { simulation: demandee, curseur })}
          />
        ) : defauts && !defauts.ok ? (
          <EtatErreur
            titre={t(
              "Les lois de départ n'ont pas pu être chargées.",
              "The starting distributions could not be loaded.",
            )}
            message={defauts.message}
            hrefReessayer={hrefSimulation(m.id, plan.id, { simulation: demandee, curseur })}
          />
        ) : defauts?.ok ? (
          <FormulaireSimulation
            missionId={m.id}
            planId={plan.id}
            versions={versions}
            versionInitiale={versionParDefaut(versions)}
            defauts={defauts.donnees.hypotheses}
          />
        ) : null}
      </Carte>

      <Carte titre={t("Résultat", "Result")} niveauTitre={3}>
        {introuvable ? (
          <Alerte
            tonalite="attention"
            titre={t("Simulation introuvable", "Simulation not found")}
            annonce="aucune"
          >
            <p>
              {t(
                "Cette simulation n'existe pas pour ce plan.",
                "This simulation does not exist for this plan.",
              )}{" "}
              <Link href={hrefSimulation(m.id, plan.id)}>
                {t("Afficher la plus récente", "Show the most recent")}
              </Link>
            </p>
          </Alerte>
        ) : detail && !detail.ok ? (
          <EtatErreur
            titre={t(
              "Cette simulation n'a pas pu être chargée.",
              "This simulation could not be loaded.",
            )}
            message={detail.message}
            hrefReessayer={hrefSimulation(m.id, plan.id, { simulation: demandee, curseur })}
          />
        ) : simulation ? (
          <ResultatSimulation simulation={simulation} devise={plan.devise} />
        ) : (
          <EtatVide
            titre={t("Aucune simulation pour ce plan.", "No simulation for this plan.")}
            icone="courbe"
          >
            <p>
              {peutEcrire
                ? t(
                    "Choisissez les hypothèses incertaines ci-dessus, puis lancez une simulation : la distribution de la VAN et le risque de tension de trésorerie s'afficheront ici.",
                    "Choose the uncertain assumptions above, then run a simulation: the NPV distribution and the cash shortfall risk will appear here.",
                  )
                : t(
                    "Les rédacteurs du plan n'ont pas encore lancé de simulation.",
                    "The plan authors have not run a simulation yet.",
                  )}
            </p>
          </EtatVide>
        )}
      </Carte>

      <Carte titre={t("Simulations passées", "Past simulations")} niveauTitre={3}>
        {liste.ok ? (
          <ListeSimulations
            missionId={m.id}
            planId={plan.id}
            simulations={liste.donnees.elements}
            affichee={simulation?.id ?? null}
            curseur={curseur}
            curseurSuivant={liste.donnees.curseur_suivant}
          />
        ) : (
          <EtatErreur
            titre={t(
              "Les simulations n'ont pas pu être chargées.",
              "The simulations could not be loaded.",
            )}
            message={liste.message}
            hrefReessayer={hrefSimulation(m.id, plan.id, { simulation: demandee, curseur })}
          />
        )}
      </Carte>
    </>
  );
}
