-- Agents IA : niveaux d'autonomie par brique et par cabinet (AGT-03, ADR-005,
-- DECISIONS.md du 2026-10-08).
--
-- - autonomie_incidents : incident signalé sur une brique (mineur ou majeur),
--   EN AJOUT SEUL. Un incident majeur rétrograde automatiquement la brique.
-- - autonomie_evenements : historique du NIVEAU ACCORDÉ d'une brique, EN AJOUT
--   SEUL ; le niveau courant est celui du dernier événement. Types :
--   « initial » (déclaration, N2 au plus), « promotion » (palier par palier ;
--   N3 et N4 sur décision d'un ASSOCIÉ seulement, doublé ici), « abaissement »
--   (décision humaine), « retrogradation_auto » (incident majeur : N3 ou N4 → N2,
--   sans auteur). Le niveau EFFECTIF est calculé par le moteur pur
--   (`niveauEffectif`, packages/engines/src/autonomie) : plafond de la brique et
--   de l'agent, N4 réservé à R0, coupe-circuit.
-- - autonomie_coupe_circuit : coupe-circuit N4 du cabinet (aucune exécution
--   automatique vers le client), EN AJOUT SEUL ; l'état courant est le dernier.
--   Le lever (actif = faux) revient à un associé (doublé ici).

CREATE TABLE autonomie_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  brique_id uuid NOT NULL,
  gravite text NOT NULL CHECK (gravite IN ('mineur', 'majeur')),
  description text NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 2000),
  execution_id uuid,
  signale_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, brique_id) REFERENCES agents_briques (cabinet_id, id),
  FOREIGN KEY (cabinet_id, execution_id) REFERENCES agents_executions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, signale_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX autonomie_incidents_brique_idx ON autonomie_incidents (cabinet_id, brique_id, cree_le DESC);
ALTER TABLE autonomie_incidents ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON autonomie_incidents
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON autonomie_incidents AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON autonomie_incidents FROM missionpilot_app;

CREATE TRIGGER autonomie_incidents_ajout_seul BEFORE UPDATE OR DELETE ON autonomie_incidents
  FOR EACH ROW EXECUTE FUNCTION agents_ajout_seul();

-- L'exécution citée appartient à la brique.
CREATE FUNCTION controler_autonomie_incident() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NEW.execution_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM agents_executions e WHERE e.id = NEW.execution_id AND e.brique_id = NEW.brique_id) THEN
      RAISE EXCEPTION 'Incident : exécution d''une autre brique.' USING ERRCODE = 'MPG05';
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER autonomie_incidents_controle BEFORE INSERT ON autonomie_incidents
  FOR EACH ROW EXECUTE FUNCTION controler_autonomie_incident();

CREATE TABLE autonomie_evenements (
  id bigserial PRIMARY KEY,
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  brique_id uuid NOT NULL,
  type text NOT NULL CHECK (type IN ('initial', 'promotion', 'abaissement', 'retrogradation_auto')),
  niveau_avant text CHECK (niveau_avant IS NULL OR niveau_avant IN ('N0', 'N1', 'N2', 'N3', 'N4')),
  niveau_apres text NOT NULL CHECK (niveau_apres IN ('N0', 'N1', 'N2', 'N3', 'N4')),
  motif text NOT NULL CHECK (length(btrim(motif)) BETWEEN 1 AND 2000),
  auteur_id uuid,
  incident_id uuid,
  -- Éligibilité calculée par le moteur au moment d'une promotion (trace de la décision).
  evaluation jsonb CHECK (evaluation IS NULL OR jsonb_typeof(evaluation) = 'object'),
  cree_le timestamptz NOT NULL DEFAULT now(),
  CHECK ((type = 'initial') = (niveau_avant IS NULL)),
  CHECK ((type = 'retrogradation_auto') = (auteur_id IS NULL)),
  CHECK ((type = 'retrogradation_auto') = (incident_id IS NOT NULL)),
  FOREIGN KEY (cabinet_id, brique_id) REFERENCES agents_briques (cabinet_id, id),
  FOREIGN KEY (cabinet_id, auteur_id) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, incident_id) REFERENCES autonomie_incidents (cabinet_id, id)
);
CREATE INDEX autonomie_evenements_brique_idx ON autonomie_evenements (cabinet_id, brique_id, id DESC);
ALTER TABLE autonomie_evenements ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON autonomie_evenements
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON autonomie_evenements AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON autonomie_evenements FROM missionpilot_app;

CREATE TRIGGER autonomie_evenements_ajout_seul BEFORE UPDATE OR DELETE ON autonomie_evenements
  FOR EACH ROW EXECUTE FUNCTION agents_ajout_seul();

-- Rang d'un niveau (N0 → 0 … N4 → 4).
CREATE FUNCTION rang_niveau_autonomie(p text) RETURNS int
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT substr(p, 2, 1)::int $$;

-- Règles d'un changement de niveau, doublées en base (le code applique les mêmes).
CREATE FUNCTION controler_autonomie_evenement() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_courant text;
    v_max text;
    v_avant int;
    v_apres int;
  BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('autonomie:' || NEW.brique_id::text, 0));
    SELECT niveau_max INTO v_max FROM agents_briques WHERE id = NEW.brique_id;
    SELECT niveau_apres INTO v_courant FROM autonomie_evenements
      WHERE brique_id = NEW.brique_id ORDER BY id DESC LIMIT 1;
    IF NEW.type = 'initial' THEN
      IF v_courant IS NOT NULL THEN
        RAISE EXCEPTION 'Autonomie : niveau initial déjà posé.' USING ERRCODE = 'MPG03';
      END IF;
      IF rang_niveau_autonomie(NEW.niveau_apres) > 2 THEN
        RAISE EXCEPTION 'Autonomie : niveau initial N2 au plus.' USING ERRCODE = 'MPG03';
      END IF;
    ELSIF v_courant IS NULL OR NEW.niveau_avant <> v_courant THEN
      RAISE EXCEPTION 'Autonomie : niveau de départ périmé.' USING ERRCODE = 'MPG03';
    END IF;
    IF rang_niveau_autonomie(NEW.niveau_apres) > rang_niveau_autonomie(v_max) THEN
      RAISE EXCEPTION 'Autonomie : au-delà du plafond de la brique.' USING ERRCODE = 'MPG03';
    END IF;
    v_avant := CASE WHEN NEW.niveau_avant IS NULL THEN NULL ELSE rang_niveau_autonomie(NEW.niveau_avant) END;
    v_apres := rang_niveau_autonomie(NEW.niveau_apres);
    IF NEW.type = 'promotion' THEN
      IF v_apres <> v_avant + 1 THEN
        RAISE EXCEPTION 'Autonomie : promotion palier par palier.' USING ERRCODE = 'MPG03';
      END IF;
      IF v_apres >= 3 AND NOT EXISTS (
           SELECT 1 FROM utilisateurs u WHERE u.id = NEW.auteur_id AND u.actif
             AND 'associe' = ANY (u.roles)) THEN
        RAISE EXCEPTION 'Autonomie : promotion en N3 ou N4 sur décision d''un associé.'
          USING ERRCODE = 'MPG03';
      END IF;
    ELSIF NEW.type = 'abaissement' THEN
      IF v_apres >= v_avant THEN
        RAISE EXCEPTION 'Autonomie : un abaissement baisse le niveau.' USING ERRCODE = 'MPG03';
      END IF;
    ELSIF NEW.type = 'retrogradation_auto' THEN
      IF v_avant < 3 OR NEW.niveau_apres <> 'N2' OR NOT EXISTS (
           SELECT 1 FROM autonomie_incidents i WHERE i.id = NEW.incident_id
             AND i.brique_id = NEW.brique_id AND i.gravite = 'majeur') THEN
        RAISE EXCEPTION 'Autonomie : rétrogradation automatique mal formée.' USING ERRCODE = 'MPG03';
      END IF;
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER autonomie_evenements_controle BEFORE INSERT ON autonomie_evenements
  FOR EACH ROW EXECUTE FUNCTION controler_autonomie_evenement();

CREATE TABLE autonomie_coupe_circuit (
  id bigserial PRIMARY KEY,
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  actif boolean NOT NULL,
  motif text NOT NULL CHECK (length(btrim(motif)) BETWEEN 1 AND 1000),
  auteur_id uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (cabinet_id, auteur_id) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX autonomie_coupe_circuit_idx ON autonomie_coupe_circuit (cabinet_id, id DESC);
ALTER TABLE autonomie_coupe_circuit ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON autonomie_coupe_circuit
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON autonomie_coupe_circuit AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON autonomie_coupe_circuit FROM missionpilot_app;

CREATE TRIGGER autonomie_coupe_circuit_ajout_seul BEFORE UPDATE OR DELETE ON autonomie_coupe_circuit
  FOR EACH ROW EXECUTE FUNCTION agents_ajout_seul();

-- Lever le coupe-circuit revient à un associé.
CREATE FUNCTION controler_coupe_circuit() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NOT NEW.actif AND NOT EXISTS (
         SELECT 1 FROM utilisateurs u WHERE u.id = NEW.auteur_id AND u.actif
           AND 'associe' = ANY (u.roles)) THEN
      RAISE EXCEPTION 'Seul un associé lève le coupe-circuit N4.' USING ERRCODE = 'MPG03';
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER autonomie_coupe_circuit_controle BEFORE INSERT ON autonomie_coupe_circuit
  FOR EACH ROW EXECUTE FUNCTION controler_coupe_circuit();
