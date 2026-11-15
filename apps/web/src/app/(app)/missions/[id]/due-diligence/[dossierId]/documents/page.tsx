import type { Metadata } from "next";
import { DocumentsListe } from "../../../../../../../components/due-diligence/DocumentsListe";
import { DocumentsTeleversement } from "../../../../../../../components/due-diligence/DocumentsTeleversement";
import { Alerte } from "../../../../../../../components/ui/Alerte";
import { Carte } from "../../../../../../../components/ui/Carte";
import { EtatErreur } from "../../../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../../../lib/api-serveur";
import { obtenirT } from "../../../../../../../lib/i18n/serveur";
import { estIdentifiant } from "../../../../../../../lib/identifiant";
import {
  apiIngestionDd,
  avecRequete,
  cheminListe,
  hrefDocumentsDd,
  type PageDocumentsIngestion,
} from "../../../../../../../lib/ingestion";
import { droitsIngestionDd } from "../../../../../../../lib/ingestion-extractions";
import { chargerMission } from "../../../../../../../lib/missions-serveur";
import { exigerPermission } from "../../../../../../../lib/session";
import { notFound } from "next/navigation";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Documents du dossier", "File documents") };
}

/**
 * Documents du dossier de due diligence (DD-02 rapports, DD-10 salle de données) : téléversement,
 * suivi de la lecture et accès à la lecture IA, qui reste un brouillon tant qu'elle n'est pas validée.
 */
export default async function PageDocumentsDd({
  params,
}: {
  params: Promise<{ id: string; dossierId: string }>;
}) {
  const { id, dossierId } = await params;
  if (!estIdentifiant(dossierId)) notFound();
  const t = await obtenirT();
  const { utilisateur } = await exigerPermission("dd.lire");
  const mission = await chargerMission(id);
  if (!mission.ok) return null;
  const droits = droitsIngestionDd(utilisateur.roles, mission.donnees);
  const api = apiIngestionDd(dossierId);
  const r = await chargerServeur<PageDocumentsIngestion>(
    avecRequete(cheminListe(api), { limite: 30 }),
  );
  if (!r.ok && r.statut === 404) notFound();
  if (!r.ok) {
    return (
      <EtatErreur
        titre={t(
          "Les documents du dossier n'ont pas pu être chargés.",
          "The file documents could not be loaded.",
        )}
        message={r.message}
        hrefReessayer={hrefDocumentsDd(id, dossierId)}
      />
    );
  }

  return (
    <div className="mp-dd-pile">
      {droits.televerser ? (
        <Carte titre={t("Importer un document", "Import a document")} niveauTitre={3}>
          <DocumentsTeleversement dossierId={dossierId} />
        </Carte>
      ) : (
        <Alerte tonalite="info" annonce="aucune">
          <p>
            {t(
              "Vous pouvez consulter les documents du dossier ; l'import est réservé aux membres autorisés à écrire dans la due diligence (et impossible une fois la mission clôturée).",
              "You can view the file documents; import is reserved for members allowed to write in due diligence (and not possible once the engagement is closed).",
            )}
          </p>
        </Alerte>
      )}
      <Carte titre={t("Documents importés", "Imported documents")} niveauTitre={3}>
        <DocumentsListe missionId={id} dossierId={dossierId} documents={r.donnees.elements} />
        {r.donnees.curseur_suivant ? (
          <p className="mp-texte-petit">
            {t(
              "Seuls les 30 documents les plus récents sont affichés.",
              "Only the 30 most recent documents are shown.",
            )}
          </p>
        ) : null}
      </Carte>
    </div>
  );
}
