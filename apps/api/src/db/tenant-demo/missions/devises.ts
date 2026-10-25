import { PARITE_EUR_FCFA } from "@missionpilot/engines";
import type { CleClient } from "../cles.js";
import { attendre, type SessionDemo } from "../contexte.js";
import { CLIENTS, type DeviseClient } from "../donnees-clients.js";
import { TAUX_VENTE_GRADE } from "../donnees-equipe.js";

/*
 * Devise des missions : celle du client (socle, donnees-clients.ts), qui est aussi la devise de
 * ses états financiers et de ses taux négociés. XOF et XAF sont à parité fixe avec le barème du
 * cabinet (XOF) : aucun taux n'est converti. Les montants du casting (débours, sous-traitance,
 * estimations), écrits en valeur de référence XOF, sont ramenés en unités MINEURES de la devise.
 */

/** 1 USD = 600 XOF : taux flottant FICTIF saisi à la signature des missions en dollars. */
export const TAUX_USD_XOF = 600;

export function deviseDuClient(client: CleClient): DeviseClient {
  const c = CLIENTS.find((x) => x.cle === client);
  if (!c) throw new Error(`Client « ${client} » absent des données du socle.`);
  return c.devise;
}

const estMineure = (devise: DeviseClient): boolean => devise === "EUR" || devise === "USD";

/**
 * Montant de référence (XOF) exprimé en UNITÉS MINEURES de la devise de la mission, comme les
 * schémas de l'API les attendent (`montantSchema`) : XOF et XAF, sans décimales, restent en unités ;
 * EUR et USD passent en centimes. `pas` arrondit la valeur en unités majeures (10 pour un montant,
 * 5 pour un taux journalier) avant le passage en centimes.
 */
export function versDevise(montantXof: number, devise: DeviseClient, pas = 10): number {
  if (!estMineure(devise)) return montantXof;
  const taux = devise === "EUR" ? PARITE_EUR_FCFA : TAUX_USD_XOF;
  return Math.round(montantXof / taux / pas) * pas * 100;
}

interface ChiffrageGrade {
  grade_code: string;
  taux_journalier: number | null;
}

/**
 * Taux de vente d'une proposition en unités mineures. XOF, XAF : seuls les taux manquants (pas de
 * taux négocié dans la devise du client) sont repris du barème du cabinet (XOF, parité fixe).
 * EUR, USD : tout taux absent est tiré du barème converti en centimes ; un taux présent mais écrit
 * en unités majeures (hors de l'ordre de grandeur du barème en centimes, mais plausible une fois
 * multiplié par 100) est rapporté en centimes. `detail` est la réponse de la route de génération.
 */
export async function completerTaux(
  session: SessionDemo,
  propositionId: string,
  detail: { chiffrage?: { taux_manquants?: string[]; par_grade?: ChiffrageGrade[] } },
  devise: DeviseClient,
): Promise<void> {
  const taux: Record<string, number> = {};
  const bareme = (code: string): number => {
    const base = TAUX_VENTE_GRADE[code];
    if (base === undefined) throw new Error(`Pas de taux de barème pour le grade « ${code} ».`);
    return versDevise(base, devise, 5);
  };
  for (const code of detail.chiffrage?.taux_manquants ?? []) taux[code] = bareme(code);
  if (estMineure(devise)) {
    const plausible = (valeur: number, attendu: number): boolean =>
      valeur >= attendu / 3 && valeur <= attendu * 3;
    for (const g of detail.chiffrage?.par_grade ?? []) {
      if (g.taux_journalier === null || g.taux_journalier === undefined) continue;
      const attendu = bareme(g.grade_code);
      if (plausible(g.taux_journalier, attendu)) continue;
      taux[g.grade_code] = plausible(g.taux_journalier * 100, attendu)
        ? g.taux_journalier * 100
        : attendu;
    }
  }
  if (Object.keys(taux).length === 0) return;
  attendre(
    200,
    await session.put(`/api/propositions/${propositionId}/taux`, { taux }),
    "taux de vente de la proposition",
  );
}
