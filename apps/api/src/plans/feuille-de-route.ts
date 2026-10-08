import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { conflit, requeteInvalide } from "../errors.js";
import { exigerPlanRedigeable } from "./acces.js";
import { elementsCourants, versionDatesRecalees, vueElement } from "./elements.js";
import { retirerPartageApresEcriture } from "./partage.js";
import { recalageInitiatives } from "./rapport.js";

/*
 * Application du recalage de la feuille de route (PLA-05).
 *
 * Les dates recalées sont CALCULÉES par le moteur (`recalerFeuilleDeRoute`) à
 * chaque lecture ; les appliquer crée, pour chaque initiative demandée, une
 * nouvelle version qui ne change que ses dates (statut « modifie », ou
 * « brouillon » tant que l'initiative n'a jamais été validée) : la validation
 * est à refaire, et le partage au client d'un plan partagé est retiré.
 *
 * L'utilisateur envoie les initiatives dont il a vu le décalage : si l'une
 * n'est plus à recaler (plan modifié entre-temps), rien n'est écrit (409).
 */

/** Dernière date admise par la base pour une initiative (0180). */
const DATE_MAX = "2100-12-31";

export async function appliquerRecalage(db: Db, auth: Auth, planId: string, ids: string[]) {
  const plan = await exigerPlanRedigeable(db, auth, planId);
  const courantes = await elementsCourants(db, planId);
  const recalage = recalageInitiatives(courantes.map(vueElement));
  const parId = new Map(recalage.initiatives.map((r) => [r.id, r]));
  // Casse normalisée puis dédoublonnée : un identifiant écrit en majuscules et en minuscules
  // ne produit qu'UNE nouvelle version (le schéma de la route le refuse déjà, 400).
  const demandes = [...new Set(ids.map((id) => id.toLowerCase()))];
  for (const id of demandes) {
    if (!parId.get(id)?.recalee) {
      throw conflit("La feuille de route a changé : rechargez-la avant d'appliquer le recalage.");
    }
    if ((parId.get(id)?.echeance as string) > DATE_MAX) {
      throw requeteInvalide("Le recalage repousse une initiative au-delà de 2100.");
    }
  }
  const appliquees = [];
  for (const id of demandes) {
    const r = parId.get(id)!;
    const courante = courantes.find((v) => v.element_id === id)!;
    const version = await versionDatesRecalees(db, auth, courante, r.debut, r.echeance);
    await journaliser(db, {
      cabinetId: auth.cabinetId,
      utilisateurId: auth.utilisateurId,
      action: "plan.element.recaler",
      entite: "plan_element",
      entiteId: id,
      details: {
        plan_id: planId,
        version,
        decalage_jours: r.decalageJours,
        debut: r.debut,
        echeance: r.echeance,
        contrainte_par: r.contraintePar,
      },
    });
    appliquees.push({
      id,
      version,
      decalage_jours: r.decalageJours,
      debut: r.debut,
      echeance: r.echeance,
    });
  }
  await retirerPartageApresEcriture(db, auth, plan, "feuille_de_route.recaler");
  return { plan_id: planId, appliquees };
}
