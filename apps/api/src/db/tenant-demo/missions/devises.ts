import { PARITE_EUR_FCFA } from "@missionpilot/engines";
import type { CleClient } from "../cles.js";
import { attendre, type SessionDemo } from "../contexte.js";
import { CLIENTS, type DeviseClient } from "../donnees-clients.js";
import { TAUX_VENTE_GRADE } from "../donnees-equipe.js";

/*
 * Devise des missions : celle du client (socle, donnees-clients.ts), qui est aussi la devise de
 * ses états financiers et de ses taux négociés. XOF et XAF sont à parité fixe avec le barème du
 * cabinet (XOF) : aucun taux n'est converti. Seuls les montants de débours et de sous-traitance,
 * écrits en valeur de référence XOF dans le casting, sont ramenés en EUR ou en USD.
 */

/** 1 USD = 600 XOF : taux flottant FICTIF saisi à la signature des missions en dollars. */
export const TAUX_USD_XOF = 600;

export function deviseDuClient(client: CleClient): DeviseClient {
  const c = CLIENTS.find((x) => x.cle === client);
  if (!c) throw new Error(`Client « ${client} » absent des données du socle.`);
  return c.devise;
}

/** Montant de référence (XOF) exprimé dans la devise de la mission, arrondi à la dizaine. */
export function versDevise(montantXof: number, devise: DeviseClient): number {
  if (devise === "XOF" || devise === "XAF") return montantXof;
  const taux = devise === "EUR" ? PARITE_EUR_FCFA : TAUX_USD_XOF;
  return Math.round(montantXof / taux / 10) * 10;
}

/**
 * Taux de vente manquants d'une proposition (pas de taux négocié pour ce grade dans la devise du
 * client) : repris du barème du cabinet (XOF), sans conversion pour le XAF (parité fixe), ramenés à
 * la devise pour l'EUR et l'USD. `detail` est la réponse de la route de génération.
 */
export async function completerTaux(
  session: SessionDemo,
  propositionId: string,
  detail: { chiffrage?: { taux_manquants?: string[] } },
  devise: DeviseClient,
): Promise<void> {
  const manquants = detail.chiffrage?.taux_manquants ?? [];
  if (manquants.length === 0) return;
  const taux = Object.fromEntries(
    manquants.map((code) => {
      const base = TAUX_VENTE_GRADE[code];
      if (base === undefined) throw new Error(`Pas de taux de barème pour le grade « ${code} ».`);
      return [code, versDevise(base, devise)];
    }),
  );
  attendre(
    200,
    await session.put(`/api/propositions/${propositionId}/taux`, { taux }),
    "taux manquants",
  );
}
