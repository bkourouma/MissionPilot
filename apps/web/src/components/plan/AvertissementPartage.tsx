import { AVERTISSEMENT_PARTAGE } from "../../lib/plan-strategique";
import { Alerte } from "../ui/Alerte";

/**
 * Avertissement visible avant toute écriture sur un plan partagé : l'écriture retire le
 * partage au client (l'API le fait dans la même transaction, `plans/partage.ts`).
 */
export function AvertissementPartage({ partage }: { partage: boolean }) {
  if (!partage) return null;
  return (
    <Alerte tonalite="attention" titre="Cette modification retirera le partage" annonce="aucune">
      <p>{AVERTISSEMENT_PARTAGE}</p>
    </Alerte>
  );
}
