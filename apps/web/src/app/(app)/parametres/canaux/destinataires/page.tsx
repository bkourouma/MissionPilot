import Link from "next/link";
import type { Metadata } from "next";
import type { DestinataireCanalApi } from "@missionpilot/shared";
import { ActionsDestinataireCanal } from "../../../../../components/canaux/ActionsDestinataireCanal";
import { Alerte } from "../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { classesBouton } from "../../../../../components/ui/Bouton";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide } from "../../../../../components/ui/EtatListe";
import { Icone } from "../../../../../components/ui/Icone";
import { Select } from "../../../../../components/ui/Select";
import { Tableau } from "../../../../../components/ui/Tableau";
import {
  CHEMIN_CANAUX_DESTINATAIRES,
  cheminSyntheseClient,
  dateCourte,
  droitsCanaux,
  libelleCanal,
  libelleConsentement,
  libelleNumero,
  libelleRole,
  libelleSourceConsentement,
  tonaliteConsentement,
} from "../../../../../lib/canaux";
import {
  chargerClientsPourCanaux,
  chargerDestinatairesClient,
} from "../../../../../lib/canaux-serveur";
import { estIdentifiant } from "../../../../../lib/identifiant";
import { exigerPermission } from "../../../../../lib/session";

export const metadata: Metadata = { title: "Destinataires et consentements" };

/**
 * Destinataires d'un client et consentement de chacun : numéro masqué, vérifié ou non, état du
 * consentement, source et date. Le cabinet enregistre un numéro de test, saisit le code reçu,
 * enregistre un consentement recueilli (avec la référence de la preuve) ou retire. Jamais un
 * numéro en entier, jamais un contenu de message.
 */
export default async function PageDestinatairesCanaux({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { utilisateur } = await exigerPermission("canaux.lire");
  const droits = droitsCanaux(utilisateur.roles);
  const brut = (await searchParams).client_id;
  const demande = (Array.isArray(brut) ? brut[0] : brut) ?? "";
  const clientId = estIdentifiant(demande) ? demande : "";

  const clients = await chargerClientsPourCanaux();
  const destinataires = clientId ? await chargerDestinatairesClient(clientId) : null;
  const client = clients.ok ? clients.donnees.elements.find((c) => c.id === clientId) : undefined;

  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Destinataires et consentements"
        soustitre="Choisissez un client : vous voyez, pour chaque personne de son portail, le numéro (masqué), sa vérification et son consentement. Rien n'est envoyé sans un accord actif et un numéro vérifié."
      />
      {!clients.ok ? (
        <EtatErreur
          titre="La liste des clients n'a pas pu être chargée."
          message={clients.message}
          hrefReessayer={CHEMIN_CANAUX_DESTINATAIRES}
        />
      ) : (
        <form
          method="get"
          action={CHEMIN_CANAUX_DESTINATAIRES}
          className="mp-filtres"
          aria-label="Choisir un client"
        >
          <div className="mp-grille-champs mp-grille-champs--filtres">
            <Select
              libelle="Client"
              name="client_id"
              defaultValue={clientId}
              invite="Choisir un client…"
              options={clients.donnees.elements.map((c) => ({
                valeur: c.id,
                libelle: c.raison_sociale,
              }))}
            />
          </div>
          <div className="mp-actions-formulaire">
            <button type="submit" className={classesBouton("primaire")}>
              <Icone nom="recherche" />
              <span>Afficher</span>
            </button>
          </div>
          {clients.donnees.tronquee ? (
            <p className="mp-texte-doux mp-texte-petit">
              La liste des clients est partielle : seuls les premiers sont proposés.
            </p>
          ) : null}
        </form>
      )}

      {destinataires === null ? (
        clients.ok ? (
          <EtatVide titre="Choisissez un client pour voir ses destinataires." icone="personnes" />
        ) : null
      ) : !destinataires.ok ? (
        <EtatErreur
          titre="Les destinataires n'ont pas pu être chargés."
          message={destinataires.message}
          hrefReessayer={`${CHEMIN_CANAUX_DESTINATAIRES}?client_id=${clientId}`}
        />
      ) : (
        <>
          {client ? (
            <p>
              <Link href={cheminSyntheseClient(client.id)} className="mp-lien-action">
                <Icone nom="oeil" taille={18} />
                <span>{`Aperçu de la synthèse hebdomadaire de ${client.raison_sociale}`}</span>
              </Link>
            </p>
          ) : null}
          {destinataires.donnees.tronquee ? (
            <Alerte tonalite="attention" annonce="aucune" titre="Liste partielle">
              <p>Seuls les premiers destinataires sont affichés.</p>
            </Alerte>
          ) : null}
          {destinataires.donnees.elements.length === 0 ? (
            <EtatVide titre="Aucun destinataire pour ce client." icone="personnes">
              <p>
                Les destinataires sont les personnes du portail de ce client. Invitez-les depuis la
                fiche du client, onglet « Portail client ».
              </p>
            </EtatVide>
          ) : (
            <Tableau<DestinataireCanalApi>
              legende="Destinataires et consentements"
              legendeVisible
              cleLigne={(d) => `${d.utilisateur_id}:${d.canal}`}
              colonnes={[
                {
                  cle: "personne",
                  entete: "Personne",
                  rendu: (d) => (
                    <span>
                      <strong>{d.utilisateur_nom}</strong>
                      <br />
                      <span className="mp-texte-doux mp-texte-petit">{libelleRole(d.role)}</span>
                    </span>
                  ),
                },
                { cle: "canal", entete: "Canal", rendu: (d) => libelleCanal(d.canal) },
                { cle: "numero", entete: "Numéro", rendu: (d) => libelleNumero(d) },
                {
                  cle: "consentement",
                  entete: "Consentement",
                  rendu: (d) => (
                    <span>
                      <BadgeStatut tonalite={tonaliteConsentement(d.consentement)}>
                        {libelleConsentement(d.consentement)}
                      </BadgeStatut>
                      {d.consentement_source ? (
                        <>
                          <br />
                          <span className="mp-texte-doux mp-texte-petit">
                            {`${libelleSourceConsentement(d.consentement_source)}, ${dateCourte(d.consentement_le)}`}
                          </span>
                        </>
                      ) : null}
                    </span>
                  ),
                },
                {
                  cle: "actions",
                  entete: "Actions",
                  rendu: (d) => (
                    <ActionsDestinataireCanal destinataire={d} peutGerer={droits.gerer} />
                  ),
                },
              ]}
              lignes={destinataires.donnees.elements}
            />
          )}
        </>
      )}
    </div>
  );
}
