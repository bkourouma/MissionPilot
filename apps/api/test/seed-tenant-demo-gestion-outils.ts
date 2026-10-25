/*
 * Données de test de la phase « gestion » du Tenant démo (seed-tenant-demo-gestion.test.ts) :
 * tables attendues non vides, tables dont le rejeu ne doit rien dupliquer, clients du portail et
 * requêtes de chronologie. Extraites du test pour tenir sous 400 lignes sans perdre d'assertion.
 */

/** Tables du périmètre de la phase, non vides à la fin de la chaîne. */
export const TABLES_NON_VIDES = [
  // Temps
  "feuilles_temps",
  "lignes_temps",
  "feuille_validations",
  "periodes_temps",
  "corrections_temps",
  "parametres_temps",
  "rappels_temps",
  "reste_a_faire",
  "alertes_suivi",
  "cabinet_feries",
  "taux_clients",
  // Facturation, encaissements, débours
  "echeances_facturation",
  "facturation_liens",
  "factures",
  "facture_lignes",
  "sequences_facturation",
  "encaissements",
  "imputations",
  "contre_passations",
  "relances_factures",
  "parametres_relances",
  "plan_comptable_cabinet",
  "plan_comptable_validation",
  "debours",
  // Rapports, clôture
  "rapports_mission",
  "rapports_parametres",
  "bilans_mission",
  "cloture_modele_items",
  "cloture_derogations",
  // Salle de mission
  "salle_demandes",
  "salle_modeles",
  "salle_pieces",
  "salle_relances",
  "salle_depots",
  "salle_piece_evenements",
  "salle_accuses",
  // Ingestion
  "ingestion_documents",
  "ingestion_pages",
  "ingestion_extractions",
  // Collaboration, portail, fichiers
  "commentaires",
  "commentaire_revisions",
  "commentaire_suppressions",
  "taches_collaboration",
  "fichiers_suppressions",
  "portail_clients",
  "portail_validations_jalons",
  "portail_partages",
  // Revues à froid (après la clôture)
  "qualite_froide_campagnes",
  "qualite_froide_echantillon",
  "qualite_froide_constats",
  "qualite_froide_evaluations",
  "qualite_froide_actions",
  "qualite_froide_actions_historique",
] as const;

/** Tables dont le nombre de lignes ne doit pas bouger au rejeu de la phase. */
export const TABLES_IDEMPOTENCE = [
  "feuilles_temps",
  "lignes_temps",
  "periodes_temps",
  "corrections_temps",
  "echeances_facturation",
  "factures",
  "encaissements",
  "debours",
  "relances_factures",
  "rapports_mission",
  "salle_demandes",
  "salle_depots",
  "ingestion_documents",
  "ingestion_extractions",
  "commentaires",
  "taches_collaboration",
  "portail_validations_jalons",
  "portail_partages",
  "qualite_suivis",
  "qualite_froide_campagnes",
  "utilisateurs",
  "missions",
] as const;

/** Clients dont le dirigeant du portail doit voir des factures (motif LIKE sur la raison sociale). */
export const CLIENTS_PORTAIL_ATTENDUS = [
  "Société Ivoirienne de Café%",
  "Sahel Coton%",
  "Brasseries du Wouri%",
  "Mboa%",
  "Atlantique Retail%",
  "Baobab%",
] as const;

/** Chaque requête compte les lignes fautives (action datée après `cloturee_le` d'une mission clôturée). */
export const REQUETES_CHRONOLOGIE: Record<string, string> = {
  cloture_verifications:
    "SELECT count(*) AS n FROM cloture_verifications x JOIN missions m ON m.id = x.mission_id WHERE m.cabinet_id = $1 AND m.statut = 'cloturee' AND x.verifie_le > m.cloturee_le",
  salle_demandes:
    "SELECT count(*) AS n FROM salle_demandes x JOIN missions m ON m.id = x.mission_id WHERE m.cabinet_id = $1 AND m.statut = 'cloturee' AND (x.envoyee_le > m.cloturee_le OR x.close_le > m.cloturee_le)",
  salle_depots:
    "SELECT count(*) AS n FROM salle_depots x JOIN salle_demandes d ON d.id = x.demande_id JOIN missions m ON m.id = d.mission_id WHERE m.cabinet_id = $1 AND m.statut = 'cloturee' AND x.depose_le > m.cloturee_le",
  corrections_temps:
    "SELECT count(*) AS n FROM corrections_temps x JOIN missions m ON m.id = x.mission_id WHERE m.cabinet_id = $1 AND m.statut = 'cloturee' AND (x.demandee_le > m.cloturee_le OR x.decidee_le > m.cloturee_le)",
  facturation_liens:
    "SELECT count(*) AS n FROM facturation_liens x JOIN missions m ON m.id = x.mission_id WHERE m.cabinet_id = $1 AND m.statut = 'cloturee' AND x.libere_le > m.cloturee_le",
  alertes_suivi:
    "SELECT count(*) AS n FROM alertes_suivi x JOIN missions m ON m.id = x.mission_id WHERE m.cabinet_id = $1 AND m.statut = 'cloturee' AND x.levee_le > m.cloturee_le",
  assertion_versions:
    "SELECT count(*) AS n FROM assertion_versions x JOIN assertions a ON a.id = x.assertion_id JOIN missions m ON m.id = a.mission_id WHERE m.cabinet_id = $1 AND m.statut = 'cloturee' AND x.signe_le > m.cloturee_le AND x.cree_le < m.cloturee_le",
  ia_demandes:
    "SELECT count(*) AS n FROM ia_demandes x JOIN missions m ON m.id = x.mission_id WHERE m.cabinet_id = $1 AND m.statut = 'cloturee' AND x.termine_le > m.cloturee_le AND x.cree_le < m.cloturee_le",
  signatures_demandes:
    "SELECT count(*) AS n FROM signatures_demandes x JOIN missions m ON m.id = x.mission_id WHERE m.cabinet_id = $1 AND m.statut = 'cloturee' AND (x.cree_le > m.cloturee_le OR x.envoyee_le > m.cloturee_le OR x.termine_le > m.cloturee_le)",
  signatures_signataires:
    "SELECT count(*) AS n FROM signatures_signataires x JOIN signatures_demandes d ON d.id = x.demande_id JOIN missions m ON m.id = d.mission_id WHERE m.cabinet_id = $1 AND m.statut = 'cloturee' AND (x.invite_le > m.cloturee_le OR x.decide_le > m.cloturee_le)",
};
