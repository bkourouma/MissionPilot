import Link from "next/link";
import type { Metadata } from "next";
import { aPermission } from "@missionpilot/shared";
import { classesBouton } from "../../../../components/ui/Bouton";
import { Carte } from "../../../../components/ui/Carte";
import { EtatErreur } from "../../../../components/ui/EtatListe";
import { Icone } from "../../../../components/ui/Icone";
import { chargerServeur } from "../../../../lib/api-serveur";
import { MODE_LIBELLES } from "../../../../lib/catalogue";
import { formaterDate, formaterDateHeure, formaterNombre } from "../../../../lib/format";
import {
  droitsMission,
  naturesSupplementaires,
  STATUT_MISSION,
  type DocumentMission,
} from "../../../../lib/missions";
import { chargerMission } from "../../../../lib/missions-serveur";
import { nomPersonne, optionsPersonnes, type Personne } from "../../../../lib/personnes";
import {
  chargerClientsActifs,
  chargerPersonnes,
  chargerTypesActifs,
} from "../../../../lib/referentiels-serveur";
import { exigerPermission } from "../../../../lib/session";
import { ActionsMission } from "./ActionsMission";
import { DocumentsMission } from "./DocumentsMission";
import { EquipeMission } from "./EquipeMission";

export const metadata: Metadata = { title: "Fiche mission" };

export default async function PageFicheMission({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { utilisateur } = await exigerPermission("mission.lire");
  const roles = utilisateur.roles;
  const r = await chargerMission(id);
  // L'en-tête (layout) affiche déjà l'erreur de chargement.
  if (!r.ok) return null;
  const m = r.donnees;
  const droits = droitsMission(m, roles, utilisateur.id);
  const [types, personnesCabinet, documents, clients] = await Promise.all([
    chargerTypesActifs(roles),
    chargerPersonnes(roles),
    chargerServeur<{ elements: DocumentMission[] }>(`/api/missions/${m.id}/documents`),
    droits.dupliquer ? chargerClientsActifs(roles) : Promise.resolve([]),
  ]);
  // Sans accès au référentiel, les noms connus viennent de l'équipe de la mission.
  const personnes: Personne[] = personnesCabinet.length
    ? personnesCabinet
    : m.equipe.map((e) => ({ utilisateur_id: e.utilisateur_id, nom: e.nom, grade_libelle: null }));
  const nom = (pid: string | null) =>
    pid && pid === utilisateur.id ? `${utilisateur.nom} (vous)` : nomPersonne(pid, personnes);
  const type = m.type_mission_id
    ? (types.find((t) => t.valeur === m.type_mission_id)?.libelle ?? "Type archivé ou non visible")
    : "Mission sans modèle";

  return (
    <div className="mp-pile mp-pile--large">
      <Carte
        titre="Fiche mission"
        actions={
          droits.modifier ? (
            <Link href={`/missions/${m.id}/modifier`} className={classesBouton("secondaire")}>
              <Icone nom="crayon" />
              <span>Modifier</span>
            </Link>
          ) : null
        }
      >
        <dl className="mp-liste-def">
          <div>
            <dt>Client</dt>
            <dd>
              {aPermission(roles, "clients.lire") ? (
                <Link href={`/clients/${m.client_id}`}>{m.client_raison_sociale}</Link>
              ) : (
                m.client_raison_sociale
              )}
            </dd>
          </div>
          <div>
            <dt>Type de mission</dt>
            <dd>{type}</dd>
          </div>
          <div>
            <dt>Directeur de mission</dt>
            <dd>{m.directeur_id ? nom(m.directeur_id) : "À désigner"}</dd>
          </div>
          <div>
            <dt>Chef de mission</dt>
            <dd>{m.chef_id ? nom(m.chef_id) : "À désigner"}</dd>
          </div>
          <div>
            <dt>Dates</dt>
            <dd>
              {m.date_debut || m.date_fin
                ? `Du ${formaterDate(m.date_debut)} au ${formaterDate(m.date_fin)}`
                : "Non planifiée"}
            </dd>
          </div>
          <div>
            <dt>Devise</dt>
            <dd>{m.devise}</dd>
          </div>
          <div>
            <dt>Mode de facturation</dt>
            <dd>{MODE_LIBELLES[m.mode_facturation]}</dd>
          </div>
          <div>
            <dt>Statut</dt>
            <dd>{STATUT_MISSION[m.statut].libelle}</dd>
          </div>
          {m.date_signature ? (
            <div>
              <dt>Lettre de mission signée le</dt>
              <dd>{formaterDate(m.date_signature)}</dd>
            </div>
          ) : null}
          {m.taux_change !== null && m.devise_reference && m.devise_reference !== m.devise ? (
            <div>
              <dt>Taux de change figé</dt>
              <dd>{`1 ${m.devise} = ${formaterNombre(m.taux_change, 6)} ${m.devise_reference}`}</dd>
            </div>
          ) : null}
          {m.activite || m.secteur || m.bureau ? (
            <div>
              <dt>Axes analytiques</dt>
              <dd>{[m.activite, m.secteur, m.bureau].filter(Boolean).join(" · ")}</dd>
            </div>
          ) : null}
          {m.proposition_id && aPermission(roles, "pipeline.gerer") ? (
            <div>
              <dt>Origine</dt>
              <dd>
                <Link href={`/pipeline/propositions/${m.proposition_id}`}>
                  Proposition acceptée
                </Link>
              </dd>
            </div>
          ) : null}
          {m.mission_source_id ? (
            <div>
              <dt>Dupliquée de</dt>
              <dd>
                <Link href={`/missions/${m.mission_source_id}`}>Mission d&apos;origine</Link>
              </dd>
            </div>
          ) : null}
          {m.cloturee_le ? (
            <div>
              <dt>Clôturée le</dt>
              <dd>{formaterDateHeure(m.cloturee_le)}</dd>
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

      {documents.ok ? (
        <DocumentsMission
          missionId={m.id}
          documents={documents.donnees.elements}
          typesPermis={droits.typesDocument}
        />
      ) : (
        <EtatErreur
          titre="Les documents n'ont pas pu être chargés."
          message={documents.message}
          hrefReessayer={`/missions/${m.id}`}
        />
      )}
    </div>
  );
}
