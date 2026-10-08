-- Moteur d'automatisation (lot AUT-CORE, ADR-006) : événements publiés (AUT-01), exécutions,
-- actions planifiées et gardées (AUT-05), résultats, annulations et brouillons tracés (AUT-06).
-- Tout est en AJOUT SEUL (MPU01) : on corrige par un nouvel enregistrement (annulation,
-- décision), jamais par UPDATE.
--
-- SQLSTATE :
-- - MPU03 : annulation refusée (action non annulable, non réussie) ;
-- - MPU04 : action vers le client autorisée hors classe R0 (garde doublée en base, AUT-05).

-- Événements métier publiés (idempotents par clé). `source` : `utilisateur` (service appelé
-- dans les droits d'une personne), `systeme` (tâche ou service sans personne), `base`
-- (déclencheur d'une table du module, 0302).
CREATE TABLE automatisation_evenements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  code text NOT NULL CHECK (length(code) <= 80 AND code ~ '^[a-z][a-z_]*\.[a-z][a-z_]*$'),
  payload jsonb NOT NULL
    CHECK (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 16384),
  cle text NOT NULL CHECK (length(cle) BETWEEN 1 AND 300),
  source text NOT NULL CHECK (source IN ('utilisateur', 'systeme', 'base')),
  acteur_id uuid,
  mission_id uuid,
  cree_le timestamptz NOT NULL DEFAULT now(),
  CHECK ((source = 'utilisateur') = (acteur_id IS NOT NULL)),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, cle),
  FOREIGN KEY (cabinet_id, acteur_id) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, mission_id) REFERENCES missions (cabinet_id, id)
);
CREATE INDEX automatisation_evenements_code_idx
  ON automatisation_evenements (cabinet_id, code, cree_le DESC, id DESC);
ALTER TABLE automatisation_evenements ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON automatisation_evenements
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON automatisation_evenements AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON automatisation_evenements FROM missionpilot_app;
CREATE TRIGGER automatisation_evenements_ajout_seul
  BEFORE UPDATE OR DELETE ON automatisation_evenements
  FOR EACH ROW EXECUTE FUNCTION automatisation_ajout_seul();

-- Une exécution par automatisation et par événement (idempotence) ; version de la définition
-- appliquée, identité d'exécution et issue.
CREATE TABLE automatisation_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  automatisation_id uuid NOT NULL,
  version int NOT NULL,
  evenement_id uuid NOT NULL,
  issue text NOT NULL CHECK (issue IN ('declenchee', 'conditions_non_remplies', 'bloquee')),
  raison text CHECK (raison IS NULL OR raison IN ('COUPE_CIRCUIT_CABINET', 'COUPE_CIRCUIT_AUTOMATISATION')),
  mode_execution text NOT NULL CHECK (mode_execution IN ('responsable', 'declencheur')),
  executant_id uuid,
  mission_id uuid,
  cree_le timestamptz NOT NULL DEFAULT now(),
  CHECK ((issue = 'bloquee') = (raison IS NOT NULL)),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, automatisation_id, evenement_id),
  FOREIGN KEY (cabinet_id, automatisation_id, version)
    REFERENCES automatisation_versions (cabinet_id, automatisation_id, version),
  FOREIGN KEY (cabinet_id, evenement_id) REFERENCES automatisation_evenements (cabinet_id, id),
  FOREIGN KEY (cabinet_id, executant_id) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, mission_id) REFERENCES missions (cabinet_id, id)
);
CREATE INDEX automatisation_executions_liste_idx
  ON automatisation_executions (cabinet_id, cree_le DESC, id DESC);
CREATE INDEX automatisation_executions_automatisation_idx
  ON automatisation_executions (cabinet_id, automatisation_id, cree_le DESC, id DESC);
ALTER TABLE automatisation_executions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON automatisation_executions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON automatisation_executions AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON automatisation_executions FROM missionpilot_app;
CREATE TRIGGER automatisation_executions_ajout_seul
  BEFORE UPDATE OR DELETE ON automatisation_executions
  FOR EACH ROW EXECUTE FUNCTION automatisation_ajout_seul();

-- Actions planifiées : paramètres figés, classe et destination, décision de la garde ; clé
-- d'idempotence du moteur (automatisation, événement, rang).
CREATE TABLE automatisation_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  execution_id uuid NOT NULL,
  indice smallint NOT NULL CHECK (indice BETWEEN 0 AND 9),
  type text NOT NULL CHECK (type IN ('creer_tache', 'notifier', 'brouillon', 'facture_brouillon',
    'appeler_agent', 'relance_questionnaire')),
  parametres jsonb NOT NULL
    CHECK (jsonb_typeof(parametres) = 'object' AND octet_length(parametres::text) <= 16384),
  classe_risque text NOT NULL CHECK (classe_risque IN ('R0', 'R1', 'R2', 'R3')),
  vers_client boolean NOT NULL,
  annulable boolean NOT NULL,
  cle text NOT NULL CHECK (length(cle) BETWEEN 1 AND 300),
  autorisee boolean NOT NULL,
  refus text[] NOT NULL DEFAULT '{}' CHECK (cardinality(refus) <= 20),
  cree_le timestamptz NOT NULL DEFAULT now(),
  -- Registre doublé en base : seule la relance atteint le client ; seules les actions qui
  -- produisent un brouillon s'annulent.
  CHECK ((type = 'relance_questionnaire') = vers_client),
  CHECK (NOT annulable OR type IN ('brouillon', 'facture_brouillon')),
  CHECK (autorisee = (cardinality(refus) = 0)),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, cle),
  UNIQUE (cabinet_id, execution_id, indice),
  FOREIGN KEY (cabinet_id, execution_id) REFERENCES automatisation_executions (cabinet_id, id)
);
ALTER TABLE automatisation_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON automatisation_actions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON automatisation_actions AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON automatisation_actions FROM missionpilot_app;
CREATE TRIGGER automatisation_actions_ajout_seul BEFORE UPDATE OR DELETE ON automatisation_actions
  FOR EACH ROW EXECUTE FUNCTION automatisation_ajout_seul();

-- AUT-05 doublé en base : aucune action vers le client autorisée hors R0, et jamais depuis
-- une exécution qui n'est pas « déclenchée ».
CREATE FUNCTION controler_action_automatisation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NEW.vers_client AND NEW.autorisee AND NEW.classe_risque <> 'R0' THEN
      RAISE EXCEPTION 'Action vers le client réservée à la classe R0.' USING ERRCODE = 'MPU04';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM automatisation_executions x WHERE x.id = NEW.execution_id
                     AND x.cabinet_id = NEW.cabinet_id AND x.issue = 'declenchee') THEN
      RAISE EXCEPTION 'Action d''une exécution non déclenchée.' USING ERRCODE = 'MPU05';
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER automatisation_actions_controle BEFORE INSERT ON automatisation_actions
  FOR EACH ROW EXECUTE FUNCTION controler_action_automatisation();

-- Résultat d'une action (une fois) : l'entité produite, ou le code du refus ou de l'échec.
CREATE TABLE automatisation_action_resultats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  action_id uuid NOT NULL,
  statut text NOT NULL CHECK (statut IN ('reussie', 'refusee', 'echec', 'ignoree')),
  code text CHECK (code IS NULL OR code ~ '^[A-Z][A-Z0-9_]{1,59}$'),
  message text CHECK (message IS NULL OR length(message) <= 500),
  entite_type text CHECK (entite_type IS NULL OR entite_type IN ('tache_collaboration',
    'notification', 'automatisation_brouillon', 'facture', 'agent_execution', 'questionnaire_envoi')),
  entite_id uuid,
  details jsonb NOT NULL DEFAULT '{}'
    CHECK (jsonb_typeof(details) = 'object' AND octet_length(details::text) <= 8192),
  cree_le timestamptz NOT NULL DEFAULT now(),
  CHECK ((entite_type IS NULL) = (entite_id IS NULL)),
  CHECK (statut = 'reussie' OR code IS NOT NULL),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, action_id),
  FOREIGN KEY (cabinet_id, action_id) REFERENCES automatisation_actions (cabinet_id, id)
);
ALTER TABLE automatisation_action_resultats ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON automatisation_action_resultats
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON automatisation_action_resultats AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON automatisation_action_resultats FROM missionpilot_app;
CREATE TRIGGER automatisation_action_resultats_ajout_seul
  BEFORE UPDATE OR DELETE ON automatisation_action_resultats
  FOR EACH ROW EXECUTE FUNCTION automatisation_ajout_seul();

-- Une action refusée par la garde ne peut qu'être « refusee » ; une action autorisée ne l'est
-- jamais.
CREATE FUNCTION controler_resultat_automatisation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_autorisee boolean;
  BEGIN
    SELECT a.autorisee INTO v_autorisee FROM automatisation_actions a
      WHERE a.id = NEW.action_id AND a.cabinet_id = NEW.cabinet_id;
    IF v_autorisee IS NULL OR v_autorisee = (NEW.statut = 'refusee') THEN
      RAISE EXCEPTION 'Résultat incompatible avec la garde de l''action.' USING ERRCODE = 'MPU05';
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER automatisation_action_resultats_controle
  BEFORE INSERT ON automatisation_action_resultats
  FOR EACH ROW EXECUTE FUNCTION controler_resultat_automatisation();

-- Annulation (AUT-06) : une seule par action, seulement d'une action annulable réussie.
CREATE TABLE automatisation_annulations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  action_id uuid NOT NULL,
  motif text NOT NULL CHECK (length(btrim(motif)) BETWEEN 1 AND 1000),
  auteur_id uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, action_id),
  FOREIGN KEY (cabinet_id, action_id) REFERENCES automatisation_actions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, auteur_id) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE automatisation_annulations ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON automatisation_annulations
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON automatisation_annulations AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON automatisation_annulations FROM missionpilot_app;
CREATE TRIGGER automatisation_annulations_ajout_seul
  BEFORE UPDATE OR DELETE ON automatisation_annulations
  FOR EACH ROW EXECUTE FUNCTION automatisation_ajout_seul();

CREATE FUNCTION controler_annulation_automatisation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NOT EXISTS (
         SELECT 1 FROM automatisation_actions a
         JOIN automatisation_action_resultats r ON r.action_id = a.id AND r.statut = 'reussie'
         WHERE a.id = NEW.action_id AND a.cabinet_id = NEW.cabinet_id AND a.annulable) THEN
      RAISE EXCEPTION 'Seule une action annulable et réussie s''annule.' USING ERRCODE = 'MPU03';
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER automatisation_annulations_controle BEFORE INSERT ON automatisation_annulations
  FOR EACH ROW EXECUTE FUNCTION controler_annulation_automatisation();

-- Brouillons tracés (« l'IA propose, l'expert dispose », étendu aux automatisations) : texte
-- figé ; la décision humaine (validé, modifié, rejeté, annulé) est un ajout, une seule fois.
CREATE TABLE automatisation_brouillons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  action_id uuid NOT NULL,
  mission_id uuid NOT NULL,
  nature text NOT NULL CHECK (nature IN ('note_alerte', 'rappel_checklist', 'note')),
  titre text NOT NULL CHECK (length(btrim(titre)) BETWEEN 1 AND 200),
  corps text NOT NULL CHECK (length(corps) BETWEEN 1 AND 5000),
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, action_id),
  FOREIGN KEY (cabinet_id, action_id) REFERENCES automatisation_actions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, mission_id) REFERENCES missions (cabinet_id, id)
);
CREATE INDEX automatisation_brouillons_liste_idx
  ON automatisation_brouillons (cabinet_id, cree_le DESC, id DESC);
ALTER TABLE automatisation_brouillons ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON automatisation_brouillons
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON automatisation_brouillons AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON automatisation_brouillons FROM missionpilot_app;
CREATE TRIGGER automatisation_brouillons_ajout_seul
  BEFORE UPDATE OR DELETE ON automatisation_brouillons
  FOR EACH ROW EXECUTE FUNCTION automatisation_ajout_seul();

CREATE TABLE automatisation_brouillon_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  brouillon_id uuid NOT NULL,
  decision text NOT NULL CHECK (decision IN ('validee', 'modifiee', 'rejetee', 'annulee')),
  texte_final text CHECK (texte_final IS NULL OR length(texte_final) BETWEEN 1 AND 5000),
  motif text CHECK (motif IS NULL OR length(btrim(motif)) BETWEEN 1 AND 1000),
  auteur_id uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  CHECK ((decision = 'modifiee') = (texte_final IS NOT NULL)),
  CHECK (decision NOT IN ('rejetee', 'annulee') OR motif IS NOT NULL),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, brouillon_id),
  FOREIGN KEY (cabinet_id, brouillon_id) REFERENCES automatisation_brouillons (cabinet_id, id),
  FOREIGN KEY (cabinet_id, auteur_id) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE automatisation_brouillon_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON automatisation_brouillon_decisions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON automatisation_brouillon_decisions AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON automatisation_brouillon_decisions FROM missionpilot_app;
CREATE TRIGGER automatisation_brouillon_decisions_ajout_seul
  BEFORE UPDATE OR DELETE ON automatisation_brouillon_decisions
  FOR EACH ROW EXECUTE FUNCTION automatisation_ajout_seul();
