import {
  calculerImpactLevier,
  type BaseLevier,
  type CodeLevier,
  type ImpactLevier,
  type ParametresParLevier,
} from "@missionpilot/engines";
import type { RedImpactLevierVue, RedLevierSimulation } from "@missionpilot/shared";
import type { Db } from "../db/pool.js";
import { AppError } from "../errors.js";
import type { DossierRed } from "./acces.js";
import { calculerRatiosDossier, postesDuDernierEtat } from "./ratios.js";
import { vueImpactLevier } from "./vues.js";

/*
 * Bibliothèque de leviers (RED-14) : six leviers au catalogue FERMÉ du moteur (pas de table, pas de
 * formule éditable), dont l'impact type est calculé par une fonction pure. La BASE est le dernier
 * état accepté du dossier client, agrégé par la correspondance courante ; l'impact retenu est
 * conservé avec ses paramètres et la base utilisée dans l'action du plan (un instantané : relire
 * l'action ne recalcule pas). Un levier chiffre un ordre de grandeur, il ne dit pas quoi faire.
 */

/** Base du levier : postes du dernier état accepté (vide sans état : le moteur signale BASE_INCOMPLETE). */
export async function baseLevier(db: Db, dossier: DossierRed): Promise<BaseLevier> {
  const calcul = await calculerRatiosDossier(db, dossier);
  const p = postesDuDernierEtat(calcul);
  if (!p) return { devise: dossier.devise as BaseLevier["devise"], postes: {} };
  if (p.devise !== dossier.devise) {
    throw new AppError(
      409,
      "RED_DEVISE_ETAT_DIFFERENTE",
      "La devise du dernier état financier accepté diffère de celle du dossier : aucun impact n'est chiffré.",
    );
  }
  return { devise: p.devise, postes: p.postes };
}

/** Impact d'un levier (moteur), avec la base déjà chargée. */
export function impactLevier(
  levier: RedLevierSimulation,
  base: BaseLevier,
): { impact: RedImpactLevierVue; moteur: ImpactLevier } {
  const moteur = calculerImpactLevier(
    levier.code as CodeLevier,
    levier.parametres as unknown as ParametresParLevier[CodeLevier],
    base,
  );
  return { impact: vueImpactLevier(moteur), moteur };
}

/** Route 37 : simulation, aucune écriture, aucun journal. */
export async function simulerLevier(
  db: Db,
  dossier: DossierRed,
  levier: RedLevierSimulation,
): Promise<RedImpactLevierVue> {
  return impactLevier(levier, await baseLevier(db, dossier)).impact;
}
