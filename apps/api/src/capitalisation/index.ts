/**
 * API publique du lot capitalisation (CAP, PRD complémentaire §12) pour les autres modules.
 *
 * - `ouvrirRetourExperience(db, auth, missionId)` : ouvre (ou rend) le retour d'expérience d'une
 *   mission « à clôturer » ou « clôturée », brouillon construit par gabarit déterministe depuis
 *   les données de la mission. À appeler par la clôture (AUT-08) ou l'automatisation, dans leur
 *   transaction `withTenant` ; vérifie la visibilité de la mission (404) et son état (409
 *   `MISSION_NON_CLOTUREE`) ; la permission de l'action reste à la charge de l'appelant.
 * - `estimationParBrique(db, demande)` : temps réels par brique et par contexte (médiane,
 *   quartiles, effectif ; rien sous l'effectif minimum) pour l'estimation des propositions
 *   (MIS-06) ; agrégats du cabinet courant, sans donnée nominative.
 * - `actualiserPreuvesCompetences(db, missionId)` : relève les preuves d'usage des compétences
 *   (temps sur les briques, livrables rédigés ou relus) ; n'attribue aucun niveau.
 *
 * Les erreurs SQL du domaine (MPJ…) se traduisent par `traduireErreurCapitalisation`.
 */
export { ouvrirRetourExperience } from "./retours.js";
export { estimationParBrique } from "./estimation.js";
export { actualiserPreuvesCompetences } from "./competences.js";
export { traduireErreurCapitalisation } from "./erreurs.js";
