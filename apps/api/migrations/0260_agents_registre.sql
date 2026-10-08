-- Agents IA : registre des agents (AGT-01, PRD complémentaire §7, ADR-005).
--
-- Lettre SQLSTATE du domaine : G (aGents). Codes :
--   MPG01 historique des agents en ajout seul (registre, restrictions, briques,
--         exécutions, décisions, autonomie, contributions, jeux, évaluations) ;
--   MPG02 restriction ou brique au-delà du plafond du standard, agent inconnu ;
--   MPG03 événement d'autonomie incohérent (palier, plafond, associé, N4 hors R0) ;
--   MPG04 activation d'un prompt ou d'un modèle sans évaluation de non-régression ;
--   MPG05 exécution, décision, contribution, jeu ou évaluation incohérents.
--
-- - agents_registre : registre STANDARD (propriété d'ACC, sans cabinet_id),
--   versionné et EN AJOUT SEUL ; le rôle applicatif le LIT seulement. Les 14
--   agents du PRD sont semés ici (insertion idempotente). Une évolution crée la
--   version suivante d'un code, avec ses notes de version.
-- - agents_restrictions : restriction d'un agent par le cabinet (agent.gerer),
--   EN AJOUT SEUL ; la restriction courante est la dernière. Un cabinet ne peut
--   que RESTREINDRE : désactiver l'agent ou abaisser son niveau maximal.

CREATE TABLE agents_registre (
  code text NOT NULL CHECK (code ~ '^[a-z][a-z_]{1,39}$'),
  version int NOT NULL CHECK (version BETWEEN 1 AND 10000),
  nom text NOT NULL CHECK (length(btrim(nom)) BETWEEN 1 AND 80),
  mission text NOT NULL CHECK (length(btrim(mission)) BETWEEN 1 AND 1000),
  ne_fait_jamais text NOT NULL CHECK (length(btrim(ne_fait_jamais)) BETWEEN 1 AND 500),
  entrees text[] NOT NULL CHECK (cardinality(entrees) BETWEEN 1 AND 20),
  -- Liste FERMÉE d'outils (packages/shared/src/schemas/agents.ts, OUTILS_AGENT).
  outils_autorises text[] NOT NULL CHECK (outils_autorises <@ ARRAY[
    'lire_mission', 'lire_documents', 'lire_reponses', 'lire_preuves', 'lire_banque_items',
    'lire_methode', 'lire_dossier_client', 'lire_planning', 'lire_kpi', 'lire_sources_externes',
    'proposer_brouillon', 'proposer_classement', 'proposer_extraction', 'proposer_assertion',
    'proposer_relance', 'envoyer_relance', 'accuser_reception']::text[]),
  -- Permissions que l'utilisateur déclencheur doit détenir (packages/shared/src/roles.ts).
  droits text[] NOT NULL
    CHECK (array_to_string(droits, ',') ~ '^([a-z_]+(\.[a-z_]+)+(,[a-z_]+(\.[a-z_]+)+)*)?$'),
  -- Types de briques couvertes (codes du référentiel de méthodes, lot STD).
  briques text[] NOT NULL CHECK (cardinality(briques) <= 30),
  -- Tâches IA de l'agent : routage du modèle par tâche (AGT-06, ia/modeles.ts).
  taches text[] NOT NULL CHECK (cardinality(taches) >= 1
    AND taches <@ ARRAY['redaction', 'analyse', 'extraction', 'classification']::text[]),
  niveau_max text NOT NULL CHECK (niveau_max IN ('N0', 'N1', 'N2', 'N3', 'N4')),
  -- Schéma de sortie de l'agent (AGT-02), forme `schemaSortieSchema` (shared/schemas/ia.ts).
  schema_sortie jsonb NOT NULL CHECK (jsonb_typeof(schema_sortie) = 'object'),
  -- L'agent lit des contenus de clients : tests d'injection obligatoires (AGT-07).
  lit_contenu_client boolean NOT NULL,
  notes_version text NOT NULL DEFAULT '' CHECK (length(notes_version) <= 2000),
  cree_le timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (code, version),
  -- Seules les briques R0 vont jusqu'à N4 ; les actions vers le client sont des outils N4.
  CHECK (niveau_max = 'N4' OR NOT (outils_autorises && ARRAY['envoyer_relance', 'accuser_reception']::text[]))
);
ALTER TABLE agents_registre ENABLE ROW LEVEL SECURITY;
-- Registre standard : lisible par tout cabinet, jamais modifiable par le rôle applicatif.
CREATE POLICY lecture ON agents_registre FOR SELECT USING (true);
CREATE POLICY portail_interdit ON agents_registre AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE INSERT, UPDATE, DELETE ON agents_registre FROM missionpilot_app;

CREATE FUNCTION agents_ajout_seul() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    RAISE EXCEPTION 'Historique des agents en ajout seul : créer un nouvel enregistrement.'
      USING ERRCODE = 'MPG01';
  END $$;

CREATE TRIGGER agents_registre_ajout_seul BEFORE UPDATE OR DELETE ON agents_registre
  FOR EACH ROW EXECUTE FUNCTION agents_ajout_seul();

-- Version consécutive d'un code (1 pour un nouvel agent).
CREATE FUNCTION controler_agent_registre() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NEW.version <> coalesce((SELECT max(version) FROM agents_registre WHERE code = NEW.code), 0) + 1 THEN
      RAISE EXCEPTION 'Version d''agent non consécutive.' USING ERRCODE = 'MPG05';
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER agents_registre_controle BEFORE INSERT ON agents_registre
  FOR EACH ROW EXECUTE FUNCTION controler_agent_registre();

-- Version courante d'un agent du standard.
CREATE VIEW agents_registre_courant WITH (security_invoker = true) AS
  SELECT DISTINCT ON (code) * FROM agents_registre ORDER BY code, version DESC;

-- Semis du standard : 14 agents (PRD complémentaire §7). Niveaux maximaux et
-- droits PROPOSÉS, à calibrer au pilote (comme les seuils d'autonomie).
INSERT INTO agents_registre (code, version, nom, mission, ne_fait_jamais, entrees, outils_autorises,
  droits, briques, taches, niveau_max, schema_sortie, lit_contenu_client, notes_version)
VALUES
  ('avant_vente', 1, 'Avant-vente',
   'Lit l''appel d''offres ou le besoin, extrait les exigences, propose méthode, équipe et planning, rédige l''offre technique.',
   'Fixer un prix (moteur de tarification).',
   ARRAY['Dossier d''appel d''offres ou expression du besoin', 'Méthodes du référentiel', 'Références du cabinet'],
   ARRAY['lire_documents', 'lire_methode', 'proposer_extraction', 'proposer_brouillon'],
   ARRAY['pipeline.gerer'], ARRAY['offre_technique', 'matrice_conformite'],
   ARRAY['extraction', 'redaction'], 'N2', '{"type": "texte", "longueur_max": 20000}', true,
   'Version initiale du standard.'),
  ('cadrage', 1, 'Cadrage',
   'Prépare la lettre de mission, la liste de demandes documentaires, le plan de collecte et la réunion de lancement.',
   'Signer ou envoyer sans validation.',
   ARRAY['Proposition acceptée', 'Méthode de la mission', 'Dossier client'],
   ARRAY['lire_mission', 'lire_methode', 'lire_dossier_client', 'proposer_brouillon'],
   ARRAY['mission.lire'], ARRAY['lettre_mission', 'demandes_documentaires', 'plan_collecte'],
   ARRAY['redaction'], 'N2', '{"type": "texte", "longueur_max": 20000}', false,
   'Version initiale du standard.'),
  ('collecte', 1, 'Collecte',
   'Assemble les questionnaires depuis la banque d''items, traduit, relance et contrôle la complétude.',
   'Inventer un item hors banque validée.',
   ARRAY['Banque d''items validée', 'Questionnaires envoyés', 'Réponses reçues'],
   ARRAY['lire_banque_items', 'lire_reponses', 'proposer_brouillon', 'proposer_relance', 'envoyer_relance'],
   ARRAY['questionnaire.gerer'], ARRAY['questionnaire', 'relance_questionnaire', 'controle_completude'],
   ARRAY['redaction', 'classification'], 'N4', '{"type": "texte", "longueur_max": 10000}', true,
   'Version initiale du standard.'),
  ('documentaire', 1, 'Documentaire',
   'Classe les documents reçus, extrait les données avec référence de page, signale les incohérences.',
   'Accepter un chiffre qui échoue aux contrôles.',
   ARRAY['Documents reçus du client', 'Liste de demandes documentaires'],
   ARRAY['lire_documents', 'proposer_classement', 'proposer_extraction', 'accuser_reception'],
   ARRAY['mission.lire'], ARRAY['classement_documents', 'extraction_donnees', 'accuse_reception'],
   ARRAY['classification', 'extraction'], 'N4',
   '{"type": "objet", "champs": {"classement": {"type": "texte", "longueur_max": 500}, "resume": {"type": "texte", "longueur_max": 2000}, "incoherences": {"type": "liste_texte", "max_elements": 50}}}',
   true, 'Version initiale du standard.'),
  ('entretien', 1, 'Entretien',
   'Prépare le guide, transcrit, code les verbatims par dimension et propose des assertions.',
   'Publier un verbatim nominatif sans accord.',
   ARRAY['Guide d''entretien', 'Transcription', 'Dimensions de la méthode'],
   ARRAY['lire_mission', 'lire_methode', 'proposer_brouillon', 'proposer_assertion'],
   ARRAY['mission.lire'], ARRAY['guide_entretien', 'codage_verbatims'],
   ARRAY['analyse', 'classification'], 'N3',
   '{"type": "objet", "champs": {"codes": {"type": "liste_texte", "max_elements": 100}, "assertions": {"type": "liste_texte", "max_elements": 50}}}',
   true, 'Version initiale du standard.'),
  ('terrain', 1, 'Terrain',
   'Transforme notes vocales et photos en observations structurées rattachées aux dimensions.',
   'Noter une pratique.',
   ARRAY['Notes de terrain', 'Dimensions de la méthode'],
   ARRAY['lire_mission', 'lire_methode', 'proposer_brouillon', 'proposer_assertion'],
   ARRAY['mission.lire'], ARRAY['observation_terrain'],
   ARRAY['analyse'], 'N2', '{"type": "texte", "longueur_max": 10000}', true,
   'Version initiale du standard.'),
  ('analyste', 1, 'Analyste',
   'SWOT, causes racines, hypothèses, synthèse par dimension, à partir du registre des preuves.',
   'Conclure sans preuve.',
   ARRAY['Registre des preuves', 'Résultats des moteurs'],
   ARRAY['lire_mission', 'lire_preuves', 'lire_kpi', 'proposer_brouillon', 'proposer_assertion'],
   ARRAY['mission.lire', 'preuve.lire'], ARRAY['synthese_dimension', 'swot', 'causes_racines'],
   ARRAY['analyse', 'redaction'], 'N2', '{"type": "texte", "longueur_max": 20000}', true,
   'Version initiale du standard.'),
  ('contradicteur', 1, 'Contradicteur',
   'Cherche contre-preuves, incohérences, biais et affirmations non sourcées.',
   'Modifier le livrable.',
   ARRAY['Brouillon de livrable', 'Registre des preuves'],
   ARRAY['lire_mission', 'lire_preuves'],
   ARRAY['mission.lire', 'preuve.lire'], ARRAY['revue_contradictoire'],
   ARRAY['analyse'], 'N3',
   '{"type": "objet", "champs": {"contre_preuves": {"type": "liste_texte", "max_elements": 50}, "incoherences": {"type": "liste_texte", "max_elements": 50}, "affirmations_non_sourcees": {"type": "liste_texte", "max_elements": 50}}}',
   true, 'Version initiale du standard.'),
  ('redacteur', 1, 'Rédacteur',
   'Rédige livrables et présentations au gabarit et au ton du cabinet.',
   'Écrire un chiffre non fourni par un moteur.',
   ARRAY['Plan du livrable', 'Assertions validées', 'Chiffres des moteurs'],
   ARRAY['lire_mission', 'lire_preuves', 'lire_methode', 'proposer_brouillon'],
   ARRAY['mission.lire'], ARRAY['section_rapport', 'presentation'],
   ARRAY['redaction'], 'N2', '{"type": "texte", "longueur_max": 20000}', false,
   'Version initiale du standard.'),
  ('qualite', 1, 'Qualité',
   'Vérifie la définition de terminé, la traçabilité des chiffres et des preuves, le style ; prépare la revue.',
   'Valider à la place du relecteur.',
   ARRAY['Livrable', 'Définition de terminé', 'Registre des preuves'],
   ARRAY['lire_mission', 'lire_preuves', 'lire_methode'],
   ARRAY['mission.lire'], ARRAY['controle_qualite'],
   ARRAY['analyse', 'classification'], 'N3',
   '{"type": "objet", "champs": {"ecarts": {"type": "liste_texte", "max_elements": 100}, "pret_pour_revue": {"type": "booleen"}}}',
   false, 'Version initiale du standard.'),
  ('pmo', 1, 'PMO',
   'Suit planning, jalons et actions ; prépare comités et rapports d''avancement.',
   'Décaler un jalon contractuel.',
   ARRAY['Planning de la mission', 'Jalons', 'Actions'],
   ARRAY['lire_mission', 'lire_planning', 'lire_kpi', 'proposer_brouillon'],
   ARRAY['mission.lire'], ARRAY['rapport_avancement', 'preparation_comite'],
   ARRAY['redaction', 'analyse'], 'N3', '{"type": "texte", "longueur_max": 20000}', false,
   'Version initiale du standard.'),
  ('veille', 1, 'Veille',
   'Surveille les sources sectorielles, réglementaires et les appels d''offres.',
   'Citer une source non vérifiable.',
   ARRAY['Sources sectorielles déclarées', 'Profil du cabinet'],
   ARRAY['lire_sources_externes', 'proposer_brouillon', 'proposer_classement'],
   ARRAY['standard.lire'], ARRAY['veille_sectorielle', 'veille_appels_offres'],
   ARRAY['classification', 'redaction'], 'N3', '{"type": "texte", "longueur_max": 10000}', true,
   'Version initiale du standard.'),
  ('capitalisation', 1, 'Capitalisation',
   'À la clôture, rédige le retour d''expérience, anonymise et met à jour les bases.',
   'Partager une donnée identifiante.',
   ARRAY['Mission clôturée', 'Bilan', 'Livrables validés'],
   ARRAY['lire_mission', 'lire_preuves', 'proposer_brouillon'],
   ARRAY['mission.lire'], ARRAY['retour_experience'],
   ARRAY['redaction'], 'N2', '{"type": "texte", "longueur_max": 20000}', false,
   'Version initiale du standard.'),
  ('copilote', 1, 'Copilote',
   'Interface conversationnelle unique : répond, route vers les agents, déclenche des actions confirmées.',
   'Agir hors des droits de l''utilisateur.',
   ARRAY['Question de l''utilisateur', 'Données visibles de l''utilisateur'],
   ARRAY['lire_mission', 'lire_planning', 'lire_kpi', 'proposer_brouillon'],
   ARRAY[]::text[], ARRAY['assistance'],
   ARRAY['redaction', 'analyse'], 'N1', '{"type": "texte", "longueur_max": 10000}', false,
   'Version initiale du standard (copilote AGT-08 hors du lot AGT de la vague 1).')
ON CONFLICT (code, version) DO NOTHING;

CREATE TABLE agents_restrictions (
  id bigserial PRIMARY KEY,
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  agent_code text NOT NULL,
  actif boolean NOT NULL,
  -- NULL : niveau maximal du standard.
  niveau_max text CHECK (niveau_max IS NULL OR niveau_max IN ('N0', 'N1', 'N2', 'N3', 'N4')),
  motif text NOT NULL CHECK (length(btrim(motif)) BETWEEN 1 AND 1000),
  auteur_id uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (cabinet_id, auteur_id) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX agents_restrictions_idx ON agents_restrictions (cabinet_id, agent_code, id DESC);
ALTER TABLE agents_restrictions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON agents_restrictions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON agents_restrictions AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON agents_restrictions FROM missionpilot_app;

CREATE TRIGGER agents_restrictions_ajout_seul BEFORE UPDATE OR DELETE ON agents_restrictions
  FOR EACH ROW EXECUTE FUNCTION agents_ajout_seul();

-- Un cabinet ne peut que restreindre : agent connu, niveau au plus celui du standard.
CREATE FUNCTION controler_agent_restriction() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_max text;
  BEGIN
    SELECT niveau_max INTO v_max FROM agents_registre_courant WHERE code = NEW.agent_code;
    IF v_max IS NULL THEN
      RAISE EXCEPTION 'Agent inconnu du registre.' USING ERRCODE = 'MPG02';
    END IF;
    IF NEW.niveau_max IS NOT NULL AND NEW.niveau_max > v_max THEN
      RAISE EXCEPTION 'Un cabinet ne peut que restreindre le niveau du standard.' USING ERRCODE = 'MPG02';
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER agents_restrictions_controle BEFORE INSERT ON agents_restrictions
  FOR EACH ROW EXECUTE FUNCTION controler_agent_restriction();
