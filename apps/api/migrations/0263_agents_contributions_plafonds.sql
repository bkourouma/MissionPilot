-- Agents IA : contribution de l'IA par livrable (AGT-05) et plafond de coût
-- par mission (AGT-06).
--
-- - agents_contributions : mesure, par livrable, de ce que l'IA a apporté :
--   distance d'édition en mots entre le brouillon IA et le texte validé, mots
--   conservés, part conservée (pour-cent entier), taux de modification et
--   modification majeure au seuil du moment, temps de revue. Tous les nombres
--   sortent du moteur pur `contributionIa` (packages/engines/src/contribution) ;
--   les textes ne sont PAS recopiés (empreintes SHA-256 seulement : le texte vit
--   dans ia_generations, soumis à la conservation 0104). Une mesure par
--   livrable, EN AJOUT SEUL.
-- - agents_plafonds_mission : plafond de coût IA d'une mission (µUSD), EN PLUS
--   du plafond mensuel du cabinet (ia_parametres_cabinet). Réglage modifiable.

CREATE TABLE agents_contributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  livrable_type text NOT NULL CHECK (livrable_type ~ '^[a-z][a-z_]{0,39}$'),
  livrable_id uuid NOT NULL,
  mission_id uuid,
  execution_id uuid,
  brique_id uuid,
  agent_code text CHECK (agent_code IS NULL OR agent_code ~ '^[a-z][a-z_]{1,39}$'),
  mots_brouillon int NOT NULL CHECK (mots_brouillon >= 0),
  mots_valides int NOT NULL CHECK (mots_valides >= 0),
  distance int NOT NULL CHECK (distance >= 0),
  mots_conserves int NOT NULL CHECK (mots_conserves BETWEEN 0 AND mots_brouillon),
  part_conservee_pct smallint CHECK (part_conservee_pct BETWEEN 0 AND 100),
  taux_modification_pct smallint NOT NULL CHECK (taux_modification_pct BETWEEN 0 AND 100),
  modification_majeure boolean NOT NULL,
  seuil_pct smallint NOT NULL CHECK (seuil_pct BETWEEN 0 AND 100),
  sessions_revue int NOT NULL CHECK (sessions_revue >= 0),
  temps_revue_secondes bigint NOT NULL CHECK (temps_revue_secondes >= 0),
  mediane_revue_secondes bigint NOT NULL CHECK (mediane_revue_secondes >= 0),
  exacte boolean NOT NULL,
  brouillon_empreinte text NOT NULL CHECK (brouillon_empreinte ~ '^[0-9a-f]{64}$'),
  valide_empreinte text NOT NULL CHECK (valide_empreinte ~ '^[0-9a-f]{64}$'),
  auteur_id uuid,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, livrable_type, livrable_id),
  CHECK ((part_conservee_pct IS NULL) = (mots_brouillon = 0)),
  FOREIGN KEY (cabinet_id, mission_id) REFERENCES missions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, execution_id) REFERENCES agents_executions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, brique_id) REFERENCES agents_briques (cabinet_id, id),
  FOREIGN KEY (cabinet_id, auteur_id) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX agents_contributions_liste_idx ON agents_contributions (cabinet_id, cree_le DESC, id DESC);
ALTER TABLE agents_contributions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON agents_contributions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON agents_contributions AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON agents_contributions FROM missionpilot_app;

CREATE TRIGGER agents_contributions_ajout_seul BEFORE UPDATE OR DELETE ON agents_contributions
  FOR EACH ROW EXECUTE FUNCTION agents_ajout_seul();

-- Une contribution liée à une exécution reprend sa mission, sa brique et son agent.
CREATE FUNCTION controler_agent_contribution() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NEW.execution_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM agents_executions e WHERE e.id = NEW.execution_id
           AND e.mission_id IS NOT DISTINCT FROM NEW.mission_id
           AND e.brique_id IS NOT DISTINCT FROM NEW.brique_id
           AND e.agent_code = NEW.agent_code) THEN
      RAISE EXCEPTION 'Contribution incohérente avec son exécution.' USING ERRCODE = 'MPG05';
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER agents_contributions_controle BEFORE INSERT ON agents_contributions
  FOR EACH ROW EXECUTE FUNCTION controler_agent_contribution();

CREATE TABLE agents_plafonds_mission (
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  mission_id uuid NOT NULL,
  plafond_micro_usd bigint NOT NULL CHECK (plafond_micro_usd BETWEEN 0 AND 100000000000),
  modifie_par uuid NOT NULL,
  modifie_le timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cabinet_id, mission_id),
  FOREIGN KEY (cabinet_id, mission_id) REFERENCES missions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, modifie_par) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE agents_plafonds_mission ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON agents_plafonds_mission
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON agents_plafonds_mission AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
