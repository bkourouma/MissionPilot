"use client";

import { useRafraichir } from "../formulaires/useRafraichir";
import { useState } from "react";
import { TYPES_DOCUMENT_DD } from "@missionpilot/shared";
import { useT } from "../i18n/FournisseurLangue";
import { Alerte } from "../ui/Alerte";
import { Select } from "../ui/Select";
import { TeleversementDocument } from "../ingestion/TeleversementDocument";
import { cheminTeleversementDd } from "../../lib/ingestion";

type TypeDocumentDd = (typeof TYPES_DOCUMENT_DD)[number];

/**
 * Téléversement d'un rapport (DD-02) ou d'un document de la salle de données (DD-10) vers le
 * dossier. Le document est lu en arrière-plan, puis l'IA en propose une lecture en brouillon ; rien
 * n'est repris dans le dossier avant validation.
 */
export function DocumentsTeleversement({ dossierId }: { dossierId: string }) {
  const t = useT();
  const { rafraichir } = useRafraichir();
  const [type, setType] = useState<TypeDocumentDd>("rapport");
  const optionsType: readonly { valeur: TypeDocumentDd; libelle: string }[] = [
    {
      valeur: "rapport",
      libelle: t(
        "Rapport (audit, étude, rapport d'expert)",
        "Report (audit, study, expert report)",
      ),
    },
    { valeur: "salle", libelle: t("Document de la salle de données", "Data room document") },
  ];
  return (
    <div className="mp-dd-pile">
      <Alerte
        tonalite="info"
        titre={t("L'IA propose, l'expert dispose", "AI proposes, the expert decides")}
        annonce="aucune"
      >
        <p>
          {t(
            "Le document est lu en arrière-plan : l'IA en propose un résumé et des éléments sourcés (page et extrait recopié) en brouillon. Rien n'est repris dans les analyses, verdicts ou preuves tant qu'un valideur ne l'a pas validé.",
            "The document is read in the background: the AI proposes a summary and sourced items (page and copied excerpt) as a draft. Nothing is carried into the analyses, verdicts or evidence until an approver has approved it.",
          )}
        </p>
      </Alerte>
      <TeleversementDocument
        chemin={cheminTeleversementDd(dossierId)}
        requete={{ type }}
        libelleBouton={t("Importer et faire lire le document", "Import and have the document read")}
        onCree={() => rafraichir()}
      >
        <Select
          libelle={t("Type de document", "Document type")}
          value={type}
          options={optionsType}
          onChange={(e) => setType(e.target.value as TypeDocumentDd)}
        />
      </TeleversementDocument>
    </div>
  );
}
