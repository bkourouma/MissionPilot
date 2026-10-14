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

export const metadata: Metadata = { title: "Signatures de la mission" };

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
  let proposes = signatairesCabinetProposes({
    directeurId: mission.directeur_id,
    equipe: mission.equipe,
    moi: { id: utilisateur.id, nom: utilisateur.nom, roles: utilisateur.roles },
  });
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
        const clients = signatairesClientProposes(portail.donnees.utilisateurs);
        proposes = [...proposes, ...clients];
        if (clients.length === 0) {
          noteClient =
            "Le client n'a aucun dirigeant actif sur le portail : invitez-en un depuis sa fiche, onglet « Portail client ».";
        }
      } else {
        noteClient = "Les dirigeants du client n'ont pas pu être chargés.";
      }
    } else {
      noteClient =
        "Vous ne pouvez pas lister les personnes du portail du client : demandez à un associé ou au directeur de la mission.";
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
          titre="Les demandes de signature n'ont pas pu être chargées."
          message={demandes.message}
          hrefReessayer={hrefSignatures(mission.id)}
        />
      ) : demandes.donnees.elements.length === 0 ? (
        <EtatVide titre="Aucune demande de signature pour cette mission." icone="signature">
          <p>
            Une demande porte sur un PDF de la mission (lettre de mission, avenant, procès-verbal)
            et réunit des signataires du cabinet et du client.
          </p>
        </EtatVide>
      ) : (
        <Tableau<DemandeSignatureApi>
          legende="Demandes de signature"
          legendeVisible
          cleLigne={(d) => d.id}
          colonnes={[
            {
              cle: "document",
              entete: "Document",
              rendu: (d) => (
                <Link href={hrefSignature(mission.id, d.id)} prefetch={false}>
                  {d.document_nom}
                </Link>
              ),
            },
            { cle: "objet", entete: "Objet", rendu: (d) => libelleObjetSignature(d.objet) },
            {
              cle: "statut",
              entete: "Statut",
              rendu: (d) => (
                <BadgeStatut tonalite={tonaliteStatutDemande(d.statut)}>
                  {libelleStatutDemande(d.statut)}
                </BadgeStatut>
              ),
            },
            {
              cle: "avancement",
              entete: "Avancement",
              rendu: (d) => (
                <span aria-label={avancementAccessible(d)}>
                  {avancement(d)}
                  <br />
                  <span className="mp-texte-doux mp-texte-petit">
                    {libelleOrdreSignature(d.ordre)}
                  </span>
                </span>
              ),
            },
            { cle: "echeance", entete: "Échéance", rendu: (d) => libelleEcheance(d.expire_le) },
            { cle: "creee", entete: "Créée le", rendu: (d) => dateCourte(d.cree_le) },
          ]}
          lignes={demandes.donnees.elements}
        />
      )}
      {demandes.ok && demandes.donnees.tronquee ? (
        <p className="mp-texte-doux mp-texte-petit">
          La liste est partielle : seules les demandes les plus récentes sont affichées.
        </p>
      ) : null}
    </div>
  );
}
