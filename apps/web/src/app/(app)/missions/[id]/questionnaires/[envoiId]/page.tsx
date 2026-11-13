import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ApercuQuestionnaire } from "../../../../../../components/questionnaires/ApercuQuestionnaire";
import { BadgeStatut } from "../../../../../../components/ui/BadgeStatut";
import { EtatErreur } from "../../../../../../components/ui/EtatListe";
import { Icone } from "../../../../../../components/ui/Icone";
import { chargerServeur } from "../../../../../../lib/api-serveur";
import { obtenirLangue, obtenirT } from "../../../../../../lib/i18n/serveur";
import { formaterDate, formaterDateHeure } from "../../../../../../lib/format";
import { estIdentifiant } from "../../../../../../lib/identifiant";
import { chargerMission } from "../../../../../../lib/missions-serveur";
import {
  AIDE_MODE,
  AIDE_MODE_EN,
  hrefEnvoi,
  libelleMode,
  libelleStatut,
  STATUT_ENVOI,
  type EnvoiDetail,
} from "../../../../../../lib/questionnaires";
import { exigerPermission } from "../../../../../../lib/session";
import { ReponsesEnvoi } from "./ReponsesEnvoi";
import { SuiviEnvoi } from "./SuiviEnvoi";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Suivi d'un questionnaire", "Questionnaire tracking") };
}

/**
 * Suivi d'un envoi de questionnaire (SOC-10) : réglages, actions, progression par répondant,
 * relances, réponses soumises et questionnaire envoyé (version figée).
 */
export default async function PageEnvoi({
  params,
}: {
  params: Promise<{ id: string; envoiId: string }>;
}) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
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
        titre={t(
          "Le questionnaire n'a pas pu être chargé.",
          "The questionnaire could not be loaded.",
        )}
        message={e.message}
        hrefReessayer={hrefEnvoi(m.id, envoiId)}
      />
    );
  }
  const envoi = e.donnees;
  if (envoi.mission_id !== m.id) notFound();
  const statut = libelleStatut(STATUT_ENVOI, envoi.statut, langue);
  const { attendues, soumises } = envoi.completude;

  return (
    <div className="mp-pile mp-pile--large">
      <Link href={liste} className="mp-lien-retour">
        <Icone nom="chevronGauche" taille={18} />
        <span>{t("Questionnaires de la mission", "Engagement questionnaires")}</span>
      </Link>
      <section className="mp-pile" aria-labelledby="titre-envoi">
        <div className="mp-entete-section">
          <h2 id="titre-envoi" className="mp-section__titre mp-coupure">
            {envoi.titre}
          </h2>
          <span className="mp-badges">
            <BadgeStatut tonalite={statut.tonalite}>{statut.libelle}</BadgeStatut>
            <BadgeStatut tonalite="neutre" sansIcone>
              {libelleMode(envoi.mode, langue)}
            </BadgeStatut>
            {envoi.completude.complet && envoi.statut !== "brouillon" ? (
              <BadgeStatut tonalite="succes">
                {t("Toutes les réponses sont soumises", "All responses are submitted")}
              </BadgeStatut>
            ) : null}
          </span>
        </div>
        <dl className="mp-liste-def">
          <div>
            <dt>{t("Mode de réponse", "Response mode")}</dt>
            <dd>{`${libelleMode(envoi.mode, langue)}${t(" : ", ": ")}${(langue === "en" ? AIDE_MODE_EN : AIDE_MODE)[envoi.mode] ?? ""}`}</dd>
          </div>
          <div>
            <dt>{t("Réponses soumises", "Submitted responses")}</dt>
            <dd>
              {envoi.mode === "collectif"
                ? soumises > 0
                  ? t("La réponse partagée est soumise.", "The shared response is submitted.")
                  : t(
                      "La réponse partagée n'est pas encore soumise.",
                      "The shared response is not submitted yet.",
                    )
                : t(
                    `${soumises} sur ${attendues} attendue${attendues > 1 ? "s" : ""}`,
                    `${soumises} of ${attendues} expected`,
                  )}
            </dd>
          </div>
          <div>
            <dt>{t("Date limite", "Due date")}</dt>
            <dd>
              {envoi.date_limite
                ? formaterDate(envoi.date_limite, undefined, langue)
                : t("Aucune", "None")}
              {envoi.date_limite && envoi.statut === "envoye" ? (
                <span className="mp-texte-doux">
                  {" "}
                  {t(
                    "(passée, le portail n'accepte plus de réponse : prolongez-la ici si besoin)",
                    "(passed, the portal no longer accepts responses: extend it here if needed)",
                  )}
                </span>
              ) : null}
            </dd>
          </div>
          <div>
            <dt>{t("Relances automatiques", "Automatic reminders")}</dt>
            <dd>
              {envoi.relances_auto
                ? t(
                    "Activées : e-mail à J+3 puis J+7 après l'envoi, aux répondants qui n'ont pas soumis.",
                    "On: email at D+3 then D+7 after sending, to respondents who have not submitted.",
                  )
                : t("Désactivées : relances manuelles seulement.", "Off: manual reminders only.")}
            </dd>
          </div>
          <div>
            <dt>{t("Créé le", "Created on")}</dt>
            <dd>{formaterDateHeure(envoi.cree_le, undefined, langue)}</dd>
          </div>
          <div>
            <dt>{t("Envoyé le", "Sent on")}</dt>
            <dd>
              {envoi.envoye_le
                ? formaterDateHeure(envoi.envoye_le, undefined, langue)
                : t("Pas encore envoyé", "Not sent yet")}
            </dd>
          </div>
          {envoi.clos_le ? (
            <div>
              <dt>{t("Clos le", "Closed on")}</dt>
              <dd>{formaterDateHeure(envoi.clos_le, undefined, langue)}</dd>
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
        <summary>
          {t(
            "Voir le questionnaire envoyé (version figée)",
            "View the sent questionnaire (locked version)",
          )}
        </summary>
        <ApercuQuestionnaire
          definition={envoi.definition}
          prefixe="envoi-apercu"
          niveauTitre={3}
          langue={langue}
        />
      </details>
    </div>
  );
}
