import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { DossierPreuveApi } from "@missionpilot/shared";
import { dateCourte, dateHeureCourte } from "../../../../../../lib/canaux";
import { ActionsSignatureCabinet } from "../../../../../../components/signatures/ActionsSignatureCabinet";
import { AvertissementSignature } from "../../../../../../components/signatures/AvertissementSignature";
import { ExporterDossierPreuve } from "../../../../../../components/signatures/ExporterDossierPreuve";
import { FriseSignature } from "../../../../../../components/signatures/FriseSignature";
import { Alerte } from "../../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../../components/ui/Carte";
import { EtatErreur } from "../../../../../../components/ui/EtatListe";
import { Icone } from "../../../../../../components/ui/Icone";
import { Tableau } from "../../../../../../components/ui/Tableau";
import { chargerServeur } from "../../../../../../lib/api-serveur";
import { estIdentifiant } from "../../../../../../lib/identifiant";
import { exigerPermission } from "../../../../../../lib/session";
import {
  actionsDemande,
  avancement,
  cheminApiPreuvesSignature,
  contenuDossierPreuve,
  demandeTerminee,
  empreinteLisible,
  hrefDocumentSignature,
  hrefSignature,
  hrefSignatures,
  libelleEcheance,
  libelleObjetSignature,
  libelleOrdreSignature,
  libellePartie,
  libelleStatutDemande,
  libelleStatutSignataire,
  libelleVerification,
  nomFichierDossierPreuve,
  tonaliteStatutDemande,
  tonaliteStatutSignataire,
  type SignataireSignatureApi,
} from "../../../../../../lib/signatures";

export const metadata: Metadata = { title: "Demande de signature" };

/**
 * Détail d'une demande de signature : document et empreinte, signataires, frise des preuves et
 * résultat de la vérification de la chaîne. La lecture du dossier de preuve est journalisée par
 * l'API. Signature SIMULÉE : sans valeur juridique.
 */
export default async function PageDetailSignature({
  params,
}: {
  params: Promise<{ id: string; signatureId: string }>;
}) {
  const { id, signatureId } = await params;
  if (!estIdentifiant(id) || !estIdentifiant(signatureId)) notFound();
  const session = await exigerPermission("signature.lire");
  const r = await chargerServeur<DossierPreuveApi>(cheminApiPreuvesSignature(signatureId));
  if (!r.ok && r.statut === 404) notFound();
  const retour = { href: hrefSignatures(id), libelle: "Signatures de la mission" };
  if (!r.ok) {
    return (
      <div className="mp-pile">
        <EtatErreur
          titre="La demande n'a pas pu être chargée."
          message={r.message}
          hrefReessayer={hrefSignature(id, signatureId)}
        />
      </div>
    );
  }
  const { demande, signataires, preuves, verification } = r.donnees;
  const actions = actionsDemande({
    demande,
    signataires,
    roles: session.utilisateur.roles,
    utilisateurId: session.utilisateur.id,
  });
  const verif = libelleVerification(verification);

  return (
    <div className="mp-pile">
      <Link href={retour.href} className="mp-lien-retour">
        <Icone nom="chevronGauche" taille={18} />
        <span>{retour.libelle}</span>
      </Link>
      <h2 className="mp-section__titre">{demande.document_nom}</h2>
      <p className="mp-texte-doux">
        {`${libelleObjetSignature(demande.objet)} · ${libelleOrdreSignature(demande.ordre)} `}
        <BadgeStatut tonalite={tonaliteStatutDemande(demande.statut)}>
          {libelleStatutDemande(demande.statut)}
        </BadgeStatut>
      </p>
      <AvertissementSignature />
      <Carte titre="Demande" niveauTitre={2}>
        <dl className="mp-liste-def">
          <div>
            <dt>Avancement</dt>
            <dd>{`${avancement(demande)} signatures`}</dd>
          </div>
          <div>
            <dt>Échéance</dt>
            <dd>{libelleEcheance(demande.expire_le)}</dd>
          </div>
          <div>
            <dt>Créée le</dt>
            <dd>{dateCourte(demande.cree_le)}</dd>
          </div>
          {demande.budget_version ? (
            <div>
              <dt>Avenant à la version de budget</dt>
              <dd>{`n° ${demande.budget_version.numero} (${demande.budget_version.type})`}</dd>
            </div>
          ) : null}
          <div>
            <dt>Empreinte du document (SHA-256)</dt>
            <dd className="mp-canaux__empreinte">{empreinteLisible(demande.empreinte_document)}</dd>
          </div>
        </dl>
        <p>
          <a
            className="mp-lien-action"
            href={hrefDocumentSignature(demande.id)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Icone nom="oeil" taille={18} />
            <span>Lire le document (la lecture est inscrite dans les preuves)</span>
          </a>{" "}
          <a className="mp-lien-action" href={hrefDocumentSignature(demande.id)} download>
            <span>Télécharger</span>
          </a>
        </p>
        {demandeTerminee(demande.statut) ? null : (
          <ActionsSignatureCabinet
            signatureId={demande.id}
            actions={actions}
            tfaActive={session.tfa_active === true}
          />
        )}
      </Carte>
      <Carte titre="Signataires" niveauTitre={2}>
        <Tableau<SignataireSignatureApi>
          legende="Signataires de la demande"
          cleLigne={(s) => s.id}
          colonnes={[
            { cle: "rang", entete: "Rang", rendu: (s) => String(s.rang) },
            { cle: "nom", entete: "Nom", rendu: (s) => s.nom },
            { cle: "partie", entete: "Partie", rendu: (s) => libellePartie(s.partie) },
            {
              cle: "statut",
              entete: "Statut",
              rendu: (s) => (
                <BadgeStatut tonalite={tonaliteStatutSignataire(s.statut)}>
                  {libelleStatutSignataire(s.statut)}
                </BadgeStatut>
              ),
            },
            { cle: "decide", entete: "Décision", rendu: (s) => dateHeureCourte(s.decide_le) },
          ]}
          lignes={signataires}
        />
      </Carte>
      <Carte
        titre="Preuves"
        niveauTitre={2}
        actions={
          actions.exporter ? (
            <ExporterDossierPreuve
              contenu={contenuDossierPreuve(r.donnees)}
              nomFichier={nomFichierDossierPreuve(demande.id)}
            />
          ) : null
        }
      >
        <Alerte
          tonalite={verif.tonalite === "danger" ? "danger" : "succes"}
          annonce={verif.tonalite === "danger" ? "alert" : "aucune"}
          titre="Vérification de la chaîne de preuves"
        >
          <p>{verif.libelle}</p>
        </Alerte>
        <FriseSignature preuves={preuves} signataires={signataires} />
        <p className="mp-texte-doux mp-texte-petit">
          Les dates viennent de l&apos;horloge de CabinetPilot : ce n&apos;est pas un horodatage
          qualifié.
        </p>
      </Carte>
    </div>
  );
}
