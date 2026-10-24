/*
 * Clés STABLES des comptes, collaborateurs et clients du cabinet « Tenant démo ».
 *
 * CONTRAT : ces clés indexent `ctx.sessions`, `ctx.utilisateurs`, `ctx.collaborateurs`,
 * `ctx.clients` et `ctx.dossiers` (contexte.ts). Les lots de domaine peuvent s'y fier ; seuls
 * les fichiers de données du socle (`donnees-*.ts`) les décrivent (nom, grade, coût…).
 * Ajouter une clé est permis (en fin de liste), jamais en renommer ou retirer une.
 *
 * Les clés de comptes reprennent la partie locale de l'adresse (`<clé>@tenant-demo.test`) et,
 * pour le premier compte de chaque rôle, la même clé que dans seed-demo.ts (`associe`,
 * `directeur.mission`, `chef.mission`, `consultant`, `consultant.junior`, `ressources`,
 * `gestionnaire`, `expert.metier`, `expert.externe`) : les fonctions de seed-demo.ts qui
 * attendent ces clés (`construireMission`, `signerEtDemarrer`) sont donc réutilisables.
 */

/** Comptes du CABINET (utilisateurs internes), 2 au moins par rôle de `ROLES`. */
export const CLES_COMPTES_CABINET = [
  "associe",
  "associe.2",
  "directeur.mission",
  "directeur.mission.2",
  "chef.mission",
  "chef.mission.2",
  "consultant",
  "consultant.2",
  "consultant.junior",
  "consultant.junior.2",
  "consultant.stagiaire",
  "ressources",
  "ressources.2",
  "gestionnaire",
  "gestionnaire.2",
  "expert.metier",
  "expert.metier.2",
  "expert.externe",
  "expert.externe.2",
] as const;
export type CleCompteCabinet = (typeof CLES_COMPTES_CABINET)[number];

/** Comptes du PORTAIL client (rôles de `ROLES_CLIENT`, 2 par rôle, rattachés à un client). */
export const CLES_COMPTES_PORTAIL = [
  "dirigeant.client",
  "dirigeant.client.2",
  "contributeur.client",
  "contributeur.client.2",
  "investisseur.client",
  "investisseur.client.2",
] as const;
export type CleComptePortail = (typeof CLES_COMPTES_PORTAIL)[number];

export type CleCompte = CleCompteCabinet | CleComptePortail;

/**
 * Collaborateurs sans compte utilisateur. Un collaborateur rattaché à un compte porte la clé de
 * ce compte (`ressources` et `gestionnaire`, fonctions support, n'en ont pas).
 */
export const CLES_COLLABORATEURS_SANS_COMPTE = [
  /** Sous-traitant (analyse de données). */
  "st.data",
  /** Sous-traitant (cabinet juridique partenaire). */
  "st.juridique",
  /** Expert externe indépendant (finance), sans accès à l'application. */
  "ext.finance",
  /** Ancien consultant, parti en 2025 : collaborateur INACTIF. */
  "ex.consultant",
  /** Stagiaire sans compte. */
  "stagiaire.2",
  /** Consultant junior à temps partiel (capacité 60 %). */
  "junior.temps.partiel",
] as const;
export type CleCollaborateurSansCompte = (typeof CLES_COLLABORATEURS_SANS_COMPTE)[number];

/** Clés de TOUS les collaborateurs (comptes du cabinet ayant un grade + collaborateurs sans compte). */
export type CleCollaborateur =
  | Exclude<CleCompteCabinet, "ressources" | "ressources.2" | "gestionnaire" | "gestionnaire.2">
  | CleCollaborateurSansCompte;

/**
 * Clients (= dossiers client : l'identifiant du dossier est celui du client). Deux groupes :
 * « sicafe » (holding + 2 filiales) et « brasseries-wouri » (holding + 1 filiale).
 */
export const CLES_CLIENTS = [
  "sicafe",
  "sicafe-transformation",
  "sicafe-export",
  "brasseries-wouri",
  "wouri-distribution",
  "banque-sahel",
  "teranga-logistique",
  "baobab-assurances",
  "mboa-solaire",
  "sahel-coton",
  "atlantique-retail",
  "gabon-offshore",
] as const;
export type CleClient = (typeof CLES_CLIENTS)[number];
