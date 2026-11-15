"use client";

import Link from "next/link";
import { useRafraichir } from "../formulaires/useRafraichir";
import { useT } from "../i18n/FournisseurLangue";
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
  const { rafraichir } = useRafraichir();
  const t = useT();
  return (
    <ListeDocumentsIngestion
      api={apiIngestionDossier(clientId)}
      documentsInitiaux={documents}
      legende={t("Documents d'états financiers importés", "Imported financial statement documents")}
      messageVide={t(
        "Aucun document importé pour ce client.",
        "No documents imported for this client.",
      )}
      hrefDocument={(d) => hrefDocumentEtat(clientId, d.id)}
      hrefResultat={(d) =>
        d.etat_financier_id
          ? {
              href: hrefEtatFinancier(clientId, d.etat_financier_id),
              libelle: t("Voir l'état", "View the statement"),
            }
          : null
      }
      rendreLien={(href, libelle) => <Link href={href}>{libelle}</Link>}
      onTermine={() => rafraichir()}
    />
  );
}
