import Link from "next/link";
import type { Metadata } from "next";
import { aPermission } from "@missionpilot/shared";
import "../../../../../../../components/plan-vivant/plan-vivant.css";
import { ExplicationReprevision } from "../../../../../../../components/plan-vivant/ExplicationReprevision";
import { FormulaireRealises } from "../../../../../../../components/plan-vivant/FormulaireRealises";
import { FormulaireReprevision } from "../../../../../../../components/plan-vivant/FormulaireReprevision";
import { ListeReprevisions } from "../../../../../../../components/plan-vivant/ListeReprevisions";
import { ResultatReprevision } from "../../../../../../../components/plan-vivant/ResultatReprevision";
import { Alerte } from "../../../../../../../components/ui/Alerte";
import { Carte } from "../../../../../../../components/ui/Carte";
import { EtatErreur, EtatVide } from "../../../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../../../lib/api-serveur";
import type { GenerationIa } from "../../../../../../../lib/ia-contenu";
import { chargerMission } from "../../../../../../../lib/missions-serveur";
import {
  cheminListeModeles,
  cheminVersionModele,
  type PageVersionsModele,
  type VersionModele,
} from "../../../../../../../lib/plan-modele";
import { chargerPlan } from "../../../../../../../lib/plan-serveur";
import {
  droitsPlan,
  hrefModele,
  lireCurseur,
  MESSAGE_MISSION_CLOTUREE,
  type ContextePlan,
} from "../../../../../../../lib/plan-strategique";
import {
  cheminExplication,
  cheminListeReprevisions,
  cheminRealises,
  cheminReprevision,
  exercicesHorizon,
  hrefPlanVivant,
  lireExercice,
  lireIdReprevision,
  MENTION_PLAN_VIVANT,
  MESSAGE_AUCUN_REALISE,
  MESSAGE_AUCUNE_VERSION_VALIDEE,
  versionParDefaut,
  versionsValidees,
  type PageReprevisions,
  type ReponseRealises,
  type Reprevision,
  type VersionRetenue,
} from "../../../../../../../lib/plan-vivant";
import { exigerPermission } from "../../../../../../../lib/session";

export const metadata: Metadata = { title: "Plan vivant" };

const REPREVISIONS_PAR_PAGE = 10;
/** Versions proposées au choix : les 100 plus récentes (maximum d'une page de l'API). */
const VERSIONS_PROPOSEES = 100;

/**
 * Plan vivant (PLA-18) : saisie des réalisés trimestriels d'un exercice, re-prévision calculée par le
 * moteur à partir d'une version VALIDÉE du modèle, écarts plan et réel expliqués. Tous les chiffres
 * viennent de l'API (moteur) ; le plan validé n'est jamais modifié.
 */
export default async function PagePlanVivant({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; planId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
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
  const curseur = lireCurseur(sp.curseur);
  const demandee = lireIdReprevision(sp.reprevision);

  const modeles = plan.modele
    ? await chargerServeur<PageVersionsModele>(
        cheminListeModeles(plan.id, VERSIONS_PROPOSEES, null),
      )
    : null;
  const versions: VersionRetenue[] = modeles?.ok
    ? modeles.donnees.elements.map((v) => ({ version: v.version, validee: v.validation !== null }))
    : [];
  const validees = versionsValidees(versions);
  const versionInitiale = versionParDefaut(versions);
  const versionHorizon =
    versionInitiale !== null
      ? await chargerServeur<VersionModele>(cheminVersionModele(plan.id, versionInitiale))
      : null;
  const exercices = versionHorizon?.ok
    ? exercicesHorizon(versionHorizon.donnees.hypotheses.premierExercice, plan.horizon)
    : [];
  const exerciceDemande = lireExercice(sp.exercice);
  const exercice =
    exerciceDemande !== null && exercices.includes(exerciceDemande)
      ? exerciceDemande
      : (exercices[0] ?? null);

  const [realises, liste, detailDemande] = await Promise.all([
    exercice !== null ? chargerServeur<ReponseRealises>(cheminRealises(plan.id, exercice)) : null,
    chargerServeur<PageReprevisions>(
      cheminListeReprevisions(plan.id, REPREVISIONS_PAR_PAGE, curseur),
    ),
    demandee ? chargerServeur<Reprevision>(cheminReprevision(plan.id, demandee)) : null,
  ]);
  // Sans re-prévision demandée, on affiche la plus récente de la première page.
  const premiere = liste.ok && !curseur ? liste.donnees.elements[0] : undefined;
  const detail =
    detailDemande ??
    (premiere ? await chargerServeur<Reprevision>(cheminReprevision(plan.id, premiere.id)) : null);
  const introuvable =
    demandee !== null &&
    detailDemande !== null &&
    !detailDemande.ok &&
    detailDemande.statut === 404;
  const reprevision = detail?.ok ? detail.donnees : null;
  const explication = reprevision
    ? await chargerServeur<{ explication: GenerationIa | null }>(
        cheminExplication(plan.id, reprevision.id),
      )
    : null;

  const peutGenererIa = droits.rediger && aPermission(utilisateur.roles, "ia.utiliser");
  const reessayer = hrefPlanVivant(m.id, plan.id, { exercice, reprevision: demandee, curseur });
  const lecture = droits.rediger
    ? null
    : droits.cloturee
      ? MESSAGE_MISSION_CLOTUREE
      : "La saisie des réalisés et la re-prévision sont réservées aux rédacteurs du plan.";
  const groupes = realises?.ok ? realises.donnees.realises : [];

  return (
    <>
      <Alerte tonalite="info" annonce="aucune">
        <p>{MENTION_PLAN_VIVANT}</p>
      </Alerte>

      {!plan.modele || validees.length === 0 ? (
        <Carte titre="Réalisés et re-prévision" niveauTitre={3}>
          <EtatVide titre="Aucune version validée du modèle financier." icone="courbe">
            <p>
              {plan.modele ? MESSAGE_AUCUNE_VERSION_VALIDEE : "Aucune version du modèle financier."}{" "}
              <Link href={hrefModele(m.id, plan.id)}>Ouvrir le modèle financier</Link>
            </p>
          </EtatVide>
        </Carte>
      ) : modeles && !modeles.ok ? (
        <EtatErreur
          titre="Les versions du modèle n'ont pas pu être chargées."
          message={modeles.message}
          hrefReessayer={reessayer}
        />
      ) : exercice === null ? (
        <EtatErreur
          titre="L'horizon du modèle n'a pas pu être chargé."
          message={versionHorizon && !versionHorizon.ok ? versionHorizon.message : "Réessayez."}
          hrefReessayer={reessayer}
        />
      ) : (
        <>
          <nav aria-label="Exercice">
            <ul className="mp-pv__exercices">
              {exercices.map((e) => (
                <li key={e}>
                  <Link
                    className="mp-pv__exercice"
                    href={hrefPlanVivant(m.id, plan.id, { exercice: e })}
                    aria-current={e === exercice ? "page" : undefined}
                  >
                    Exercice {e}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <Carte titre={`Réalisés de l'exercice ${exercice}`} niveauTitre={3}>
            {realises && !realises.ok ? (
              <EtatErreur
                titre="Les réalisés n'ont pas pu être chargés."
                message={realises.message}
                hrefReessayer={reessayer}
              />
            ) : lecture ? (
              <>
                <Alerte tonalite="attention" annonce="aucune">
                  <p>{lecture}</p>
                </Alerte>
                {groupes.length === 0 ? (
                  <p className="mp-texte-doux">{MESSAGE_AUCUN_REALISE}</p>
                ) : null}
              </>
            ) : (
              <FormulaireRealises
                key={`${exercice}-${groupes.map((g) => `${g.trimestre}.${g.courant.version}`).join("_")}`}
                planId={plan.id}
                exercice={exercice}
                devise={plan.devise}
                realises={groupes}
              />
            )}
          </Carte>

          {droits.rediger ? (
            <Carte titre="Re-prévoir l'exercice" niveauTitre={3}>
              <FormulaireReprevision
                missionId={m.id}
                planId={plan.id}
                exercice={exercice}
                versions={validees}
                versionInitiale={versionInitiale}
                trimestresSaisis={groupes.length}
              />
            </Carte>
          ) : null}
        </>
      )}

      <Carte titre="Résultat de la re-prévision" niveauTitre={3}>
        {introuvable ? (
          <Alerte tonalite="attention" titre="Re-prévision introuvable" annonce="aucune">
            <p>
              Cette re-prévision n&apos;existe pas pour ce plan.{" "}
              <Link href={hrefPlanVivant(m.id, plan.id)}>Afficher la plus récente</Link>
            </p>
          </Alerte>
        ) : detail && !detail.ok ? (
          <EtatErreur
            titre="Cette re-prévision n'a pas pu être chargée."
            message={detail.message}
            hrefReessayer={reessayer}
          />
        ) : reprevision ? (
          <ResultatReprevision reprevision={reprevision} devise={plan.devise} />
        ) : (
          <EtatVide titre="Aucune re-prévision pour ce plan." icone="courbe">
            <p>
              Saisissez les réalisés d&apos;un exercice puis lancez une re-prévision : les écarts
              entre le plan et le réel s&apos;afficheront ici.
            </p>
          </EtatVide>
        )}
      </Carte>

      {reprevision ? (
        <Carte titre="Explication de l'IA (brouillon)" niveauTitre={3}>
          {explication && !explication.ok ? (
            <Alerte tonalite="info" annonce="aucune">
              <p>{explication.message}</p>
            </Alerte>
          ) : (
            <ExplicationReprevision
              key={`${reprevision.id}/${explication?.ok ? (explication.donnees.explication?.id ?? "aucune") : "aucune"}`}
              planId={plan.id}
              reprevisionId={reprevision.id}
              initiale={explication?.ok ? explication.donnees.explication : null}
              peutGenerer={peutGenererIa}
              utilisateur={{ id: utilisateur.id, roles: utilisateur.roles }}
            />
          )}
        </Carte>
      ) : null}

      <Carte titre="Re-prévisions passées" niveauTitre={3}>
        {liste.ok ? (
          <ListeReprevisions
            missionId={m.id}
            planId={plan.id}
            devise={plan.devise}
            reprevisions={liste.donnees.elements}
            affichee={reprevision?.id ?? null}
            curseur={curseur}
            curseurSuivant={liste.donnees.curseur_suivant}
          />
        ) : (
          <EtatErreur
            titre="Les re-prévisions n'ont pas pu être chargées."
            message={liste.message}
            hrefReessayer={reessayer}
          />
        )}
      </Carte>
    </>
  );
}
