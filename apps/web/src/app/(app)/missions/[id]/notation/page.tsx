import Link from "next/link";
import type { Metadata } from "next";
import { aPermission } from "@missionpilot/shared";
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
import { TableauDimensions } from "../../../../../components/notation/TableauDimensions";
import { VersionsNotation } from "../../../../../components/notation/VersionsNotation";
import "../../../../../components/notation/notation.css";
import { Alerte } from "../../../../../components/ui/Alerte";
import { classesBouton } from "../../../../../components/ui/Bouton";
import { Carte } from "../../../../../components/ui/Carte";
import { EtatErreur, EtatVide } from "../../../../../components/ui/EtatListe";
import { chargerServeur, type Chargement } from "../../../../../lib/api-serveur";
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

export const metadata: Metadata = { title: "Notation de la mission" };

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
        titre="La notation n'a pas pu être chargée."
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
  const blocage = blocageCalcul(ctx, statutDerniere);
  const envoiVue = vue?.ok ? listeEnvois.find((e) => e.id === vue.donnees.envoi_id) : undefined;

  return (
    <div className="mp-notation">
      <p className="mp-texte-doux">
        Le score est calculé par le moteur de MissionPilot à partir des réponses soumises par le
        client et de la grille choisie ; il peut être ajusté avec un motif, puis doit être relu et
        publié par un expert métier avant toute diffusion.
      </p>

      {choix.introuvable ? (
        <Alerte tonalite="attention" titre="Version introuvable" annonce="aucune">
          <p>La version demandée n&apos;existe pas : la plus récente est affichée.</p>
        </Alerte>
      ) : null}

      {gerer ? (
        <Carte titre={versions.length === 0 ? "Lancer la notation" : "Nouveau calcul"}>
          {blocage ? (
            <Alerte tonalite="info" annonce="aucune">
              <p>{blocage}</p>
            </Alerte>
          ) : envois && !envois.ok ? (
            <EtatErreur
              titre="Les questionnaires de la mission n'ont pas pu être chargés."
              message={envois.message}
              hrefReessayer={hrefNotation(m.id, choix.numero)}
            />
          ) : envoisNotables(listeEnvois).length === 0 ? (
            <EtatVide
              titre="Aucune réponse soumise à noter."
              icone="taches"
              action={
                <Link
                  href={`/missions/${encodeURIComponent(m.id)}/questionnaires`}
                  className={classesBouton("secondaire")}
                >
                  Ouvrir les questionnaires de la mission
                </Link>
              }
            >
              <p>
                Envoyez le questionnaire de notation au client et attendez qu&apos;au moins un
                répondant soumette ses réponses : le calcul porte uniquement sur des réponses
                soumises.
              </p>
            </EtatVide>
          ) : (
            <>
              {grilles && !grilles.ok ? (
                <Alerte tonalite="attention" annonce="aucune">
                  <p>
                    Les grilles du cabinet n&apos;ont pas pu être chargées ({grilles.message}) :
                    seule la grille générique est proposée.
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
        <EtatVide titre="Aucune notation calculée pour cette mission." icone="barres">
          <p>
            {gerer
              ? "Lancez un premier calcul ci-dessus : il apparaîtra ici en brouillon."
              : "Le consultant ou le chef de mission n'a pas encore lancé de calcul. Vous pourrez relire et publier la notation une fois qu'elle sera soumise en revue."}
          </p>
        </EtatVide>
      ) : null}

      {notation && versions.length > 0 && choix.numero !== null ? (
        <Carte titre="Versions successives">
          <VersionsNotation missionId={m.id} versions={versions} courante={choix.numero} />
        </Carte>
      ) : null}

      {notation && versions.length > 0 && choix.numero !== null ? (
        <Carte titre="Confiance, explication et plan d'action">
          <p>
            Indice de confiance, constats de perception, contribution de chaque pratique, simulateur
            de passage de classe et plan d&apos;action priorisé :{" "}
            <Link href={hrefAnalyseNotation(m.id, choix.numero)}>
              ouvrir l&apos;analyse de la version {choix.numero}
            </Link>
            .
          </p>
        </Carte>
      ) : null}

      {notation && versions.some((v) => v.statut === "publiee") ? (
        <Carte titre="Rapport de notation">
          <GenerationLivrable type="notation" id={notation.id} cloturee={m.statut === "cloturee"} />
        </Carte>
      ) : null}

      {vue && !vue.ok ? (
        <EtatErreur
          titre="Cette version de la notation n'a pas pu être chargée."
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
}) {
  const droits = droitsVersion(ctx, vue, derniere);
  const ajustables = vue.score.dimensions
    .filter((d) => d.scoreCalcule !== null)
    .map((d) => ({ dimension: d.dimension, libelle: d.libelle, score: d.score }));
  const reessayer = hrefNotation(missionId, vue.numero);
  return (
    <>
      <Carte titre={`Résultat de la version ${vue.numero}`}>
        <SyntheseNotation vue={vue} titreQuestionnaire={titreQuestionnaire} derniere={derniere} />
      </Carte>

      <Carte titre="Revue et publication">
        <ParcoursRevue
          notationId={notationId}
          numero={vue.numero}
          statut={vue.statut}
          revue={vue.revue}
          droits={droits}
          gestionnaire={gerer}
        />
      </Carte>

      <Carte titre="Scores par dimension">
        <div className="mp-notation__section">
          {rapport && !rapport.ok ? (
            <EtatErreur
              titre="Les graphiques n'ont pas pu être chargés."
              message={rapport.message}
              hrefReessayer={reessayer}
            />
          ) : rapport?.ok ? (
            <div className="mp-notation__colonnes">
              <section className="mp-notation__section" aria-labelledby="titre-radar">
                <h3 id="titre-radar" className="mp-notation-barres__famille">
                  Radar de maturité
                </h3>
                <GraphiqueRadar
                  radar={rapport.donnees.donnees.radar}
                  idPrefixe={`radar-v${vue.numero}`}
                />
              </section>
              <section className="mp-notation__section" aria-labelledby="titre-barres">
                <h3 id="titre-barres" className="mp-notation-barres__famille">
                  Barres par famille
                </h3>
                <BarresFamilles barres={rapport.donnees.donnees.barres} />
              </section>
            </div>
          ) : null}
          <TableauDimensions vue={vue} />
        </div>
      </Carte>

      {rapport?.ok ? (
        <Carte titre="Forces et faiblesses">
          <ForcesFaiblesses
            forces={rapport.donnees.donnees.forces}
            faiblesses={rapport.donnees.donnees.faiblesses}
          />
          <p className="mp-texte-doux mp-texte-petit">
            Point fort : score de 65 et plus ; point faible : score sous 50. Les dimensions non
            notables n&apos;apparaissent dans aucune liste.
          </p>
        </Carte>
      ) : null}

      <Carte titre="Ajustements motivés">
        <div className="mp-notation__section">
          {droits.ajuster ? (
            <FormulaireAjustement notationId={notationId} dimensions={ajustables} />
          ) : (
            <p className="mp-texte-doux">{messageSansAjustement(ctx, vue.statut, derniere)}</p>
          )}
          <HistoriqueAjustements vue={vue} />
          <p className="mp-texte-doux mp-texte-petit">
            Historique immuable : un ajustement ne se modifie ni ne se supprime. Il n&apos;est pas
            reporté sur une version calculée ensuite.
          </p>
        </div>
      </Carte>

      <Carte titre="Écarts entre répondants">
        <EcartsRepondants ecarts={vue.ecarts} collectif={collectif} />
      </Carte>

      <Carte titre="Comparaison avec la notation précédente">
        {rapport?.ok ? (
          <ComparaisonNotation comparaison={rapport.donnees.comparaison} />
        ) : (
          <p className="mp-texte-doux">
            Comparaison indisponible : le rapport n&apos;a pas pu être chargé.
          </p>
        )}
      </Carte>
    </>
  );
}
