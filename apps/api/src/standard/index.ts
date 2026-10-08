/**
 * API publique du référentiel de méthodes (lot STD) pour les autres modules
 * de l'API (agents, qualité, preuves, dossier client…).
 *
 * - `methodeEffectiveMission(db, missionId)` : méthode effective d'une mission
 *   (version figée → règles de modulation sur le contexte de la mission →
 *   dérogations approuvées), ou `null` si aucune méthode n'est liée. Chaque
 *   brique porte sa classe de risque EFFECTIVE (jamais abaissée), la garde
 *   requise (moteur `qualite`), son niveau d'autonomie maximal, son moteur et
 *   l'agent autorisé.
 * - `briqueEffectiveMission(db, missionId, code)` : une brique par code.
 *
 * Ces fonctions NE vérifient PAS la visibilité de la mission : l'appelant
 * appelle d'abord `exigerMissionVisible` (missions/acces.ts) dans la même
 * transaction `withTenant`. Elles lisent sous RLS (standard + cabinet).
 */
export { briqueEffectiveMission, methodeEffectiveMission } from "./missions.js";
export type { BriqueEffective, MethodeEffective } from "./resolution.js";
