import { chargerServeur } from "./api-serveur";
import type { PaiementFacture } from "./encaissements";
import type { Facture } from "./factures";

/**
 * Situations de paiement (statut dérivé par l'API) des factures émises d'une page de liste.
 * Une situation indisponible est simplement omise : la liste reste affichée.
 */
export async function chargerPaiements(
  factures: readonly Pick<Facture, "id" | "nature" | "statut">[],
): Promise<Map<string, PaiementFacture>> {
  const emises = factures.filter((f) => f.nature === "facture" && f.statut === "emise");
  const reponses = await Promise.all(
    emises.map((f) => chargerServeur<PaiementFacture>(`/api/factures/${f.id}/paiement`)),
  );
  const parFacture = new Map<string, PaiementFacture>();
  for (const r of reponses) if (r.ok) parFacture.set(r.donnees.facture_id, r.donnees);
  return parFacture;
}
