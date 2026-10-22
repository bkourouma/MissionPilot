"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alerte } from "../ui/Alerte";
import { ListeDocumentsIngestion } from "../ingestion/ListeDocumentsIngestion";
import { TeleversementDocument } from "../ingestion/TeleversementDocument";
import {
  apiIngestionStandard,
  cheminTeleversementAmorcage,
  hrefDocumentAmorcage,
  type DocumentIngestion,
} from "../../lib/ingestion";

/**
 * Téléversement de documents historiques (propositions, rapports) vers le BROUILLON d'une méthode
 * (STD-13). L'IA en propose étapes, briques, éléments et rubriques ; rien n'est appliqué ni publié
 * avant la validation d'un expert.
 */
export function AmorcageTeleversement({ versionId }: { versionId: string }) {
  const router = useRouter();
  return (
    <div className="mp-pile">
      <Alerte tonalite="info" titre="L'IA propose, l'expert dispose" annonce="aucune">
        <p>
          Le document est lu en arrière-plan : l&apos;IA en tire une proposition d&apos;étapes, de
          briques, d&apos;éléments et de rubriques. Rien n&apos;est appliqué ni publié tant que vous
          n&apos;avez pas validé la proposition ; la validation l&apos;ajoute au brouillon de la
          méthode, jamais à une version publiée.
        </p>
      </Alerte>
      <TeleversementDocument
        chemin={cheminTeleversementAmorcage(versionId)}
        libelleBouton="Importer et faire lire le document"
        onCree={() => router.refresh()}
      />
    </div>
  );
}

/** Documents d'amorçage d'une version : statut, résultat, pages ; rafraîchie pendant la lecture. */
export function AmorcageListe({
  versionId,
  documents,
}: {
  versionId: string;
  documents: readonly DocumentIngestion[];
}) {
  const router = useRouter();
  return (
    <ListeDocumentsIngestion
      api={apiIngestionStandard(versionId)}
      documentsInitiaux={documents}
      legende="Documents historiques de l'amorçage"
      messageVide="Aucun document importé pour cette version."
      hrefDocument={(d) => hrefDocumentAmorcage(versionId, d.id)}
      rendreLien={(href, libelle) => <Link href={href}>{libelle}</Link>}
      onTermine={() => router.refresh()}
    />
  );
}
