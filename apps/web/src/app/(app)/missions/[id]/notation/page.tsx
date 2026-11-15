import Link from "next/link";
import type { Metadata } from "next";
import { aPermission, creerTraduire, type Langue } from "@missionpilot/shared";
import { BarresFamilles } from "../../../../../components/notation/BarresFamilles";
import { ComparaisonNotation } from "../../../../../components/notation/ComparaisonNotation";
import { EcartsRepondants } from "../../../../../components/notation/EcartsRepondants";
import { ForcesFaiblesses } from "../../../../../components/notation/ForcesFaiblesses";
import { FormulaireAjustement } from "../../../../../components/notation/FormulaireAjustement";
import { FormulaireCalcul } from "../../../../../components/notation/FormulaireCalcul";
import { GraphiqueRadar } from "../../../../../components/notation/GraphiqueRadar";
import { HistoriqueAjustements } from "../../../../../components/notation/HistoriqueAjustements";
import { ParcoursRevue } from "../../../../../components/notation/ParcoursRevue";
import { GenerationLivrable } from "../../../../../components/rapports/GenerationLivrable";
import { SyntheseNotation } from "../../../../../components/notation/SyntheseNotation";
import { CitationsLivrable } from "../../../../../components/preuves/CitationsLivrable";
import { TableauDimensions } from "../../../../../components/notation/TableauDimensions";
import { VersionsNotation } from "../../../../../components/notation/VersionsNotation";
import "../../../../../components/notation/notation.css";
import { Alerte } from "../../../../../components/ui/Alerte";
import { classesBouton } from "../../../../../components/ui/Bouton";
import { Carte } from "../../../../../components/ui/Carte";
import { EtatErreur, EtatVide } from "../../../../../components/ui/EtatListe";
import { chargerServeur, type Chargement } from "../../../../../lib/api-serveur";
import { obtenirLangue, obtenirT } from "../../../../../lib/i18n/serveur";
import { chargerMission } from "../../../../../lib/missions-serveur";
import {
  blocageCalcul,
  cheminEnvoisMission,
  cheminNotationMission,
  cheminRapportNotation,
  cheminVersionNotation,
  droitsVersion,
  envoisNotables,
  hrefNotation,
  lireNumeroVersion,
  messageSansAjustement,
  versionAffichee,
  type ContexteNotation,
  type EnvoiQuestionnaire,
  type RapportNotation,
  type ResumeNotation,
  type VueVersionNotation,
} from "../../../../../lib/notation";
import { cheminGrilles, type PageGrilles } from "../../../../../lib/notation-grilles";
import { hrefAnalyseNotation } from "../../../../../lib/notation-augmentee";
import { exigerLectureNotation } from "../../../../../lib/notation-serveur";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Notation de la mission", "Engagement rating") };
}

/**
 * Notation de la mission (service 1) : calcul sur les réponses soumises d'un questionnaire,
 * résultat (score global, classe, radar, barres par famille, tableau), forces et faiblesses,
 * écarts entre répondants, ajustements motivés, revue et publication par un expert métier,
 * versions successives et comparaison avec la notation publiée précédente du client.
 *
 * Tous les chiffres sont ceux de l'API (moteurs) : la page n'en recalcule aucun. Rien n'est
 * conservé dans le navigateur (rendu serveur à chaque affichage, aucun stockage local).
 */
export default async function PageNotationMission({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const { id } = await params;
  const { utilisateur } = await exigerLectureNotation();
  const r = await chargerMission(id);
  // L'en-tête (layout) affiche déjà l'erreur de chargement de la mission.
  if (!r.ok) return null;
  const m = r.donnees;
  const roles = utilisateur.roles;
  const gerer = aPermission(roles, "notation.gerer");
  const ctx = { roles, utilisateurId: utilisateur.id, missionCloturee: m.statut === "cloturee" };
  const demandee = lireNumeroVersion((await searchParams).version);

  const [resume, envois, grilles] = await Promise.all([
    chargerServeur<ResumeNotation>(cheminNotationMission(m.id)),
    aPermission(roles, "questionnaire.lire")
      ? chargerServeur<{ elements: EnvoiQuestionnaire[]; curseur_suivant: string | null }>(
          cheminEnvoisMission(m.id),
        )
      : Promise.resolve(null),
    gerer ? chargerServeur<PageGrilles>(cheminGrilles("", 100)) : Promise.resolve(null),
  ]);

  // 404 : la mission est visible (layout) mais n'a pas encore de notation.
  if (!resume.ok && resume.statut !== 404) {
    return (
      <EtatErreur
        titre={t("La notation n'a pas pu être chargée.", "The rating could not be loaded.")}
        message={resume.message}
        hrefReessayer={hrefNotation(m.id)}
      />
    );
  }
  const notation = resume.ok ? resume.donnees : null;
  const versions = notation?.versions ?? [];
  const choix = versionAffichee(versions, demandee);
  const [vue, rapport] =
    notation && choix.numero !== null
      ? await Promise.all([
          chargerServeur<VueVersionNotation>(cheminVersionNotation(notation.id, choix.numero)),
          chargerServeur<RapportNotation>(cheminRapportNotation(notation.id, choix.numero)),
        ])
      : [null, null];

  const listeEnvois = envois?.ok ? envois.donnees.elements : [];
  const statutDerniere = versions[0]?.statut ?? null;
  const blocage = blocageCalcul(ctx, statutDerniere, langue);
  const envoiVue = vue?.ok ? listeEnvois.find((e) => e.id === vue.donnees.envoi_id) : undefined;

  return (
    <div className="mp-notation">
      <p className="mp-texte-doux">
        {t(
          "Le score est calculé par le moteur de CabinetPilot à partir des réponses soumises par le client et de la grille choisie ; il peut être ajusté avec un motif, puis doit être relu et publié par un expert métier avant toute diffusion.",
          "The score is computed by the CabinetPilot engine from the answers submitted by the client and the chosen framework; it can be adjusted with a reason, then must be reviewed and published by a business expert before any distribution.",
        )}
      </p>

      {choix.introuvable ? (
        <Alerte
          tonalite="attention"
          titre={t("Version introuvable", "Version not found")}
          annonce="aucune"
        >
          <p>
            {t(
              "La version demandée n'existe pas : la plus récente est affichée.",
              "The requested version does not exist: the most recent one is shown.",
            )}
          </p>
        </Alerte>
      ) : null}

      {gerer ? (
        <Carte
          titre={
            versions.length === 0
              ? t("Lancer la notation", "Start the rating")
              : t("Nouveau calcul", "New computation")
          }
        >
          {blocage ? (
            <Alerte tonalite="info" annonce="aucune">
              <p>{blocage}</p>
            </Alerte>
          ) : envois && !envois.ok ? (
            <EtatErreur
              titre={t(
                "Les questionnaires de la mission n'ont pas pu être chargés.",
                "The engagement questionnaires could not be loaded.",
              )}
              message={envois.message}
              hrefReessayer={hrefNotation(m.id, choix.numero)}
            />
          ) : envoisNotables(listeEnvois).length === 0 ? (
            <EtatVide
              titre={t("Aucune réponse soumise à noter.", "No submitted answer to rate.")}
              icone="taches"
              action={
                <Link
                  href={`/missions/${encodeURIComponent(m.id)}/questionnaires`}
                  className={classesBouton("secondaire")}
                >
                  {t(
                    "Ouvrir les questionnaires de la mission",
                    "Open the engagement questionnaires",
                  )}
                </Link>
              }
            >
              <p>
                {t(
                  "Envoyez le questionnaire de notation au client et attendez qu'au moins un répondant soumette ses réponses : le calcul porte uniquement sur des réponses soumises.",
                  "Send the rating questionnaire to the client and wait for at least one respondent to submit answers: the computation only covers submitted answers.",
                )}
              </p>
            </EtatVide>
          ) : (
            <>
              {grilles && !grilles.ok ? (
                <Alerte tonalite="attention" annonce="aucune">
                  <p>
                    {t(
                      `Les grilles du cabinet n'ont pas pu être chargées (${grilles.message}) : seule la grille générique est proposée.`,
                      `The firm's frameworks could not be loaded (${grilles.message}): only the generic framework is offered.`,
                    )}
                  </p>
                </Alerte>
              ) : null}
              <FormulaireCalcul
                missionId={m.id}
                notationId={notation?.id ?? null}
                envois={listeEnvois}
                grilles={grilles?.ok ? grilles.donnees.elements : []}
              />
            </>
          )}
        </Carte>
      ) : null}

      {versions.length === 0 ? (
        <EtatVide
          titre={t(
            "Aucune notation calculée pour cette mission.",
            "No rating computed for this engagement.",
          )}
          icone="barres"
        >
          <p>
            {gerer
              ? t(
                  "Lancez un premier calcul ci-dessus : il apparaîtra ici en brouillon.",
                  "Run a first computation above: it will appear here as a draft.",
                )
              : t(
                  "Le consultant ou le chef de mission n'a pas encore lancé de calcul. Vous pourrez relire et publier la notation une fois qu'elle sera soumise en revue.",
                  "The consultant or the engagement manager has not run a computation yet. You will be able to review and publish the rating once it is submitted for review.",
                )}
          </p>
        </EtatVide>
      ) : null}

      {notation && versions.length > 0 && choix.numero !== null ? (
        <Carte titre={t("Versions successives", "Successive versions")}>
          <VersionsNotation missionId={m.id} versions={versions} courante={choix.numero} />
        </Carte>
      ) : null}

      {notation && versions.length > 0 && choix.numero !== null ? (
        <Carte
          titre={t(
            "Confiance, explication et plan d'action",
            "Confidence, explanation and action plan",
          )}
        >
          <p>
            {t(
              "Indice de confiance, constats de perception, contribution de chaque pratique, simulateur de passage de classe et plan d'action priorisé :",
              "Confidence index, perception findings, contribution of each practice, class-change simulator and prioritized action plan:",
            )}{" "}
            <Link href={hrefAnalyseNotation(m.id, choix.numero)}>
              {t(
                `ouvrir l'analyse de la version ${choix.numero}`,
                `open the analysis of version ${choix.numero}`,
              )}
            </Link>
            .
          </p>
        </Carte>
      ) : null}

      {notation && versions.some((v) => v.statut === "publiee") ? (
        <Carte titre={t("Rapport de notation", "Rating report")}>
          <GenerationLivrable type="notation" id={notation.id} cloturee={m.statut === "cloturee"} />
        </Carte>
      ) : null}

      <CitationsLivrable missionId={m.id} livrable="notation" />

      {vue && !vue.ok ? (
        <EtatErreur
          titre={t(
            "Cette version de la notation n'a pas pu être chargée.",
            "This version of the rating could not be loaded.",
          )}
          message={vue.message}
          hrefReessayer={hrefNotation(m.id, choix.numero)}
        />
      ) : null}

      {notation && vue?.ok ? (
        <ResultatVersion
          missionId={m.id}
          notationId={notation.id}
          vue={vue.donnees}
          rapport={rapport}
          derniere={choix.derniere}
          titreQuestionnaire={envoiVue?.titre ?? null}
          collectif={envoiVue?.mode === "collectif"}
          ctx={ctx}
          gerer={gerer}
          langue={langue}
        />
      ) : null}
    </div>
  );
}

function ResultatVersion({
  missionId,
  notationId,
  vue,
  rapport,
  derniere,
  titreQuestionnaire,
  collectif,
  ctx,
  gerer,
  langue,
}: {
  missionId: string;
  notationId: string;
  vue: VueVersionNotation;
  rapport: Chargement<RapportNotation> | null;
  derniere: boolean;
  titreQuestionnaire: string | null;
  collectif: boolean;
  ctx: ContexteNotation;
  gerer: boolean;
  langue: Langue;
}) {
  const t = creerTraduire(langue);
  const droits = droitsVersion(ctx, vue, derniere, langue);
  const ajustables = vue.score.dimensions
    .filter((d) => d.scoreCalcule !== null)
    .map((d) => ({ dimension: d.dimension, libelle: d.libelle, score: d.score }));
  const reessayer = hrefNotation(missionId, vue.numero);
  return (
    <>
      <Carte titre={t(`Résultat de la version ${vue.numero}`, `Result of version ${vue.numero}`)}>
        <SyntheseNotation vue={vue} titreQuestionnaire={titreQuestionnaire} derniere={derniere} />
      </Carte>

      <Carte titre={t("Revue et publication", "Review and publication")}>
        <ParcoursRevue
          notationId={notationId}
          numero={vue.numero}
          statut={vue.statut}
          revue={vue.revue}
          droits={droits}
          gestionnaire={gerer}
        />
      </Carte>

      <Carte titre={t("Scores par dimension", "Scores by dimension")}>
        <div className="mp-notation__section">
          {rapport && !rapport.ok ? (
            <EtatErreur
              titre={t(
                "Les graphiques n'ont pas pu être chargés.",
                "The charts could not be loaded.",
              )}
              message={rapport.message}
              hrefReessayer={reessayer}
            />
          ) : rapport?.ok ? (
            <div className="mp-notation__colonnes">
              <section className="mp-notation__section" aria-labelledby="titre-radar">
                <h3 id="titre-radar" className="mp-notation-barres__famille">
                  {t("Radar de maturité", "Maturity radar")}
                </h3>
                <GraphiqueRadar
                  radar={rapport.donnees.donnees.radar}
                  idPrefixe={`radar-v${vue.numero}`}
                />
              </section>
              <section className="mp-notation__section" aria-labelledby="titre-barres">
                <h3 id="titre-barres" className="mp-notation-barres__famille">
                  {t("Barres par famille", "Bars by family")}
                </h3>
                <BarresFamilles barres={rapport.donnees.donnees.barres} />
              </section>
            </div>
          ) : null}
          <TableauDimensions vue={vue} />
        </div>
      </Carte>

      {rapport?.ok ? (
        <Carte titre={t("Forces et faiblesses", "Strengths and weaknesses")}>
          <ForcesFaiblesses
            forces={rapport.donnees.donnees.forces}
            faiblesses={rapport.donnees.donnees.faiblesses}
          />
          <p className="mp-texte-doux mp-texte-petit">
            {t(
              "Point fort : score de 65 et plus ; point faible : score sous 50. Les dimensions non notables n'apparaissent dans aucune liste.",
              "Strength: score of 65 and above; weakness: score below 50. Dimensions not rated appear in neither list.",
            )}
          </p>
        </Carte>
      ) : null}

      <Carte titre={t("Ajustements motivés", "Reasoned adjustments")}>
        <div className="mp-notation__section">
          {droits.ajuster ? (
            <FormulaireAjustement notationId={notationId} dimensions={ajustables} />
          ) : (
            <p className="mp-texte-doux">
              {messageSansAjustement(ctx, vue.statut, derniere, langue)}
            </p>
          )}
          <HistoriqueAjustements vue={vue} />
          <p className="mp-texte-doux mp-texte-petit">
            {t(
              "Historique immuable : un ajustement ne se modifie ni ne se supprime. Il n'est pas reporté sur une version calculée ensuite.",
              "Immutable history: an adjustment can be neither edited nor deleted. It is not carried over to a version computed afterwards.",
            )}
          </p>
        </div>
      </Carte>

      <Carte titre={t("Écarts entre répondants", "Differences between respondents")}>
        <EcartsRepondants ecarts={vue.ecarts} collectif={collectif} />
      </Carte>

      <Carte
        titre={t("Comparaison avec la notation précédente", "Comparison with the previous rating")}
      >
        {rapport?.ok ? (
          <ComparaisonNotation comparaison={rapport.donnees.comparaison} />
        ) : (
          <p className="mp-texte-doux">
            {t(
              "Comparaison indisponible : le rapport n'a pas pu être chargé.",
              "Comparison unavailable: the report could not be loaded.",
            )}
          </p>
        )}
      </Carte>
    </>
  );
}
