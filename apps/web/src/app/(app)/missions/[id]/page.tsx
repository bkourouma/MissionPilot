import Link from "next/link";
import type { Metadata } from "next";
import { aPermission } from "@missionpilot/shared";
import { classesBouton } from "../../../../components/ui/Bouton";
import { Carte } from "../../../../components/ui/Carte";
import { Icone } from "../../../../components/ui/Icone";
import { libelleMode } from "../../../../lib/catalogue";
import {
  formaterDate,
  formaterDateHeure,
  formaterNombre,
  libelleDevise,
} from "../../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../../lib/i18n/serveur";
import {
  droitsMission,
  libelleStatutMission,
  naturesSupplementaires,
} from "../../../../lib/missions";
import { chargerMission } from "../../../../lib/missions-serveur";
import { nomPersonne, optionsPersonnes, type Personne } from "../../../../lib/personnes";
import {
  chargerClientsActifs,
  chargerPersonnes,
  chargerTypesActifs,
} from "../../../../lib/referentiels-serveur";
import { exigerPermission } from "../../../../lib/session";
import { Commentaires } from "../../../../components/collaboration/Commentaires";
import { CapMission } from "../../../../components/indicateurs/CapMission";
import { hrefNouvelleTache } from "../../../../lib/taches-collaboration";
import { ActionsMission } from "./ActionsMission";
import { EquipeMission } from "./EquipeMission";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Fiche mission", "Engagement overview") };
}

export default async function PageFicheMission({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const { utilisateur } = await exigerPermission("mission.lire");
  const roles = utilisateur.roles;
  const r = await chargerMission(id);
  // L'en-tête (layout) affiche déjà l'erreur de chargement.
  if (!r.ok) return null;
  const m = r.donnees;
  const droits = droitsMission(m, roles, utilisateur.id, langue);
  const [types, personnesCabinet, clients] = await Promise.all([
    chargerTypesActifs(roles),
    chargerPersonnes(roles),
    droits.dupliquer ? chargerClientsActifs(roles) : Promise.resolve([]),
  ]);
  // Sans accès au référentiel, les noms connus viennent de l'équipe de la mission.
  const personnes: Personne[] = personnesCabinet.length
    ? personnesCabinet
    : m.equipe.map((e) => ({ utilisateur_id: e.utilisateur_id, nom: e.nom, grade_libelle: null }));
  const nom = (pid: string | null) =>
    pid && pid === utilisateur.id
      ? `${utilisateur.nom} (${t("vous", "you")})`
      : nomPersonne(pid, personnes, langue);
  const type = m.type_mission_id
    ? (types.find((ty) => ty.valeur === m.type_mission_id)?.libelle ??
      t("Type archivé ou non visible", "Archived or non-visible type"))
    : t("Mission sans modèle", "Engagement without template");

  return (
    <div className="mp-pile mp-pile--large">
      <CapMission missionId={m.id} />

      <Carte
        titre={t("Fiche mission", "Engagement overview")}
        actions={
          droits.modifier ? (
            <Link href={`/missions/${m.id}/modifier`} className={classesBouton("secondaire")}>
              <Icone nom="crayon" />
              <span>{t("Modifier", "Edit")}</span>
            </Link>
          ) : null
        }
      >
        <dl className="mp-liste-def">
          <div>
            <dt>{t("Client", "Client")}</dt>
            <dd>
              {aPermission(roles, "clients.lire") ? (
                <Link href={`/clients/${m.client_id}`}>{m.client_raison_sociale}</Link>
              ) : (
                m.client_raison_sociale
              )}
            </dd>
          </div>
          <div>
            <dt>{t("Type de mission", "Engagement type")}</dt>
            <dd>{type}</dd>
          </div>
          <div>
            <dt>{t("Directeur de mission", "Engagement director")}</dt>
            <dd>{m.directeur_id ? nom(m.directeur_id) : t("À désigner", "To be assigned")}</dd>
          </div>
          <div>
            <dt>{t("Chef de mission", "Engagement manager")}</dt>
            <dd>{m.chef_id ? nom(m.chef_id) : t("À désigner", "To be assigned")}</dd>
          </div>
          <div>
            <dt>{t("Dates", "Dates")}</dt>
            <dd>
              {m.date_debut || m.date_fin
                ? t(
                    `Du ${formaterDate(m.date_debut)} au ${formaterDate(m.date_fin)}`,
                    `From ${formaterDate(m.date_debut, "UTC", "en")} to ${formaterDate(m.date_fin, "UTC", "en")}`,
                  )
                : t("Non planifiée", "Not scheduled")}
            </dd>
          </div>
          <div>
            <dt>{t("Devise", "Currency")}</dt>
            <dd>{libelleDevise(m.devise)}</dd>
          </div>
          <div>
            <dt>{t("Mode de facturation", "Billing mode")}</dt>
            <dd>{libelleMode(m.mode_facturation, langue)}</dd>
          </div>
          <div>
            <dt>{t("Statut", "Status")}</dt>
            <dd>{libelleStatutMission(m.statut, langue)}</dd>
          </div>
          {m.date_signature ? (
            <div>
              <dt>{t("Lettre de mission signée le", "Engagement letter signed on")}</dt>
              <dd>{formaterDate(m.date_signature, "UTC", langue)}</dd>
            </div>
          ) : null}
          {m.taux_change !== null && m.devise_reference && m.devise_reference !== m.devise ? (
            <div>
              <dt>{t("Taux de change figé", "Locked exchange rate")}</dt>
              <dd>{`1 ${libelleDevise(m.devise)} = ${formaterNombre(m.taux_change, 6, langue)} ${libelleDevise(m.devise_reference)}`}</dd>
            </div>
          ) : null}
          {m.activite || m.secteur || m.bureau ? (
            <div>
              <dt>{t("Axes analytiques", "Analytical dimensions")}</dt>
              <dd>{[m.activite, m.secteur, m.bureau].filter(Boolean).join(" · ")}</dd>
            </div>
          ) : null}
          {m.proposition_id && aPermission(roles, "pipeline.gerer") ? (
            <div>
              <dt>{t("Origine", "Origin")}</dt>
              <dd>
                <Link href={`/pipeline/propositions/${m.proposition_id}`}>
                  {t("Proposition acceptée", "Accepted proposal")}
                </Link>
              </dd>
            </div>
          ) : null}
          {m.mission_source_id ? (
            <div>
              <dt>{t("Dupliquée de", "Duplicated from")}</dt>
              <dd>
                <Link href={`/missions/${m.mission_source_id}`}>
                  {t("Mission d'origine", "Original engagement")}
                </Link>
              </dd>
            </div>
          ) : null}
          {m.cloturee_le ? (
            <div>
              <dt>{t("Clôturée le", "Closed on")}</dt>
              <dd>{formaterDateHeure(m.cloturee_le, undefined, langue)}</dd>
            </div>
          ) : null}
        </dl>
      </Carte>

      <ActionsMission
        mission={{
          id: m.id,
          intitule: m.intitule,
          statut: m.statut,
          devise: m.devise,
          directeurDesigne: m.directeur_id !== null,
        }}
        droits={droits}
        natures={naturesSupplementaires(roles)}
        peutSaisirTaux={aPermission(roles, "finance.lire") || roles.includes("associe")}
        clients={clients}
      />

      <EquipeMission
        missionId={m.id}
        equipe={m.equipe}
        personnes={optionsPersonnes(personnesCabinet)}
        modifiable={droits.planifier}
      />

      <Carte
        titre={t("Échanges sur la mission", "Engagement discussion")}
        actions={
          aPermission(roles, "tache.assigner") ? (
            <Link href={hrefNouvelleTache("mission", m.id)} className={classesBouton("secondaire")}>
              <Icone nom="taches" />
              <span>{t("Assigner une tâche", "Assign a task")}</span>
            </Link>
          ) : null
        }
      >
        <div className="mp-pile">
          <p className="mp-texte-doux">
            {t(
              "Les documents de la mission (versions, validation) sont dans l'onglet ",
              "The engagement's documents (versions, approval) are in the ",
            )}
            <Link href={`/missions/${m.id}/documents`}>{t("Documents", "Documents")}</Link>
            {t(".", " tab.")}
          </p>
          <Commentaires
            entiteType="mission"
            entiteId={m.id}
            utilisateurId={utilisateur.id}
            associe={roles.includes("associe")}
            niveauTitre={3}
            nomElement={t(`la mission ${m.intitule}`, `engagement ${m.intitule}`)}
          />
        </div>
      </Carte>
    </div>
  );
}
