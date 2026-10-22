/**
 * Gestion du portail client PAR LE CABINET (SOC-09) : utilisateurs et invitations du portail
 * d'un client, partages explicites (RIEN n'est partagé par défaut), contact principal et
 * politique de double authentification du portail. Logique pure, testée dans
 * `portail-gestion.test.ts`. Les règles reproduisent `apps/api/src/routes/portail-gestion.ts`
 * pour n'afficher que ce qui sera accepté ; l'API reste seule juge.
 *
 * Sous-modules : `portail-gestion-types`, `-acces`, `-partages` et `-resume`.
 */
export * from "./portail-gestion-types";
export * from "./portail-gestion-acces";
export * from "./portail-gestion-partages";
export * from "./portail-gestion-resume";
