"use client";

import Link from "next/link";
import { useRafraichir } from "../formulaires/useRafraichir";
import { useT } from "../i18n/FournisseurLangue";
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
  const t = useT();
  const { rafraichir } = useRafraichir();
  return (
    <div className="mp-pile">
      <Alerte
        tonalite="info"
        titre={t("L'IA propose, l'expert dispose", "AI proposes, the expert decides")}
        annonce="aucune"
      >
        <p>
          {t(
            "Le document est lu en arrière-plan : l'IA en tire une proposition d'étapes, de briques, d'éléments et de rubriques. Rien n'est appliqué ni publié tant que vous n'avez pas validé la proposition ; la validation l'ajoute au brouillon de la méthode, jamais à une version publiée.",
            "The document is read in the background: the AI draws a proposal of steps, building blocks, elements and rubrics from it. Nothing is applied or published until you approve the proposal; approval adds it to the method's draft, never to a published version.",
          )}
        </p>
      </Alerte>
      <TeleversementDocument
        chemin={cheminTeleversementAmorcage(versionId)}
        libelleBouton={t("Importer et faire lire le document", "Import and have the document read")}
        onCree={() => rafraichir()}
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
  const t = useT();
  const { rafraichir } = useRafraichir();
  return (
    <ListeDocumentsIngestion
      api={apiIngestionStandard(versionId)}
      documentsInitiaux={documents}
      legende={t("Documents historiques de l'amorçage", "Historical documents for bootstrapping")}
      messageVide={t(
        "Aucun document importé pour cette version.",
        "No document imported for this version.",
      )}
      hrefDocument={(d) => hrefDocumentAmorcage(versionId, d.id)}
      rendreLien={(href, libelle) => <Link href={href}>{libelle}</Link>}
      onTermine={() => rafraichir()}
    />
  );
}
