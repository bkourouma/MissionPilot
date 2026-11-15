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
import { obtenirLangue, obtenirT } from "../../../../../lib/i18n/serveur";
import { exigerPermission } from "../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Destinataires et consentements", "Recipients and consents") };
}

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
  const langue = await obtenirLangue();
  const t = await obtenirT();
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
        titre={t("Destinataires et consentements", "Recipients and consents")}
        soustitre={t(
          "Choisissez un client : vous voyez, pour chaque personne de son portail, le numéro (masqué), sa vérification et son consentement. Rien n'est envoyé sans un accord actif et un numéro vérifié.",
          "Choose a client: for each person in its portal you see the number (masked), its verification and their consent. Nothing is sent without active consent and a verified number.",
        )}
      />
      {!clients.ok ? (
        <EtatErreur
          titre={t(
            "La liste des clients n'a pas pu être chargée.",
            "The list of clients could not be loaded.",
          )}
          message={clients.message}
          hrefReessayer={CHEMIN_CANAUX_DESTINATAIRES}
        />
      ) : (
        <form
          method="get"
          action={CHEMIN_CANAUX_DESTINATAIRES}
          className="mp-filtres"
          aria-label={t("Choisir un client", "Choose a client")}
        >
          <div className="mp-grille-champs mp-grille-champs--filtres">
            <Select
              libelle="Client"
              name="client_id"
              defaultValue={clientId}
              invite={t("Choisir un client…", "Choose a client…")}
              options={clients.donnees.elements.map((c) => ({
                valeur: c.id,
                libelle: c.raison_sociale,
              }))}
            />
          </div>
          <div className="mp-actions-formulaire">
            <button type="submit" className={classesBouton("primaire")}>
              <Icone nom="recherche" />
              <span>{t("Afficher", "Show")}</span>
            </button>
          </div>
          {clients.donnees.tronquee ? (
            <p className="mp-texte-doux mp-texte-petit">
              {t(
                "La liste des clients est partielle : seuls les premiers sont proposés.",
                "The list of clients is partial: only the first ones are offered.",
              )}
            </p>
          ) : null}
        </form>
      )}

      {destinataires === null ? (
        clients.ok ? (
          <EtatVide
            titre={t(
              "Choisissez un client pour voir ses destinataires.",
              "Choose a client to see its recipients.",
            )}
            icone="personnes"
          />
        ) : null
      ) : !destinataires.ok ? (
        <EtatErreur
          titre={t(
            "Les destinataires n'ont pas pu être chargés.",
            "The recipients could not be loaded.",
          )}
          message={destinataires.message}
          hrefReessayer={`${CHEMIN_CANAUX_DESTINATAIRES}?client_id=${clientId}`}
        />
      ) : (
        <>
          {client ? (
            <p>
              <Link href={cheminSyntheseClient(client.id)} className="mp-lien-action">
                <Icone nom="oeil" taille={18} />
                <span>
                  {t(
                    `Aperçu de la synthèse hebdomadaire de ${client.raison_sociale}`,
                    `Preview of the weekly summary for ${client.raison_sociale}`,
                  )}
                </span>
              </Link>
            </p>
          ) : null}
          {destinataires.donnees.tronquee ? (
            <Alerte
              tonalite="attention"
              annonce="aucune"
              titre={t("Liste partielle", "Partial list")}
            >
              <p>
                {t(
                  "Seuls les premiers destinataires sont affichés.",
                  "Only the first recipients are shown.",
                )}
              </p>
            </Alerte>
          ) : null}
          {destinataires.donnees.elements.length === 0 ? (
            <EtatVide
              titre={t("Aucun destinataire pour ce client.", "No recipient for this client.")}
              icone="personnes"
            >
              <p>
                {t(
                  "Les destinataires sont les personnes du portail de ce client. Invitez-les depuis la fiche du client, onglet « Portail client ».",
                  'Recipients are the people in this client\'s portal. Invite them from the client record, "Client portal" tab.',
                )}
              </p>
            </EtatVide>
          ) : (
            <Tableau<DestinataireCanalApi>
              legende={t("Destinataires et consentements", "Recipients and consents")}
              legendeVisible
              cleLigne={(d) => `${d.utilisateur_id}:${d.canal}`}
              colonnes={[
                {
                  cle: "personne",
                  entete: t("Personne", "Person"),
                  rendu: (d) => (
                    <span>
                      <strong>{d.utilisateur_nom}</strong>
                      <br />
                      <span className="mp-texte-doux mp-texte-petit">
                        {libelleRole(d.role, langue)}
                      </span>
                    </span>
                  ),
                },
                {
                  cle: "canal",
                  entete: t("Canal", "Channel"),
                  rendu: (d) => libelleCanal(d.canal, langue),
                },
                {
                  cle: "numero",
                  entete: t("Numéro", "Number"),
                  rendu: (d) => libelleNumero(d, langue),
                },
                {
                  cle: "consentement",
                  entete: t("Consentement", "Consent"),
                  rendu: (d) => (
                    <span>
                      <BadgeStatut tonalite={tonaliteConsentement(d.consentement)}>
                        {libelleConsentement(d.consentement, langue)}
                      </BadgeStatut>
                      {d.consentement_source ? (
                        <>
                          <br />
                          <span className="mp-texte-doux mp-texte-petit">
                            {`${libelleSourceConsentement(d.consentement_source, langue)}, ${dateCourte(d.consentement_le, langue)}`}
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
