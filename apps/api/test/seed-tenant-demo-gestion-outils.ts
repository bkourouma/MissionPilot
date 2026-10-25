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

/**
 * Cohérence des missions CLÔTURÉES (reste à faire, alertes, suivi des KPI, documents). Chaque requête
 * compte les lignes fautives (paramètre $1 = cabinet) ; le résultat attendu est 0.
 */
export const REQUETES_COHERENCE_CLOTURE: Record<string, string> = {
  // Une tâche sans relevé de reste à faire verrait son reste ESTIMÉ à partir du budget non consommé.
  taches_sans_reste_declare:
    "SELECT count(*) AS n FROM mission_taches t JOIN missions m ON m.id = t.mission_id WHERE m.cabinet_id = $1 AND m.statut = 'cloturee' AND NOT EXISTS (SELECT 1 FROM reste_a_faire r WHERE r.tache_id = t.id)",
  // Dernière déclaration de chaque couple (tâche, collaborateur) : toutes nulles à la clôture.
  reste_a_faire_non_nul:
    "SELECT count(*) AS n FROM (SELECT DISTINCT ON (r.tache_id, r.collaborateur_id) r.centiemes FROM reste_a_faire r JOIN missions m ON m.id = r.mission_id WHERE m.cabinet_id = $1 AND m.statut = 'cloturee' ORDER BY r.tache_id, r.collaborateur_id, r.ordre DESC) d WHERE d.centiemes > 0",
  alertes_consommation_actives:
    "SELECT count(*) AS n FROM alertes_suivi a JOIN missions m ON m.id = a.mission_id WHERE m.cabinet_id = $1 AND m.statut = 'cloturee' AND a.active AND a.type = 'consommation_seuil'",
  // Suivi des KPI terminé dans la période de la mission (ni actif, ni début ou fin après la clôture).
  kpi_actifs:
    "SELECT count(*) AS n FROM kpi_definitions d JOIN missions m ON m.id = d.mission_id WHERE d.cabinet_id = $1 AND m.statut = 'cloturee' AND d.actif",
  kpi_suivi_hors_periode:
    "SELECT count(*) AS n FROM kpi_definitions d JOIN missions m ON m.id = d.mission_id WHERE d.cabinet_id = $1 AND m.statut = 'cloturee' AND (d.fin_suivi IS NULL OR d.fin_suivi > m.cloturee_le::date OR d.debut_suivi > m.cloturee_le::date)",
  kpi_mesures_apres_cloture:
    "SELECT count(*) AS n FROM kpi_mesures x JOIN kpi_definitions d ON d.id = x.kpi_id JOIN missions m ON m.id = d.mission_id WHERE d.cabinet_id = $1 AND m.statut = 'cloturee' AND (x.date_mesure > m.cloturee_le::date OR x.saisie_le > m.cloturee_le)",
  kpi_instants_apres_cloture:
    "SELECT count(*) AS n FROM kpi_definitions d JOIN missions m ON m.id = d.mission_id WHERE d.cabinet_id = $1 AND m.statut = 'cloturee' AND (d.cree_le > m.cloturee_le OR d.modifie_le > m.cloturee_le)",
  // Tout document partagé au portail porte un fichier réellement servi (sinon « Fichier pas encore disponible »).
  documents_partages_sans_fichier:
    "SELECT count(*) AS n FROM portail_partages p JOIN mission_documents d ON d.id = p.document_id WHERE p.cabinet_id = $1 AND d.fichier_id IS NULL",
  documents_apres_cloture:
    "SELECT count(*) AS n FROM mission_documents d JOIN missions m ON m.id = d.mission_id WHERE d.cabinet_id = $1 AND m.statut = 'cloturee' AND d.cree_le > m.cloturee_le",
};
