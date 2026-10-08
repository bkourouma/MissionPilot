-- Agents IA : briques confiées aux agents et exécutions tracées (AGT-03, AGT-09).
--
-- - agents_briques : brique d'un cabinet confiée à un agent, avec sa classe de
--   risque (QUA-01) et son niveau d'autonomie maximal ; EN AJOUT SEUL (identité
--   figée). Le niveau ne dépasse pas celui de l'agent dans le standard (MPG02)
--   et N4 n'existe qu'en classe R0. Tant que le référentiel de méthodes (lot STD)
--   ne porte pas les briques, la brique est désignée par son code.
-- - agents_executions : une exécution d'agent = une demande IA de l'orchestrateur
--   (ia_demandes, ADR-003), avec ce qui la rend transparente (AGT-09) : agent et
--   version, brique, niveau d'autonomie EFFECTIF au moment de l'exécution,
--   prompt (nom, version), modèle, fournisseur, mode dégradé (gabarit
--   déterministe, AGT-10), coût, sources, empreinte de l'entrée (jamais l'entrée
--   en clair), validité de la sortie au schéma de l'agent (AGT-02), variables
--   traitées comme données non fiables et signaux d'injection relevés (AGT-07).
--   EN AJOUT SEUL ; le texte produit reste dans ia_generations (conservation 0104).
-- - agents_execution_decisions : décision humaine sur une exécution (acceptée,
--   modifiée = modification majeure, rejetée), une seule, EN AJOUT SEUL.

CREATE TABLE agents_briques (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  brique_code text NOT NULL CHECK (brique_code ~ '^[a-z0-9_.-]{1,120}$'),
  agent_code text NOT NULL,
  classe_risque text NOT NULL CHECK (classe_risque IN ('R0', 'R1', 'R2', 'R3')),
  niveau_max text NOT NULL CHECK (niveau_max IN ('N0', 'N1', 'N2', 'N3', 'N4')),
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, brique_code),
  UNIQUE (cabinet_id, id),
  CHECK (niveau_max <> 'N4' OR classe_risque = 'R0'),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE agents_briques ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON agents_briques
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON agents_briques AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON agents_briques FROM missionpilot_app;

CREATE TRIGGER agents_briques_ajout_seul BEFORE UPDATE OR DELETE ON agents_briques
  FOR EACH ROW EXECUTE FUNCTION agents_ajout_seul();

CREATE FUNCTION controler_agent_brique() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_max text;
  BEGIN
    SELECT niveau_max INTO v_max FROM agents_registre_courant WHERE code = NEW.agent_code;
    IF v_max IS NULL THEN
      RAISE EXCEPTION 'Agent inconnu du registre.' USING ERRCODE = 'MPG02';
    END IF;
    IF NEW.niveau_max > v_max THEN
      RAISE EXCEPTION 'Niveau de la brique au-delà de celui de l''agent.' USING ERRCODE = 'MPG02';
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER agents_briques_controle BEFORE INSERT ON agents_briques
  FOR EACH ROW EXECUTE FUNCTION controler_agent_brique();

CREATE TABLE agents_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  agent_code text NOT NULL CHECK (agent_code ~ '^[a-z][a-z_]{1,39}$'),
  agent_version int NOT NULL CHECK (agent_version >= 1),
  brique_id uuid,
  mission_id uuid,
  demande_id uuid NOT NULL,
  declencheur_id uuid NOT NULL,
  niveau_effectif text NOT NULL CHECK (niveau_effectif IN ('N0', 'N1', 'N2', 'N3', 'N4')),
  classe_risque text CHECK (classe_risque IS NULL OR classe_risque IN ('R0', 'R1', 'R2', 'R3')),
  prompt_nom text NOT NULL,
  prompt_version int NOT NULL,
  tache text NOT NULL CHECK (tache IN ('redaction', 'analyse', 'extraction', 'classification')),
  fournisseur text NOT NULL CHECK (fournisseur IN ('openrouter', 'gabarit')),
  modele text,
  mode_degrade boolean NOT NULL,
  cout_micro_usd bigint NOT NULL DEFAULT 0 CHECK (cout_micro_usd >= 0),
  sources jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(sources) = 'array'),
  entree_empreinte text NOT NULL CHECK (entree_empreinte ~ '^[0-9a-f]{64}$'),
  sortie_valide boolean NOT NULL,
  chiffres_non_verifies boolean NOT NULL,
  donnees_non_fiables text[] NOT NULL DEFAULT '{}' CHECK (cardinality(donnees_non_fiables) <= 30),
  signaux_injection text[] NOT NULL DEFAULT '{}' CHECK (cardinality(signaux_injection) <= 20),
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (demande_id),
  -- Un mode dégradé n'appelle aucun modèle.
  CHECK (mode_degrade = (fournisseur = 'gabarit')),
  FOREIGN KEY (cabinet_id, brique_id) REFERENCES agents_briques (cabinet_id, id),
  FOREIGN KEY (cabinet_id, mission_id) REFERENCES missions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, demande_id) REFERENCES ia_demandes (cabinet_id, id),
  FOREIGN KEY (cabinet_id, declencheur_id) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX agents_executions_liste_idx ON agents_executions (cabinet_id, cree_le DESC, id DESC);
CREATE INDEX agents_executions_brique_idx ON agents_executions (cabinet_id, brique_id, cree_le)
  WHERE brique_id IS NOT NULL;
ALTER TABLE agents_executions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON agents_executions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON agents_executions AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON agents_executions FROM missionpilot_app;

CREATE TRIGGER agents_executions_ajout_seul BEFORE UPDATE OR DELETE ON agents_executions
  FOR EACH ROW EXECUTE FUNCTION agents_ajout_seul();

-- Cohérence : agent connu, brique confiée à CET agent, demande de la même mission.
CREATE FUNCTION controler_agent_execution() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM agents_registre r
                   WHERE r.code = NEW.agent_code AND r.version = NEW.agent_version) THEN
      RAISE EXCEPTION 'Exécution : version d''agent inconnue.' USING ERRCODE = 'MPG05';
    END IF;
    IF NEW.brique_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM agents_briques b WHERE b.id = NEW.brique_id AND b.agent_code = NEW.agent_code) THEN
      RAISE EXCEPTION 'Exécution : brique confiée à un autre agent.' USING ERRCODE = 'MPG05';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM ia_demandes d WHERE d.id = NEW.demande_id
                   AND d.mission_id IS NOT DISTINCT FROM NEW.mission_id) THEN
      RAISE EXCEPTION 'Exécution : demande IA d''une autre mission.' USING ERRCODE = 'MPG05';
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER agents_executions_controle BEFORE INSERT ON agents_executions
  FOR EACH ROW EXECUTE FUNCTION controler_agent_execution();

CREATE TABLE agents_execution_decisions (
  id bigserial PRIMARY KEY,
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  execution_id uuid NOT NULL UNIQUE,
  decision text NOT NULL CHECK (decision IN ('acceptee', 'modifiee', 'rejetee')),
  -- Mesure de l'édition (AGT-05) pour une sortie validée : pour-cent entier.
  taux_modification_pct smallint CHECK (taux_modification_pct BETWEEN 0 AND 100),
  seuil_pct smallint CHECK (seuil_pct BETWEEN 0 AND 100),
  motif text CHECK (motif IS NULL OR length(btrim(motif)) BETWEEN 1 AND 2000),
  decideur_id uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  CHECK (decision <> 'rejetee' OR motif IS NOT NULL),
  CHECK ((decision = 'rejetee') = (taux_modification_pct IS NULL)),
  CHECK ((taux_modification_pct IS NULL) = (seuil_pct IS NULL)),
  FOREIGN KEY (cabinet_id, execution_id) REFERENCES agents_executions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, decideur_id) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE agents_execution_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON agents_execution_decisions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON agents_execution_decisions AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON agents_execution_decisions FROM missionpilot_app;

CREATE TRIGGER agents_execution_decisions_ajout_seul BEFORE UPDATE OR DELETE
  ON agents_execution_decisions FOR EACH ROW EXECUTE FUNCTION agents_ajout_seul();

-- Une sortie non conforme au schéma de l'agent (AGT-02) ne peut être acceptée ;
-- une acceptation exige le contenu VALIDÉ par le circuit humain (ia_generations).
CREATE FUNCTION controler_decision_execution() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_exec agents_executions%ROWTYPE;
  BEGIN
    SELECT * INTO v_exec FROM agents_executions WHERE id = NEW.execution_id;
    IF NEW.decision <> 'rejetee' THEN
      IF NOT v_exec.sortie_valide THEN
        RAISE EXCEPTION 'Sortie non conforme au schéma de l''agent : à rejeter.' USING ERRCODE = 'MPG05';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM ia_generations g WHERE g.demande_id = v_exec.demande_id
                     AND g.statut_contenu = 'valide') THEN
        RAISE EXCEPTION 'Décision : le contenu n''est pas validé.' USING ERRCODE = 'MPG05';
      END IF;
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER agents_execution_decisions_controle BEFORE INSERT ON agents_execution_decisions
  FOR EACH ROW EXECUTE FUNCTION controler_decision_execution();
