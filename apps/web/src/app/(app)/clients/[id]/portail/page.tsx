import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { aPermission } from "@missionpilot/shared";
import { FormulaireInvitationClient } from "../../../../../components/portail-gestion/FormulaireInvitationClient";
import { InvitationsPortail } from "../../../../../components/portail-gestion/InvitationsPortail";
import {
  FormulairePartages,
  FournisseurPartages,
  ResumePartages,
} from "../../../../../components/portail-gestion/Partages";
import { UtilisateursPortail } from "../../../../../components/portail-gestion/UtilisateursPortail";
import { Alerte } from "../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../../components/ui/EtatListe";
import { Onglets } from "../../../../../components/ui/Onglets";
import { chargerServeur, type Chargement } from "../../../../../lib/api-serveur";
import type { ClientDetaille } from "../../../../../lib/clients";
import { estIdentifiant } from "../../../../../lib/identifiant";
import type { PageMissions } from "../../../../../lib/missions";
import { chargerToutesLesPages } from "../../../../../lib/pagination";
import {
  CHEMIN_PARAMETRES_PORTAIL,
  cheminDocumentsMission,
  cheminPartagesPortail,
  cheminUtilisateursPortail,
  gereLeClient,
  HREF_POLITIQUE_PORTAIL,
  hrefPortailClient,
  MESSAGE_CLIENT_NON_GERE,
  missionGerable,
  missionsPartageables,
  modifiePolitiquePortail,
  ongletsClientAvecPortail,
  optionsContactPrincipal,
  type DocumentCandidat,
  type MissionClient,
  type ParametresPortail,
  type PartagesClient,
  type UtilisateursPortailClient,
} from "../../../../../lib/portail-gestion";
import { chargerPersonnes } from "../../../../../lib/referentiels-serveur";
import { exigerPermission } from "../../../../../lib/session";

export const metadata: Metadata = { title: "Portail client" };

/** Appels simultanés au plus vers l'API pour les documents des missions (charge bornée). */
const LOT_DOCUMENTS = 6;

/** Dernières versions des documents de chaque mission gérable ; `null` : échec du chargement. */
async function chargerDocuments(
  missions: readonly MissionClient[],
): Promise<Map<string, DocumentCandidat[] | null>> {
  const resultat = new Map<string, DocumentCandidat[] | null>();
  for (let i = 0; i < missions.length; i += LOT_DOCUMENTS) {
    const lot = await Promise.all(
      missions.slice(i, i + LOT_DOCUMENTS).map(async (m) => {
        const r = await chargerServeur<{ elements: DocumentCandidat[] }>(
          cheminDocumentsMission(m.id),
        );
        return [m.id, r.ok ? r.donnees.elements : null] as const;
      }),
    );
    for (const [id, docs] of lot) resultat.set(id, docs);
  }
  return resultat;
}

/**
 * Portail client d'un client (SOC-09), côté cabinet : qui y accède (utilisateurs, invitations)
 * et ce qu'il y voit (partages explicites, RIEN par défaut). « portail.gerer » ; un chef de
 * mission ne gère que les clients et missions qu'il dirige (l'API décide, l'écran l'annonce).
 */
export default async function PagePortailClient({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!estIdentifiant(id)) notFound();
  const { utilisateur } = await exigerPermission("portail.gerer");
  const roles = utilisateur.roles;
  const [client, missions] = await Promise.all([
    chargerServeur<ClientDetaille>(`/api/clients/${id}`),
    chargerToutesLesPages(
      (chemin) => chargerServeur<PageMissions>(chemin),
      `/api/missions?client_id=${id}`,
    ),
  ]);
  if (!client.ok && client.statut === 404) notFound();
  const c = client.ok ? client.donnees : null;

  const entete = (
    <>
      <EnteteDePage
        titre={c?.raison_sociale ?? "Fiche client"}
        retour={{ href: "/clients", libelle: "Clients" }}
        badges={c && !c.actif ? <BadgeStatut tonalite="neutre">Archivé</BadgeStatut> : undefined}
        soustitre="Qui accède au portail de ce client et ce qu'il y voit. Rien n'est partagé par défaut : chaque élément visible a été coché ici."
      />
      <Onglets libelle="Sections de la fiche client" pages={ongletsClientAvecPortail(id, roles)} />
    </>
  );

  if (!client.ok || !missions.ok) {
    return (
      <div className="mp-page">
        {entete}
        <EtatErreur
          titre="Le portail de ce client n'a pas pu être chargé."
          message={!client.ok ? client.message : !missions.ok ? missions.message : ""}
          hrefReessayer={hrefPortailClient(id)}
        />
      </div>
    );
  }
  const fiche = client.donnees;
  const listeMissions = missions.donnees.elements;

  if (!gereLeClient(listeMissions, utilisateur.id, roles)) {
    return (
      <div className="mp-page">
        {entete}
        <Alerte tonalite="info" annonce="aucune" titre="Vous ne gérez pas le portail de ce client">
          <p>{MESSAGE_CLIENT_NON_GERE}</p>
        </Alerte>
      </div>
    );
  }

  const gerables = listeMissions.filter((m) => missionGerable(m, utilisateur.id, roles));
  const [utilisateurs, partages, parametres, personnes, documents] = await Promise.all([
    chargerServeur<UtilisateursPortailClient>(cheminUtilisateursPortail(id)),
    chargerServeur<PartagesClient>(cheminPartagesPortail(id)),
    chargerServeur<ParametresPortail>(CHEMIN_PARAMETRES_PORTAIL),
    chargerPersonnes(roles),
    chargerDocuments(gerables),
  ]);

  const acces = (
    <SectionAcces
      clientId={id}
      raisonSociale={fiche.raison_sociale}
      clientActif={fiche.actif}
      utilisateurs={utilisateurs}
      parametres={parametres}
      peutModifierPolitique={modifiePolitiquePortail(roles)}
    />
  );

  return (
    <div className="mp-page">
      {entete}
      {fiche.actif ? null : (
        <Alerte tonalite="attention" annonce="aucune" titre="Client archivé">
          <p>
            Le portail est fermé à ce client : invitations et réactivations sont refusées tant que
            sa fiche est archivée.
          </p>
        </Alerte>
      )}
      {missions.donnees.tronquee ? (
        <Alerte tonalite="attention" annonce="aucune" titre="Liste des missions incomplète">
          <p>Ce client a trop de missions pour les afficher toutes : certaines manquent ici.</p>
        </Alerte>
      ) : null}
      {!partages.ok ? (
        <>
          <EtatErreur
            titre="Les partages de ce client n'ont pas pu être chargés."
            message={partages.message}
            hrefReessayer={hrefPortailClient(id)}
          />
          {acces}
        </>
      ) : (
        <FournisseurPartages partages={partages.donnees}>
          <ResumePartages voitToutesLesMissions={aPermission(roles, "mission.lire_toutes")} />
          {acces}
          <section aria-labelledby="titre-partages" className="mp-pile">
            <h2 id="titre-partages" className="mp-section__titre">
              Partages
            </h2>
            <p className="mp-texte-doux">
              Tout est décoché par défaut. Cochez ce que votre client peut voir, puis enregistrez :
              rien ne lui est montré avant l&apos;enregistrement.
            </p>
            <FormulairePartages
              clientId={id}
              missions={missionsPartageables({
                missions: listeMissions,
                partages: partages.donnees,
                documents,
                utilisateurId: utilisateur.id,
                roles,
              })}
              optionsContact={optionsContactPrincipal(
                personnes,
                partages.donnees.contact_principal,
              )}
            />
          </section>
        </FournisseurPartages>
      )}
    </div>
  );
}

function SectionAcces({
  clientId,
  raisonSociale,
  clientActif,
  utilisateurs,
  parametres,
  peutModifierPolitique,
}: {
  clientId: string;
  raisonSociale: string;
  clientActif: boolean;
  utilisateurs: Chargement<UtilisateursPortailClient>;
  parametres: Chargement<ParametresPortail>;
  peutModifierPolitique: boolean;
}) {
  const tfaObligatoire = parametres.ok && parametres.donnees.tfa_obligatoire;
  return (
    <section aria-labelledby="titre-acces" className="mp-pile">
      <h2 id="titre-acces" className="mp-section__titre">
        Accès au portail
      </h2>
      {parametres.ok ? (
        <p className="mp-texte-doux">
          {tfaObligatoire
            ? "La double authentification est exigée pour tous les utilisateurs du portail."
            : "La double authentification est facultative pour les utilisateurs du portail."}
          {peutModifierPolitique ? (
            <>
              {" "}
              <Link href={HREF_POLITIQUE_PORTAIL}>Modifier la politique du portail</Link>
            </>
          ) : null}
        </p>
      ) : null}
      {!utilisateurs.ok ? (
        <EtatErreur
          titre="Les accès au portail n'ont pas pu être chargés."
          message={utilisateurs.message}
          hrefReessayer={hrefPortailClient(clientId)}
        />
      ) : (
        <>
          <h3 className="mp-sous-formulaire__titre">Personnes ayant un accès</h3>
          <UtilisateursPortail
            utilisateurs={utilisateurs.donnees.utilisateurs}
            clientActif={clientActif}
            tfaObligatoire={tfaObligatoire}
          />
          <h3 className="mp-sous-formulaire__titre">Invitations en attente</h3>
          <InvitationsPortail invitations={utilisateurs.donnees.invitations} />
        </>
      )}
      <Carte titre="Inviter une personne" niveauTitre={3}>
        <FormulaireInvitationClient
          clientId={clientId}
          raisonSociale={raisonSociale}
          clientActif={clientActif}
        />
      </Carte>
    </section>
  );
}
