"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ListeDocumentsIngestion } from "../ingestion/ListeDocumentsIngestion";
import {
  apiIngestionDossier,
  hrefDocumentEtat,
  hrefEtatFinancier,
  type DocumentIngestion,
} from "../../lib/ingestion";

/**
 * Documents d'états financiers importés (DOS-03) : suivi de la lecture en arrière-plan, liens
 * vers le détail du document et vers l'état créé. La page se rafraîchit quand la lecture se termine
 * pour que le tableau des états montre le nouvel état.
 */
export function ImportEtatDocumentListe({
  clientId,
  documents,
}: {
  clientId: string;
  documents: readonly DocumentIngestion[];
}) {
  const router = useRouter();
  return (
    <ListeDocumentsIngestion
      api={apiIngestionDossier(clientId)}
      documentsInitiaux={documents}
      legende="Documents d'états financiers importés"
      messageVide="Aucun document importé pour ce client."
      hrefDocument={(d) => hrefDocumentEtat(clientId, d.id)}
      hrefResultat={(d) =>
        d.etat_financier_id
          ? { href: hrefEtatFinancier(clientId, d.etat_financier_id), libelle: "Voir l'état" }
          : null
      }
      rendreLien={(href, libelle) => <Link href={href}>{libelle}</Link>}
      onTermine={() => router.refresh()}
    />
  );
}
