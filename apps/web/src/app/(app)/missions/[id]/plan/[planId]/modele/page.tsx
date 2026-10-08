import Link from "next/link";
import type { Metadata } from "next";
import { aPermission } from "@missionpilot/shared";
import {
  FormulaireComparaison,
  ResultatComparaison,
} from "../../../../../../../components/plan/ComparaisonModeles";
import { FormulaireHypotheses } from "../../../../../../../components/plan/FormulaireHypotheses";
import { ResultatModele } from "../../../../../../../components/plan/ResultatModele";
import { RoiInitiatives } from "../../../../../../../components/plan/RoiInitiatives";
import { ValidationVersionModele } from "../../../../../../../components/plan/ValidationVersionModele";
import { VersionsModele } from "../../../../../../../components/plan/VersionsModele";
import { Alerte } from "../../../../../../../components/ui/Alerte";
import { Carte } from "../../../../../../../components/ui/Carte";
import { EtatErreur, EtatVide } from "../../../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../../../lib/api-serveur";
import { chargerMission } from "../../../../../../../lib/missions-serveur";
import {
  saisieDepuisHypotheses,
  saisieHypothesesInitiale,
} from "../../../../../../../lib/plan-hypotheses";
import {
  cheminComparaison,
  cheminListeModeles,
  cheminRoi,
  cheminVersionModele,
  libelleVersionModele,
  lireComparaison,
  lireNumeroVersionModele,
  MESSAGE_PLAFOND,
  messageVersionEnregistree,
  plafondAtteint,
  type ComparaisonModeles,
  type PageVersionsModele,
  type RoiPlan,
  type VersionModele,
} from "../../../../../../../lib/plan-modele";
import { chargerPlan } from "../../../../../../../lib/plan-serveur";
import {
  droitsPlan,
  hrefModele,
  lireCurseur,
  MESSAGE_MISSION_CLOTUREE,
  raisonValidationModele,
  type ContextePlan,
} from "../../../../../../../lib/plan-strategique";
import { exigerPermission } from "../../../../../../../lib/session";

export const metadata: Metadata = { title: "Modèle financier du plan" };

const VERSIONS_PAR_PAGE = 10;

/** Premier exercice proposé dans un formulaire vierge : l'année qui suit. */
const anneeSuivante = () => new Date().getUTCFullYear() + 1;

const premier = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Modèle financier du plan (PLA-06, PLA-07, PLA-09) : version affichée (résultat figé du
 * moteur, validation), saisie des hypothèses avec simulation sans enregistrement, ROI par
 * initiative, versions enregistrées et comparaison de deux versions. Tous les chiffres
 * viennent de l'API ; rien n'est conservé dans le navigateur.
 */
export default async function PageModelePlan({
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
  const peutSimuler = aPermission(utilisateur.roles, "plan.ecrire");
  const derniere = plan.modele;
  const demandee = lireNumeroVersionModele(sp.version);
  const numero = demandee ?? derniere?.version ?? null;
  const curseur = lireCurseur(sp.curseur);
  const comparaison = lireComparaison(sp.de, sp.a);
  const plafond = plafondAtteint(derniere?.version);

  const [vue, versions, comp] = await Promise.all([
    numero ? chargerServeur<VersionModele>(cheminVersionModele(plan.id, numero)) : null,
    derniere
      ? chargerServeur<PageVersionsModele>(cheminListeModeles(plan.id, VERSIONS_PAR_PAGE, curseur))
      : null,
    comparaison && !("erreur" in comparaison)
      ? chargerServeur<ComparaisonModeles>(
          cheminComparaison(plan.id, comparaison.de, comparaison.a),
        )
      : null,
  ]);
  const version = vue?.ok ? vue.donnees : null;
  // ROI au taux de la version affichée ; sans elle, l'API retient la dernière validée.
  const roi = await chargerServeur<RoiPlan>(cheminRoi(plan.id, version?.version ?? null));
  const introuvable = demandee !== null && vue !== null && !vue.ok && vue.statut === 404;
  const raisonEnregistrement = droits.cloturee
    ? MESSAGE_MISSION_CLOTUREE
    : plafond
      ? MESSAGE_PLAFOND
      : null;
  const initiale = version
    ? saisieDepuisHypotheses(version.hypotheses, version.ecarts, plan.devise, plan.horizon)
    : saisieHypothesesInitiale(plan.horizon, anneeSuivante());

  return (
    <>
      <p className="mp-texte-doux">
        Compte de résultat, bilan et tableau des flux prévisionnels au format SYSCOHADA révisé
        simplifié, indicateurs, scénarios et alertes : tous les chiffres sont calculés par le moteur
        de MissionPilot à partir des hypothèses saisies, jamais par l&apos;IA. Impôt sur les
        sociétés (25 %) et taux d&apos;actualisation (12 %) sont des valeurs de départ, à faire
        confirmer par un expert.
      </p>

      {premier(sp.enregistree) === "1" && version ? (
        <Alerte tonalite="succes" annonce="status">
          <p>{messageVersionEnregistree(version.version, premier(sp.partage_retire) === "1")}</p>
        </Alerte>
      ) : null}
      {plafond ? (
        <Alerte tonalite="attention" titre="Plafond de versions atteint" annonce="aucune">
          <p>{MESSAGE_PLAFOND}</p>
        </Alerte>
      ) : null}
      {introuvable ? (
        <Alerte tonalite="attention" titre="Version introuvable" annonce="aucune">
          <p>
            La version {demandee} n&apos;existe pas pour ce plan.{" "}
            <Link href={hrefModele(m.id, plan.id)}>Afficher la dernière version</Link>
          </p>
        </Alerte>
      ) : null}

      <Carte
        titre={version ? `Version ${version.version} du modèle financier` : "Modèle financier"}
        niveauTitre={3}
      >
        {!derniere ? (
          <EtatVide titre="Aucune version du modèle financier." icone="courbe">
            <p>
              {peutSimuler
                ? "Saisissez les hypothèses ci-dessous, simulez, puis enregistrez une première version : elle devra être validée par un responsable de la mission."
                : "Les rédacteurs du plan n'ont pas encore enregistré de version du modèle financier."}
            </p>
          </EtatVide>
        ) : vue && !vue.ok && !introuvable ? (
          <EtatErreur
            titre="Cette version du modèle n'a pas pu être chargée."
            message={vue.message}
            hrefReessayer={hrefModele(m.id, plan.id, { version: numero })}
          />
        ) : version ? (
          <div className="mp-plan">
            <p className="mp-texte-doux mp-texte-petit">
              {libelleVersionModele(version)}
              {version.commentaire ? ` — « ${version.commentaire} »` : ""}
            </p>
            <ValidationVersionModele
              planId={plan.id}
              version={version.version}
              validation={version.validation}
              peutValider={droits.valider}
              raison={raisonValidationModele(version, ctx)}
            />
            <ResultatModele
              resultat={version.resultat}
              devise={plan.devise}
              idPrefixe={`version-${version.version}`}
              niveauTitre={4}
            />
          </div>
        ) : null}
      </Carte>

      {peutSimuler ? (
        <Carte titre="Hypothèses : simuler ou enregistrer une version" niveauTitre={3}>
          <FormulaireHypotheses
            key={`hypotheses-${version?.version ?? 0}`}
            planId={plan.id}
            missionId={m.id}
            horizon={plan.horizon}
            devise={plan.devise}
            initiale={initiale}
            versionSource={version?.version ?? null}
            peutEnregistrer={droits.rediger && !plafond}
            raisonEnregistrement={raisonEnregistrement}
            partage={plan.partage_client}
          />
        </Carte>
      ) : null}

      <Carte titre="Retour sur investissement par initiative" niveauTitre={3}>
        {roi.ok ? (
          <RoiInitiatives roi={roi.donnees} devise={plan.devise} />
        ) : (
          <EtatErreur
            titre="Le ROI des initiatives n'a pas pu être chargé."
            message={roi.message}
            hrefReessayer={hrefModele(m.id, plan.id, { version: numero })}
          />
        )}
      </Carte>

      {derniere ? (
        <Carte titre="Versions enregistrées" niveauTitre={3}>
          {versions?.ok ? (
            <VersionsModele
              missionId={m.id}
              planId={plan.id}
              versions={versions.donnees.elements}
              courante={version?.version ?? null}
              curseur={curseur}
              curseurSuivant={versions.donnees.curseur_suivant}
            />
          ) : versions ? (
            <EtatErreur
              titre="Les versions du modèle n'ont pas pu être chargées."
              message={versions.message}
              hrefReessayer={hrefModele(m.id, plan.id, { version: numero })}
            />
          ) : null}
        </Carte>
      ) : null}

      {derniere && derniere.version > 1 ? (
        <Carte titre="Comparer deux versions" niveauTitre={3}>
          <div className="mp-plan__section">
            <FormulaireComparaison
              action={hrefModele(m.id, plan.id)}
              versionAffichee={version?.version ?? null}
              de={comparaison && !("erreur" in comparaison) ? comparaison.de : null}
              a={comparaison && !("erreur" in comparaison) ? comparaison.a : null}
              derniere={derniere.version}
            />
            {comparaison && "erreur" in comparaison ? (
              <Alerte tonalite="attention" annonce="aucune">
                <p>{comparaison.erreur}</p>
              </Alerte>
            ) : null}
            {comp && !comp.ok ? (
              <Alerte tonalite="danger" titre="Comparaison impossible" annonce="alert">
                <p>
                  {comp.statut === 404
                    ? "L'une des deux versions n'existe pas pour ce plan."
                    : comp.message}
                </p>
              </Alerte>
            ) : null}
            {comp?.ok ? (
              <ResultatComparaison comparaison={comp.donnees} devise={plan.devise} />
            ) : null}
          </div>
        </Carte>
      ) : null}
    </>
  );
}
