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
import { obtenirLangue, obtenirT } from "../../../../../../../lib/i18n/serveur";
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
  messagePlafond,
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
  messageMissionCloturee,
  raisonValidationModele,
  type ContextePlan,
} from "../../../../../../../lib/plan-strategique";
import { exigerPermission } from "../../../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Modèle financier du plan", "Plan financial model") };
}

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
  const peutSimuler = aPermission(utilisateur.roles, "plan.ecrire");
  const derniere = plan.modele;
  const demandee = lireNumeroVersionModele(sp.version);
  const numero = demandee ?? derniere?.version ?? null;
  const curseur = lireCurseur(sp.curseur);
  const comparaison = lireComparaison(sp.de, sp.a, langue);
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
    ? messageMissionCloturee(langue)
    : plafond
      ? messagePlafond(langue)
      : null;
  const initiale = version
    ? saisieDepuisHypotheses(version.hypotheses, version.ecarts, plan.devise, plan.horizon)
    : saisieHypothesesInitiale(plan.horizon, anneeSuivante());

  return (
    <>
      <p className="mp-texte-doux">
        {t(
          "Compte de résultat, bilan et tableau des flux prévisionnels au format SYSCOHADA révisé simplifié, indicateurs, scénarios et alertes : tous les chiffres sont calculés par le moteur de CabinetPilot à partir des hypothèses saisies, jamais par l'IA. Impôt sur les sociétés (25 %) et taux d'actualisation (12 %) sont des valeurs de départ, à faire confirmer par un expert.",
          "Projected income statement, balance sheet and cash flow statement in simplified revised SYSCOHADA format, indicators, scenarios and alerts: all figures are computed by the CabinetPilot engine from the entered assumptions, never by the AI. Corporate income tax (25%) and the discount rate (12%) are starting values, to be confirmed by an expert.",
        )}
      </p>

      {premier(sp.enregistree) === "1" && version ? (
        <Alerte tonalite="succes" annonce="status">
          <p>
            {messageVersionEnregistree(version.version, premier(sp.partage_retire) === "1", langue)}
          </p>
        </Alerte>
      ) : null}
      {plafond ? (
        <Alerte
          tonalite="attention"
          titre={t("Plafond de versions atteint", "Version limit reached")}
          annonce="aucune"
        >
          <p>{messagePlafond(langue)}</p>
        </Alerte>
      ) : null}
      {introuvable ? (
        <Alerte
          tonalite="attention"
          titre={t("Version introuvable", "Version not found")}
          annonce="aucune"
        >
          <p>
            {t(
              `La version ${demandee} n'existe pas pour ce plan.`,
              `Version ${demandee} does not exist for this plan.`,
            )}{" "}
            <Link href={hrefModele(m.id, plan.id)}>
              {t("Afficher la dernière version", "Show the latest version")}
            </Link>
          </p>
        </Alerte>
      ) : null}

      <Carte
        titre={
          version
            ? t(
                `Version ${version.version} du modèle financier`,
                `Version ${version.version} of the financial model`,
              )
            : t("Modèle financier", "Financial model")
        }
        niveauTitre={3}
      >
        {!derniere ? (
          <EtatVide
            titre={t("Aucune version du modèle financier.", "No financial model version.")}
            icone="courbe"
          >
            <p>
              {peutSimuler
                ? t(
                    "Saisissez les hypothèses ci-dessous, simulez, puis enregistrez une première version : elle devra être validée par un responsable de la mission.",
                    "Enter the assumptions below, simulate, then save a first version: it must be approved by an engagement lead.",
                  )
                : t(
                    "Les rédacteurs du plan n'ont pas encore enregistré de version du modèle financier.",
                    "The plan authors have not saved a financial model version yet.",
                  )}
            </p>
          </EtatVide>
        ) : vue && !vue.ok && !introuvable ? (
          <EtatErreur
            titre={t(
              "Cette version du modèle n'a pas pu être chargée.",
              "This model version could not be loaded.",
            )}
            message={vue.message}
            hrefReessayer={hrefModele(m.id, plan.id, { version: numero })}
          />
        ) : version ? (
          <div className="mp-plan">
            <p className="mp-texte-doux mp-texte-petit">
              {libelleVersionModele(version, langue)}
              {version.commentaire
                ? langue === "en"
                  ? ` — \u201c${version.commentaire}\u201d`
                  : ` — « ${version.commentaire} »`
                : ""}
            </p>
            <ValidationVersionModele
              planId={plan.id}
              version={version.version}
              validation={version.validation}
              peutValider={droits.valider}
              raison={raisonValidationModele(version, ctx, langue)}
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
        <Carte
          titre={t(
            "Hypothèses : simuler ou enregistrer une version",
            "Assumptions: simulate or save a version",
          )}
          niveauTitre={3}
        >
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

      <Carte
        titre={t("Retour sur investissement par initiative", "Return on investment by initiative")}
        niveauTitre={3}
      >
        {roi.ok ? (
          <RoiInitiatives roi={roi.donnees} devise={plan.devise} />
        ) : (
          <EtatErreur
            titre={t(
              "Le ROI des initiatives n'a pas pu être chargé.",
              "The initiatives' ROI could not be loaded.",
            )}
            message={roi.message}
            hrefReessayer={hrefModele(m.id, plan.id, { version: numero })}
          />
        )}
      </Carte>

      {derniere ? (
        <Carte titre={t("Versions enregistrées", "Saved versions")} niveauTitre={3}>
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
              titre={t(
                "Les versions du modèle n'ont pas pu être chargées.",
                "The model versions could not be loaded.",
              )}
              message={versions.message}
              hrefReessayer={hrefModele(m.id, plan.id, { version: numero })}
            />
          ) : null}
        </Carte>
      ) : null}

      {derniere && derniere.version > 1 ? (
        <Carte titre={t("Comparer deux versions", "Compare two versions")} niveauTitre={3}>
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
              <Alerte
                tonalite="danger"
                titre={t("Comparaison impossible", "Comparison not possible")}
                annonce="alert"
              >
                <p>
                  {comp.statut === 404
                    ? t(
                        "L'une des deux versions n'existe pas pour ce plan.",
                        "One of the two versions does not exist for this plan.",
                      )
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
