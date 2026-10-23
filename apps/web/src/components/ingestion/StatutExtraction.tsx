import { BadgeStatut } from "../ui/BadgeStatut";
import { libelleStatutExtraction, type ExtractionIngestion } from "../../lib/ingestion";
import { TONALITE_STATUT_EXTRACTION } from "../../lib/ingestion-extractions";

/** Statut d'un brouillon d'extraction : Brouillon IA, Modifié, Validé, Rejeté (toujours en toutes lettres). */
export function StatutExtraction({ statut }: { statut: ExtractionIngestion["statut"] }) {
  return (
    <BadgeStatut tonalite={TONALITE_STATUT_EXTRACTION[statut]}>
      {libelleStatutExtraction(statut)}
    </BadgeStatut>
  );
}
