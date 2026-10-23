"use client";

import { useRafraichir } from "../formulaires/useRafraichir";
import { useState } from "react";
import { TYPES_DOCUMENT_DD } from "@missionpilot/shared";
import { Alerte } from "../ui/Alerte";
import { Select } from "../ui/Select";
import { TeleversementDocument } from "../ingestion/TeleversementDocument";
import { cheminTeleversementDd } from "../../lib/ingestion";

type TypeDocumentDd = (typeof TYPES_DOCUMENT_DD)[number];

const OPTIONS_TYPE: readonly { valeur: TypeDocumentDd; libelle: string }[] = [
  { valeur: "rapport", libelle: "Rapport (audit, étude, rapport d'expert)" },
  { valeur: "salle", libelle: "Document de la salle de données" },
];

/**
 * Téléversement d'un rapport (DD-02) ou d'un document de la salle de données (DD-10) vers le
 * dossier. Le document est lu en arrière-plan, puis l'IA en propose une lecture en brouillon ; rien
 * n'est repris dans le dossier avant validation.
 */
export function DocumentsTeleversement({ dossierId }: { dossierId: string }) {
  const { rafraichir } = useRafraichir();
  const [type, setType] = useState<TypeDocumentDd>("rapport");
  return (
    <div className="mp-dd-pile">
      <Alerte tonalite="info" titre="L'IA propose, l'expert dispose" annonce="aucune">
        <p>
          Le document est lu en arrière-plan : l&apos;IA en propose un résumé et des éléments
          sourcés (page et extrait recopié) en brouillon. Rien n&apos;est repris dans les analyses,
          verdicts ou preuves tant qu&apos;un valideur ne l&apos;a pas validé.
        </p>
      </Alerte>
      <TeleversementDocument
        chemin={cheminTeleversementDd(dossierId)}
        requete={{ type }}
        libelleBouton="Importer et faire lire le document"
        onCree={() => rafraichir()}
      >
        <Select
          libelle="Type de document"
          value={type}
          options={OPTIONS_TYPE}
          onChange={(e) => setType(e.target.value as TypeDocumentDd)}
        />
      </TeleversementDocument>
    </div>
  );
}
