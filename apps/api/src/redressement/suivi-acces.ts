import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { interdit } from "../errors.js";
import {
  exigerDossierRedVisible,
  peutEcrireDansDossier,
  verrouillerDossierRed,
  type AccesDossierRed,
} from "./acces.js";

/*
 * Accès en ÉCRITURE au suivi post-mission (RED-09). Mêmes règles d'équipe que
 * `exigerDossierRedEcriture` (acces.ts, règle 2) : dossier visible (404 sinon), puis directeur,
 * chef, `mission.modifier_toutes` ou membre de l'équipe (403 sinon) ; le verrou consultatif du
 * dossier est pris en tout premier. EXCEPTION : le suivi suit la clôture, donc ni « dossier non
 * clos » ni « mission non clôturée » ne sont exigés ici ; c'est au contraire un dossier CLOS qui
 * est requis, ce que contrôle le service (409 RED_DOSSIER_NON_CLOS) et la base (MPZ19). La lecture
 * passe par `exigerDossierRedVisible` (droit `redressement.lire`).
 */
export async function exigerDossierSuiviEcriture(
  db: Db,
  auth: Auth,
  id: string,
): Promise<AccesDossierRed> {
  await verrouillerDossierRed(db, id);
  const acces = await exigerDossierRedVisible(db, auth, id);
  if (!(await peutEcrireDansDossier(db, auth, acces.mission))) throw interdit();
  return acces;
}
