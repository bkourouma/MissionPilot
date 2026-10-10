-- Moteur d'automatisation (lot AUT-CORE, vague 2 ; PRD complémentaire §8, ADR-006) :
-- automatisations du cabinet (déclencheur → conditions → actions), versions immuables de leur
-- définition, coupe-circuits du cabinet et par automatisation (AUT-06).
--
-- SQLSTATE de la lettre U (CODING_STANDARDS §2, SECURITY §6) :
-- - MPU01 : historique d'ajout seul (versions, coupe-circuits, événements, exécutions…) ;
-- - MPU02 : lever un coupe-circuit est réservé à un associé actif ;
-- - MPU05 : incohérence (version courante absente, événement différent de la définition,
--   résultat d'action incompatible avec la garde).
-- MPU03 et MPU04 : 0301.

CREATE FUNCTION automatisation_ajout_seul() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    RAISE EXCEPTION 'Historique des automatisations en ajout seul (%).', TG_TABLE_NAME
      USING ERRCODE = 'MPU01';
  END $$;

-- En-tête d'une automatisation : état courant (active, version courante). La définition vit
-- dans automatisation_versions (immuable) ; aucune suppression (REVOKE DELETE).
CREATE TABLE automatisations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  nom text NOT NULL CHECK (length(btrim(nom)) BETWEEN 1 AND 200),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
  standard_code text CHECK (standard_code IS NULL OR standard_code ~ '^[a-z][a-z0-9_]{1,59}$'),
  evenement_code text NOT NULL
    CHECK (length(evenement_code) <= 80 AND evenement_code ~ '^[a-z][a-z_]*\.[a-z][a-z_]*$'),
  version_courante int NOT NULL DEFAULT 1 CHECK (version_courante >= 1),
  active boolean NOT NULL DEFAULT false,
  -- Seuls les événements publiés APRÈS l'activation déclenchent l'automatisation (le passé se
  -- simule, AUT-04).
  active_depuis timestamptz,
  responsable_id uuid NOT NULL,
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  modifie_le timestamptz NOT NULL DEFAULT now(),
  CHECK (active = (active_depuis IS NOT NULL)),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, responsable_id) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX automatisations_evenement_idx ON automatisations (cabinet_id, evenement_code)
  WHERE active;
CREATE INDEX automatisations_liste_idx ON automatisations (cabinet_id, cree_le DESC, id DESC);
CREATE UNIQUE INDEX automatisations_standard_uniq ON automatisations (cabinet_id, standard_code)
  WHERE standard_code IS NOT NULL;
ALTER TABLE automatisations ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON automatisations
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON automatisations AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE DELETE ON automatisations FROM missionpilot_app;

CREATE TABLE automatisation_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  automatisation_id uuid NOT NULL,
  version int NOT NULL CHECK (version >= 1),
  -- Forme du schéma partagé definitionAutomatisationSchema (événement, condition, actions,
  -- identité d'exécution), validée par l'API avec le moteur avant l'insertion.
  definition jsonb NOT NULL
    CHECK (jsonb_typeof(definition) = 'object' AND octet_length(definition::text) <= 65536),
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, automatisation_id, version),
  FOREIGN KEY (cabinet_id, automatisation_id) REFERENCES automatisations (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE automatisation_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON automatisation_versions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON automatisation_versions AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON automatisation_versions FROM missionpilot_app;
CREATE TRIGGER automatisation_versions_ajout_seul BEFORE UPDATE OR DELETE ON automatisation_versions
  FOR EACH ROW EXECUTE FUNCTION automatisation_ajout_seul();

-- Cohérence vérifiée en fin de transaction : la version courante existe et porte l'événement
-- de l'en-tête (l'API crée l'en-tête puis sa version dans la même transaction).
CREATE FUNCTION controler_automatisation_version() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NOT EXISTS (
         SELECT 1 FROM automatisation_versions v
         WHERE v.cabinet_id = NEW.cabinet_id AND v.automatisation_id = NEW.id
           AND v.version = NEW.version_courante
           AND v.definition ->> 'evenement_code' = NEW.evenement_code) THEN
      RAISE EXCEPTION 'Automatisation : version courante absente ou événement incohérent.'
        USING ERRCODE = 'MPU05';
    END IF;
    RETURN NULL;
  END $$;

CREATE CONSTRAINT TRIGGER automatisations_version_coherente
  AFTER INSERT OR UPDATE ON automatisations DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION controler_automatisation_version();

-- Coupe-circuits (AUT-06) : `automatisation_id` nul = tout le cabinet. État courant = dernière
-- ligne de sa portée. Couper : automatisation.gerer (API) ; lever : un associé (MPU02).
CREATE TABLE automatisation_coupe_circuits (
  id bigserial PRIMARY KEY,
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  automatisation_id uuid,
  actif boolean NOT NULL,
  motif text NOT NULL CHECK (length(btrim(motif)) BETWEEN 1 AND 1000),
  auteur_id uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (cabinet_id, automatisation_id) REFERENCES automatisations (cabinet_id, id),
  FOREIGN KEY (cabinet_id, auteur_id) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX automatisation_coupe_circuits_idx
  ON automatisation_coupe_circuits (cabinet_id, automatisation_id, id DESC);
ALTER TABLE automatisation_coupe_circuits ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON automatisation_coupe_circuits
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON automatisation_coupe_circuits AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON automatisation_coupe_circuits FROM missionpilot_app;
CREATE TRIGGER automatisation_coupe_circuits_ajout_seul
  BEFORE UPDATE OR DELETE ON automatisation_coupe_circuits
  FOR EACH ROW EXECUTE FUNCTION automatisation_ajout_seul();

CREATE FUNCTION controler_coupe_circuit_automatisation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NOT NEW.actif AND NOT EXISTS (
         SELECT 1 FROM utilisateurs u WHERE u.id = NEW.auteur_id AND u.cabinet_id = NEW.cabinet_id
           AND u.actif AND 'associe' = ANY (u.roles)) THEN
      RAISE EXCEPTION 'Seul un associé lève un coupe-circuit d''automatisation.'
        USING ERRCODE = 'MPU02';
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER automatisation_coupe_circuits_controle
  BEFORE INSERT ON automatisation_coupe_circuits
  FOR EACH ROW EXECUTE FUNCTION controler_coupe_circuit_automatisation();
