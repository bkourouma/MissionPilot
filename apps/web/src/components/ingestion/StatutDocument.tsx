"use client";

import { useLangue } from "../i18n/FournisseurLangue";
import { BadgeStatut } from "../ui/BadgeStatut";
import {
  documentEnCours,
  libelleStatutDocument,
  tonaliteStatutDocument,
  type DocumentIngestion,
} from "../../lib/ingestion";

/** Badge du statut d'un document ingéré ; le texte porte toujours le sens (jamais la couleur seule). */
export function StatutDocument({ statut }: { statut: DocumentIngestion["statut"] }) {
  const langue = useLangue();
  return (
    <BadgeStatut tonalite={tonaliteStatutDocument(statut)} sansIcone={documentEnCours({ statut })}>
      {libelleStatutDocument(statut, langue)}
    </BadgeStatut>
  );
}
