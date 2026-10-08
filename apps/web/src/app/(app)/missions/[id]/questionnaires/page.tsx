import Link from "next/link";
import type { Metadata } from "next";
import { Alerte } from "../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../lib/api-serveur";
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

export const metadata: Metadata = { title: "Questionnaires de la mission" };

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
          Questionnaires envoyés aux dirigeants et contributeurs du client sur le portail, en mode
          individuel, collectif ou par fonction. Seules les réponses soumises sont lisibles ; d'une
          saisie en cours, vous ne voyez que la progression.
        </p>
        {contexte.missionCloturee ? (
          <Alerte tonalite="info" annonce="aucune">
            <p>
              Mission clôturée : les questionnaires restent consultables, plus aucun envoi ni
              relance n'est possible.
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
            Votre rôle permet de consulter les questionnaires et leurs réponses, pas d'en envoyer.
          </p>
        ) : null}
      </div>

      <section className="mp-pile" aria-labelledby="titre-envois">
        <h2 id="titre-envois" className="mp-section__titre">
          Envois
        </h2>
        {!envois.ok ? (
          <EtatErreur
            titre="Les questionnaires de la mission n'ont pas pu être chargés."
            message={envois.message}
            hrefReessayer={hrefAvecCurseur(base, curseur)}
          />
        ) : envois.donnees.elements.length === 0 ? (
          <EtatVide titre="Aucun questionnaire pour cette mission." icone="bulle">
            <p>
              {curseur
                ? "Cette page est vide : revenez au début de la liste."
                : peutEcrireEnvois(contexte)
                  ? "Préparez un envoi à partir d'un modèle validé du cabinet."
                  : "Aucun envoi n'a été préparé."}
            </p>
          </EtatVide>
        ) : (
          <>
            <ul className="mp-liste-lignes" aria-label="Questionnaires de la mission">
              {envois.donnees.elements.map((e) => {
                const s = libelleStatut(STATUT_ENVOI, e.statut);
                return (
                  <li key={e.id} className="mp-liste-lignes__ligne">
                    <span className="mp-liste-lignes__texte">
                      <Link href={hrefEnvoi(m.id, e.id)} className="mp-coupure">
                        <strong>{e.titre}</strong>
                      </Link>
                      <span>{resumeEnvoi(e)}</span>
                      <span className="mp-texte-doux mp-texte-petit">{datesEnvoi(e)}</span>
                    </span>
                    <span className="mp-badges">
                      <BadgeStatut tonalite={s.tonalite}>{s.libelle}</BadgeStatut>
                      <BadgeStatut tonalite="neutre" sansIcone>
                        {libelleMode(e.mode)}
                      </BadgeStatut>
                    </span>
                  </li>
                );
              })}
            </ul>
            <PaginationCurseur
              libelle="Pages des questionnaires de la mission"
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
