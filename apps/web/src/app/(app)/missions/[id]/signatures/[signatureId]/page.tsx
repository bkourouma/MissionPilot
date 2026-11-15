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
import { obtenirLangue, obtenirT } from "../../../../../../lib/i18n/serveur";
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

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Demande de signature", "Signature request") };
}

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
  const t = await obtenirT();
  const langue = await obtenirLangue();
  if (!estIdentifiant(id) || !estIdentifiant(signatureId)) notFound();
  const session = await exigerPermission("signature.lire");
  const r = await chargerServeur<DossierPreuveApi>(cheminApiPreuvesSignature(signatureId));
  if (!r.ok && r.statut === 404) notFound();
  const retour = {
    href: hrefSignatures(id),
    libelle: t("Signatures de la mission", "Engagement signatures"),
  };
  if (!r.ok) {
    return (
      <div className="mp-pile">
        <EtatErreur
          titre={t("La demande n'a pas pu être chargée.", "The request could not be loaded.")}
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
  const verif = libelleVerification(verification, langue);

  return (
    <div className="mp-pile">
      <Link href={retour.href} className="mp-lien-retour">
        <Icone nom="chevronGauche" taille={18} />
        <span>{retour.libelle}</span>
      </Link>
      <h2 className="mp-section__titre">{demande.document_nom}</h2>
      <p className="mp-texte-doux">
        {`${libelleObjetSignature(demande.objet, langue)} · ${libelleOrdreSignature(demande.ordre, langue)} `}
        <BadgeStatut tonalite={tonaliteStatutDemande(demande.statut)}>
          {libelleStatutDemande(demande.statut, langue)}
        </BadgeStatut>
      </p>
      <AvertissementSignature />
      <Carte titre={t("Demande", "Request")} niveauTitre={2}>
        <dl className="mp-liste-def">
          <div>
            <dt>{t("Avancement", "Progress")}</dt>
            <dd>{`${avancement(demande, langue)} ${t("signatures", "signatures")}`}</dd>
          </div>
          <div>
            <dt>{t("Échéance", "Due date")}</dt>
            <dd>{libelleEcheance(demande.expire_le, langue)}</dd>
          </div>
          <div>
            <dt>{t("Créée le", "Created on")}</dt>
            <dd>{dateCourte(demande.cree_le, langue)}</dd>
          </div>
          {demande.budget_version ? (
            <div>
              <dt>{t("Avenant à la version de budget", "Amendment to the budget version")}</dt>
              <dd>{`${t("n°", "no.")} ${demande.budget_version.numero} (${demande.budget_version.type})`}</dd>
            </div>
          ) : null}
          <div>
            <dt>{t("Empreinte du document (SHA-256)", "Document fingerprint (SHA-256)")}</dt>
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
            <span>
              {t(
                "Lire le document (la lecture est inscrite dans les preuves)",
                "Read the document (the reading is recorded in the evidence)",
              )}
            </span>
          </a>{" "}
          <a className="mp-lien-action" href={hrefDocumentSignature(demande.id)} download>
            <span>{t("Télécharger", "Download")}</span>
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
      <Carte titre={t("Signataires", "Signatories")} niveauTitre={2}>
        <Tableau<SignataireSignatureApi>
          legende={t("Signataires de la demande", "Request signatories")}
          cleLigne={(s) => s.id}
          colonnes={[
            { cle: "rang", entete: t("Rang", "Order"), rendu: (s) => String(s.rang) },
            { cle: "nom", entete: t("Nom", "Name"), rendu: (s) => s.nom },
            {
              cle: "partie",
              entete: t("Partie", "Party"),
              rendu: (s) => libellePartie(s.partie, langue),
            },
            {
              cle: "statut",
              entete: t("Statut", "Status"),
              rendu: (s) => (
                <BadgeStatut tonalite={tonaliteStatutSignataire(s.statut)}>
                  {libelleStatutSignataire(s.statut, langue)}
                </BadgeStatut>
              ),
            },
            {
              cle: "decide",
              entete: t("Décision", "Decision"),
              rendu: (s) => dateHeureCourte(s.decide_le, langue),
            },
          ]}
          lignes={signataires}
        />
      </Carte>
      <Carte
        titre={t("Preuves", "Evidence")}
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
          titre={t("Vérification de la chaîne de preuves", "Evidence chain verification")}
        >
          <p>{verif.libelle}</p>
        </Alerte>
        <FriseSignature preuves={preuves} signataires={signataires} />
        <p className="mp-texte-doux mp-texte-petit">
          {t(
            "Les dates viennent de l'horloge de CabinetPilot : ce n'est pas un horodatage qualifié.",
            "Dates come from the CabinetPilot clock: this is not a qualified timestamp.",
          )}
        </p>
      </Carte>
    </div>
  );
}
