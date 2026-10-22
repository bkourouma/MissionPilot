"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ListeDocumentsIngestion } from "../ingestion/ListeDocumentsIngestion";
import { apiIngestionDd, hrefDocumentDd, type DocumentIngestion } from "../../lib/ingestion";

/**
 * Documents d'un dossier de due diligence : type, statut, résultat, pages, auteur et date. La liste
 * se rafraîchit toute seule tant qu'un document est en cours de lecture.
 */
export function DocumentsListe({
  missionId,
  dossierId,
  documents,
}: {
  missionId: string;
  dossierId: string;
  documents: readonly DocumentIngestion[];
}) {
  const router = useRouter();
  return (
    <ListeDocumentsIngestion
      api={apiIngestionDd(dossierId)}
      documentsInitiaux={documents}
      afficherUsage
      legende="Documents du dossier de due diligence"
      messageVide="Aucun document importé pour ce dossier."
      hrefDocument={(d) => hrefDocumentDd(missionId, dossierId, d.id)}
      rendreLien={(href, libelle) => <Link href={href}>{libelle}</Link>}
      onTermine={() => router.refresh()}
    />
  );
}
