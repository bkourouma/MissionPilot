import Link from "next/link";
import type { Metadata } from "next";
import { Alerte } from "../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../lib/api-serveur";
import { obtenirLangue, obtenirT } from "../../../../../lib/i18n/serveur";
import { chargerMission } from "../../../../../lib/missions-serveur";
import {
  cheminEnvoisMission,
  datesEnvoi,
  hrefAvecCurseur,
  hrefEnvoi,
  libelleMode,
  libelleStatut,
  lireCurseur,
  peutEcrireEnvois,
  peutGererQuestionnaires,
  resumeEnvoi,
  STATUT_ENVOI,
  type EnvoiResume,
  type PageQuestionnaires,
} from "../../../../../lib/questionnaires";
import { gerePortail, hrefPortailClient } from "../../../../../lib/portail-gestion";
import { exigerPermission } from "../../../../../lib/session";
import { PreparationEnvoi } from "./PreparationEnvoi";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Questionnaires de la mission", "Engagement questionnaires") };
}

/**
 * Onglet « Questionnaires » d'une mission (SOC-10) : envois aux répondants du client, suivi,
 * préparation d'un nouvel envoi. Mission clôturée : lecture seule.
 */
export default async function PageQuestionnairesMission({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const { id } = await params;
  const { utilisateur } = await exigerPermission("questionnaire.lire");
  const r = await chargerMission(id);
  // L'en-tête (layout) affiche déjà l'erreur de chargement.
  if (!r.ok) return null;
  const m = r.donnees;
  const curseur = lireCurseur((await searchParams).curseur);
  const base = `/missions/${m.id}/questionnaires`;
  const contexte = { roles: utilisateur.roles, missionCloturee: m.statut === "cloturee" };
  const envois = await chargerServeur<PageQuestionnaires<EnvoiResume>>(
    cheminEnvoisMission(m.id, curseur),
  );

  return (
    <div className="mp-pile mp-pile--large">
      <div className="mp-entete-section">
        <p className="mp-texte-doux">
          {t(
            "Questionnaires envoyés aux dirigeants et contributeurs du client sur le portail, en mode individuel, collectif ou par fonction. Seules les réponses soumises sont lisibles ; d'une saisie en cours, vous ne voyez que la progression.",
            "Questionnaires sent to the client's executives and contributors on the portal, in individual, collective or by-role mode. Only submitted responses are readable; for an entry in progress, you only see the progress.",
          )}
        </p>
        {contexte.missionCloturee ? (
          <Alerte tonalite="info" annonce="aucune">
            <p>
              {t(
                "Mission clôturée : les questionnaires restent consultables, plus aucun envoi ni relance n'est possible.",
                "Engagement closed: questionnaires remain viewable, but no sending or reminder is possible.",
              )}
            </p>
          </Alerte>
        ) : peutEcrireEnvois(contexte) ? (
          <PreparationEnvoi
            missionId={m.id}
            clientNom={m.client_raison_sociale}
            hrefPortail={gerePortail(utilisateur.roles) ? hrefPortailClient(m.client_id) : null}
          />
        ) : !peutGererQuestionnaires(utilisateur.roles) ? (
          <p className="mp-texte-doux mp-texte-petit">
            {t(
              "Votre rôle permet de consulter les questionnaires et leurs réponses, pas d'en envoyer.",
              "Your role lets you view questionnaires and their responses, not send them.",
            )}
          </p>
        ) : null}
      </div>

      <section className="mp-pile" aria-labelledby="titre-envois">
        <h2 id="titre-envois" className="mp-section__titre">
          {t("Envois", "Sendings")}
        </h2>
        {!envois.ok ? (
          <EtatErreur
            titre={t(
              "Les questionnaires de la mission n'ont pas pu être chargés.",
              "The engagement questionnaires could not be loaded.",
            )}
            message={envois.message}
            hrefReessayer={hrefAvecCurseur(base, curseur)}
          />
        ) : envois.donnees.elements.length === 0 ? (
          <EtatVide
            titre={t(
              "Aucun questionnaire pour cette mission.",
              "No questionnaire for this engagement.",
            )}
            icone="bulle"
          >
            <p>
              {curseur
                ? t(
                    "Cette page est vide : revenez au début de la liste.",
                    "This page is empty: go back to the start of the list.",
                  )
                : peutEcrireEnvois(contexte)
                  ? t(
                      "Préparez un envoi à partir d'un modèle validé du cabinet.",
                      "Prepare a sending from an approved firm template.",
                    )
                  : t("Aucun envoi n'a été préparé.", "No sending has been prepared.")}
            </p>
          </EtatVide>
        ) : (
          <>
            <ul
              className="mp-liste-lignes"
              aria-label={t("Questionnaires de la mission", "Engagement questionnaires")}
            >
              {envois.donnees.elements.map((e) => {
                const s = libelleStatut(STATUT_ENVOI, e.statut, langue);
                return (
                  <li key={e.id} className="mp-liste-lignes__ligne">
                    <span className="mp-liste-lignes__texte">
                      <Link href={hrefEnvoi(m.id, e.id)} className="mp-coupure">
                        <strong>{e.titre}</strong>
                      </Link>
                      <span>{resumeEnvoi(e, langue)}</span>
                      <span className="mp-texte-doux mp-texte-petit">{datesEnvoi(e, langue)}</span>
                    </span>
                    <span className="mp-badges">
                      <BadgeStatut tonalite={s.tonalite}>{s.libelle}</BadgeStatut>
                      <BadgeStatut tonalite="neutre" sansIcone>
                        {libelleMode(e.mode, langue)}
                      </BadgeStatut>
                    </span>
                  </li>
                );
              })}
            </ul>
            <PaginationCurseur
              libelle={t(
                "Pages des questionnaires de la mission",
                "Engagement questionnaire pages",
              )}
              hrefSuivante={
                envois.donnees.curseur_suivant
                  ? hrefAvecCurseur(base, envois.donnees.curseur_suivant)
                  : null
              }
              hrefDebut={curseur ? base : null}
            />
          </>
        )}
      </section>
    </div>
  );
}
