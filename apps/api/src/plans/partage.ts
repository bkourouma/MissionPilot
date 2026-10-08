import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import type { PlanAcces } from "./acces.js";

/*
 * Partage au client d'un plan stratégique (SOC-06, « l'IA propose, l'expert
 * dispose ») : le partage n'est accordé que sur un contenu entièrement validé
 * (déclencheur 0181) ; il ne doit pas SURVIVRE à une écriture qui produit un
 * contenu non validé. Toute création d'élément, version brouillon ou modifiée
 * (retrait et recalage des dates compris), version du modèle financier et
 * changement du lien du diagnostic vers une notation appelle donc
 * `retirerPartageApresEcriture` dans sa transaction, plan verrouillé
 * (exigerPlanRedigeable).
 */

export type CauseRetraitPartage =
  | "element.creer"
  | "element.version"
  | "modele.calculer"
  | "feuille_de_route.recaler"
  | "diagnostic.notation";

/** Retire le partage du plan s'il était partagé (journalisé `plan.retirer_partage`). */
export async function retirerPartageApresEcriture(
  db: Db,
  auth: Auth,
  plan: PlanAcces,
  cause: CauseRetraitPartage,
): Promise<boolean> {
  if (!plan.partage_client) return false;
  await db.query(
    `UPDATE plans_strategiques SET partage_client = false, partage_par = NULL, partage_le = NULL
     WHERE id = $1`,
    [plan.id],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "plan.retirer_partage",
    entite: "plan_strategique",
    entiteId: plan.id,
    details: { automatique: true, cause },
  });
  return true;
}
