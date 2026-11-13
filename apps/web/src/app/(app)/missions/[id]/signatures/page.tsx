import Link from "next/link";
import type { Metadata } from "next";
import { aPermission, type DemandeSignatureApi } from "@missionpilot/shared";
import { AvertissementSignature } from "../../../../../components/signatures/AvertissementSignature";
import { NouvelleDemandeSignature } from "../../../../../components/signatures/NouvelleDemandeSignature";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { EtatErreur, EtatVide } from "../../../../../components/ui/EtatListe";
import { Tableau } from "../../../../../components/ui/Tableau";
import { chargerServeur } from "../../../../../lib/api-serveur";
import { chargerToutesPagesCanaux } from "../../../../../lib/canaux-serveur";
import { dateCourte } from "../../../../../lib/canaux";
import { obtenirLangue, obtenirT } from "../../../../../lib/i18n/serveur";
import type { VersionDocument } from "../../../../../lib/documents";
import { chargerMission } from "../../../../../lib/missions-serveur";
import { exigerPermission } from "../../../../../lib/session";
import {
  avancement,
  avancementAccessible,
  cheminApiSignatures,
  hrefSignature,
  hrefSignatures,
  LIMITE_LISTE_SIGNATURES,
  libelleEcheance,
  libelleObjetSignature,
  libelleOrdreSignature,
  libelleStatutDemande,
  signatairesClientProposes,
  signatairesCabinetProposes,
  tonaliteStatutDemande,
  type UtilisateurPortailPropose,
} from "../../../../../lib/signatures";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Signatures de la mission", "Engagement signatures") };
}

/**
 * Demandes de signature de la mission (CLI-05) : document, objet, statut, avancement, échéance.
 * Signature SIMULÉE : sans valeur juridique, aucun fournisseur externe.
 */
export default async function PageSignaturesMission({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const { utilisateur } = await exigerPermission("signature.lire");
  const m = await chargerMission(id);
  // L'en-tête (layout) affiche déjà l'erreur de chargement de la mission.
  if (!m.ok) return null;
  const mission = m.donnees;
  const peutDemander =
    aPermission(utilisateur.roles, "signature.demander") && mission.statut !== "cloturee";

  const demandes = await chargerToutesPagesCanaux<DemandeSignatureApi>(
    cheminApiSignatures(mission.id),
    LIMITE_LISTE_SIGNATURES,
  );

  // Formulaire : documents de la mission et signataires proposés (chargés seulement si utiles).
  let documents: VersionDocument[] = [];
  let proposes = signatairesCabinetProposes(
    {
      directeurId: mission.directeur_id,
      equipe: mission.equipe,
      moi: { id: utilisateur.id, nom: utilisateur.nom, roles: utilisateur.roles },
    },
    langue,
  );
  let noteClient: string | null = null;
  if (peutDemander) {
    const docs = await chargerServeur<{ elements: VersionDocument[] }>(
      `/api/missions/${mission.id}/documents`,
    );
    if (docs.ok) documents = docs.donnees.elements;
    if (aPermission(utilisateur.roles, "portail.gerer")) {
      const portail = await chargerServeur<{ utilisateurs: UtilisateurPortailPropose[] }>(
        `/api/portail/utilisateurs?client_id=${mission.client_id}`,
      );
      if (portail.ok) {
        const clients = signatairesClientProposes(portail.donnees.utilisateurs, langue);
        proposes = [...proposes, ...clients];
        if (clients.length === 0) {
          noteClient = t(
            "Le client n'a aucun dirigeant actif sur le portail : invitez-en un depuis sa fiche, onglet « Portail client ».",
            'The client has no active executive on the portal: invite one from its record, "Client portal" tab.',
          );
        }
      } else {
        noteClient = t(
          "Les dirigeants du client n'ont pas pu être chargés.",
          "The client's executives could not be loaded.",
        );
      }
    } else {
      noteClient = t(
        "Vous ne pouvez pas lister les personnes du portail du client : demandez à un associé ou au directeur de la mission.",
        "You cannot list the people on the client's portal: ask a partner or the engagement director.",
      );
    }
  }

  return (
    <div className="mp-pile">
      <AvertissementSignature />
      {peutDemander ? (
        <NouvelleDemandeSignature
          missionId={mission.id}
          documents={documents}
          proposes={proposes}
          noteClient={noteClient}
        />
      ) : null}
      {!demandes.ok ? (
        <EtatErreur
          titre={t(
            "Les demandes de signature n'ont pas pu être chargées.",
            "The signature requests could not be loaded.",
          )}
          message={demandes.message}
          hrefReessayer={hrefSignatures(mission.id)}
        />
      ) : demandes.donnees.elements.length === 0 ? (
        <EtatVide
          titre={t(
            "Aucune demande de signature pour cette mission.",
            "No signature request for this engagement.",
          )}
          icone="signature"
        >
          <p>
            {t(
              "Une demande porte sur un PDF de la mission (lettre de mission, avenant, procès-verbal) et réunit des signataires du cabinet et du client.",
              "A request covers an engagement PDF (engagement letter, amendment, minutes) and brings together signatories from the firm and the client.",
            )}
          </p>
        </EtatVide>
      ) : (
        <Tableau<DemandeSignatureApi>
          legende={t("Demandes de signature", "Signature requests")}
          legendeVisible
          cleLigne={(d) => d.id}
          colonnes={[
            {
              cle: "document",
              entete: t("Document", "Document"),
              rendu: (d) => (
                <Link href={hrefSignature(mission.id, d.id)} prefetch={false}>
                  {d.document_nom}
                </Link>
              ),
            },
            {
              cle: "objet",
              entete: t("Objet", "Subject"),
              rendu: (d) => libelleObjetSignature(d.objet, langue),
            },
            {
              cle: "statut",
              entete: t("Statut", "Status"),
              rendu: (d) => (
                <BadgeStatut tonalite={tonaliteStatutDemande(d.statut)}>
                  {libelleStatutDemande(d.statut, langue)}
                </BadgeStatut>
              ),
            },
            {
              cle: "avancement",
              entete: t("Avancement", "Progress"),
              rendu: (d) => (
                <span aria-label={avancementAccessible(d, langue)}>
                  {avancement(d, langue)}
                  <br />
                  <span className="mp-texte-doux mp-texte-petit">
                    {libelleOrdreSignature(d.ordre, langue)}
                  </span>
                </span>
              ),
            },
            {
              cle: "echeance",
              entete: t("Échéance", "Due date"),
              rendu: (d) => libelleEcheance(d.expire_le, langue),
            },
            {
              cle: "creee",
              entete: t("Créée le", "Created on"),
              rendu: (d) => dateCourte(d.cree_le, langue),
            },
          ]}
          lignes={demandes.donnees.elements}
        />
      )}
      {demandes.ok && demandes.donnees.tronquee ? (
        <p className="mp-texte-doux mp-texte-petit">
          {t(
            "La liste est partielle : seules les demandes les plus récentes sont affichées.",
            "The list is partial: only the most recent requests are shown.",
          )}
        </p>
      ) : null}
    </div>
  );
}
