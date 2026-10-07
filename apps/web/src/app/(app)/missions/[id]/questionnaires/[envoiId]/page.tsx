import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ApercuQuestionnaire } from "../../../../../../components/questionnaires/ApercuQuestionnaire";
import { BadgeStatut } from "../../../../../../components/ui/BadgeStatut";
import { EtatErreur } from "../../../../../../components/ui/EtatListe";
import { Icone } from "../../../../../../components/ui/Icone";
import { chargerServeur } from "../../../../../../lib/api-serveur";
import { formaterDate, formaterDateHeure } from "../../../../../../lib/format";
import { estIdentifiant } from "../../../../../../lib/identifiant";
import { chargerMission } from "../../../../../../lib/missions-serveur";
import {
  AIDE_MODE,
  hrefEnvoi,
  libelleMode,
  libelleStatut,
  STATUT_ENVOI,
  type EnvoiDetail,
} from "../../../../../../lib/questionnaires";
import { exigerPermission } from "../../../../../../lib/session";
import { ReponsesEnvoi } from "./ReponsesEnvoi";
import { SuiviEnvoi } from "./SuiviEnvoi";

export const metadata: Metadata = { title: "Suivi d'un questionnaire" };

/**
 * Suivi d'un envoi de questionnaire (SOC-10) : réglages, actions, progression par répondant,
 * relances, réponses soumises et questionnaire envoyé (version figée).
 */
export default async function PageEnvoi({
  params,
}: {
  params: Promise<{ id: string; envoiId: string }>;
}) {
  const { id, envoiId } = await params;
  if (!estIdentifiant(envoiId)) notFound();
  const { utilisateur } = await exigerPermission("questionnaire.lire");
  const r = await chargerMission(id);
  // L'en-tête (layout) affiche déjà l'erreur de chargement.
  if (!r.ok) return null;
  const m = r.donnees;
  const liste = `/missions/${m.id}/questionnaires`;
  const e = await chargerServeur<EnvoiDetail>(`/api/questionnaires/envois/${envoiId}`);
  if (!e.ok && e.statut === 404) notFound();
  if (!e.ok) {
    return (
      <EtatErreur
        titre="Le questionnaire n'a pas pu être chargé."
        message={e.message}
        hrefReessayer={hrefEnvoi(m.id, envoiId)}
      />
    );
  }
  const envoi = e.donnees;
  if (envoi.mission_id !== m.id) notFound();
  const statut = libelleStatut(STATUT_ENVOI, envoi.statut);
  const { attendues, soumises } = envoi.completude;

  return (
    <div className="mp-pile mp-pile--large">
      <Link href={liste} className="mp-lien-retour">
        <Icone nom="chevronGauche" taille={18} />
        <span>Questionnaires de la mission</span>
      </Link>
      <section className="mp-pile" aria-labelledby="titre-envoi">
        <div className="mp-entete-section">
          <h2 id="titre-envoi" className="mp-section__titre mp-coupure">
            {envoi.titre}
          </h2>
          <span className="mp-badges">
            <BadgeStatut tonalite={statut.tonalite}>{statut.libelle}</BadgeStatut>
            <BadgeStatut tonalite="neutre" sansIcone>
              {libelleMode(envoi.mode)}
            </BadgeStatut>
            {envoi.completude.complet && envoi.statut !== "brouillon" ? (
              <BadgeStatut tonalite="succes">Toutes les réponses sont soumises</BadgeStatut>
            ) : null}
          </span>
        </div>
        <dl className="mp-liste-def">
          <div>
            <dt>Mode de réponse</dt>
            <dd>{`${libelleMode(envoi.mode)} : ${AIDE_MODE[envoi.mode] ?? ""}`}</dd>
          </div>
          <div>
            <dt>Réponses soumises</dt>
            <dd>
              {envoi.mode === "collectif"
                ? soumises > 0
                  ? "La réponse partagée est soumise."
                  : "La réponse partagée n'est pas encore soumise."
                : `${soumises} sur ${attendues} attendue${attendues > 1 ? "s" : ""}`}
            </dd>
          </div>
          <div>
            <dt>Date limite indicative</dt>
            <dd>
              {envoi.date_limite ? formaterDate(envoi.date_limite) : "Aucune"}
              {envoi.date_limite && envoi.statut === "envoye" ? (
                <span className="mp-texte-doux">
                  {" "}
                  (n&apos;empêche pas de répondre : seule la clôture ferme le questionnaire)
                </span>
              ) : null}
            </dd>
          </div>
          <div>
            <dt>Relances automatiques</dt>
            <dd>
              {envoi.relances_auto
                ? "Activées : e-mail à J+3 puis J+7 après l'envoi, aux répondants qui n'ont pas soumis."
                : "Désactivées : relances manuelles seulement."}
            </dd>
          </div>
          <div>
            <dt>Créé le</dt>
            <dd>{formaterDateHeure(envoi.cree_le)}</dd>
          </div>
          <div>
            <dt>Envoyé le</dt>
            <dd>{envoi.envoye_le ? formaterDateHeure(envoi.envoye_le) : "Pas encore envoyé"}</dd>
          </div>
          {envoi.clos_le ? (
            <div>
              <dt>Clos le</dt>
              <dd>{formaterDateHeure(envoi.clos_le)}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      <SuiviEnvoi
        envoi={envoi}
        roles={utilisateur.roles}
        missionCloturee={m.statut === "cloturee"}
      />

      <ReponsesEnvoi envoiId={envoi.id} definition={envoi.definition} soumises={soumises} />

      <details className="mp-details">
        <summary>Voir le questionnaire envoyé (version figée)</summary>
        <ApercuQuestionnaire definition={envoi.definition} prefixe="envoi-apercu" niveauTitre={3} />
      </details>
    </div>
  );
}
