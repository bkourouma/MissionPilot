/*
 * Constantes du cabinet « Tenant démo » (seed de démonstration à historique long).
 *
 * CONTRAT STABLE : ces noms sont importés par tous les lots de domaine. Ne pas les renommer.
 * Le cabinet existe AU CÔTÉ de « Lagune Conseil & Associés (démo) » (seed-demo.ts) : aucun
 * domaine, aucune adresse ni aucun identifiant n'est partagé avec lui.
 */

/** Nom EXACT du cabinet (`cabinets.nom`) : c'est aussi le garde-fou du drapeau `est_demo`. */
export const NOM_CABINET_TENANT_DEMO = "Tenant démo";

/** Domaine réservé (`.test`) : aucune adresse du seed ne reçoit de courrier. */
export const DOMAINE_TENANT_DEMO = "tenant-demo.test";

/** Mot de passe de TOUS les comptes du cabinet et du portail (démonstration seulement). */
export const MOT_DE_PASSE_DEMO_TENANT = "Demo-Tenant-2026";

/** Adresse d'un compte de démonstration à partir de sa clé (`emailTenant("associe")`). */
export const emailTenant = (cle: string): string => `${cle}@${DOMAINE_TENANT_DEMO}`;

/** Adresse du compte FONDATEUR (associé) : ancre de l'idempotence, résolue par `trouver_connexion`. */
export const EMAIL_FONDATEUR_TENANT = emailTenant("associe");

/** Début de l'activité fictive du cabinet (le cabinet « existe depuis plus de 2 ans »). */
export const DEBUT_ACTIVITE = "2024-10-01";

/** « Aujourd'hui » du jeu de données (horloge fictive, fixe : données reproductibles). */
export const AUJOURDHUI = "2026-10-24";

/** Graine du générateur pseudo-aléatoire (chaque phase en dérive un flux indépendant). */
export const GRAINE_TENANT_DEMO = 20241001;

/** Action du journal d'audit qui marque une phase du seed comme exécutée (idempotence). */
export const ACTION_MARQUEUR_PHASE = "semis_tenant_demo";
