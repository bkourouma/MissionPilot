-- Liens assertion <-> preuve (PRV-02) et arbitrage des contradictions (PRV-04).
--
-- - assertion_preuve_liens : JOURNAL des liens, en ajout seul. `lier` attache une preuve à une
--   assertion avec un sens (pour ou contre) ; `delier` la détache ; l'état courant d'un couple
--   est son dernier événement (numéro le plus grand). Changer le sens = lier à nouveau.
-- - preuve_arbitrages : décision du consultant sur une preuve « contre » (qui, quand, décision,
--   motif), en ajout seul. Elle vise la VERSION de la preuve qu'il a lue (MPV05) : corriger la
--   preuve rouvre la contradiction, et une décision ne vaut que pour un lien « contre » courant.
--
-- La solidité qui en résulte se calcule dans packages/engines/src/preuves, jamais ici.
-- Portail client : jamais (politique restrictive `portail_interdit`).

CREATE TABLE assertion_preuve_liens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  numero bigint GENERATED ALWAYS AS IDENTITY,
  mission_id uuid NOT NULL,
  assertion_id uuid NOT NULL,
  preuve_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('lier', 'delier')),
  sens text CHECK (sens IN ('pour', 'contre')),
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  CHECK ((action = 'lier') = (sens IS NOT NULL)),
  FOREIGN KEY (cabinet_id, mission_id) REFERENCES missions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, assertion_id) REFERENCES assertions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, preuve_id) REFERENCES preuves (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX assertion_preuve_liens_couple_idx
  ON assertion_preuve_liens (cabinet_id, assertion_id, preuve_id, numero DESC);
CREATE INDEX assertion_preuve_liens_mission_idx ON assertion_preuve_liens (cabinet_id, mission_id);
ALTER TABLE assertion_preuve_liens ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON assertion_preuve_liens
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON assertion_preuve_liens AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON assertion_preuve_liens FROM missionpilot_app;
CREATE TRIGGER assertion_preuve_liens_ajout_seul BEFORE UPDATE OR DELETE ON assertion_preuve_liens
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_preuves();

-- L'assertion et la preuve appartiennent à la mission du lien (MPV02) ; on ne délie que ce qui
-- est lié.
CREATE FUNCTION controler_assertion_preuve_lien() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_dernier text;
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM assertions a WHERE a.id = NEW.assertion_id
                   AND a.mission_id = NEW.mission_id)
       OR NOT EXISTS (SELECT 1 FROM preuves p WHERE p.id = NEW.preuve_id
                      AND p.mission_id = NEW.mission_id) THEN
      RAISE EXCEPTION 'L''assertion et la preuve doivent appartenir à la mission du lien.'
        USING ERRCODE = 'MPV02';
    END IF;
    IF NEW.action = 'delier' THEN
      SELECT l.action INTO v_dernier FROM assertion_preuve_liens l
        WHERE l.assertion_id = NEW.assertion_id AND l.preuve_id = NEW.preuve_id
        ORDER BY l.numero DESC LIMIT 1;
      IF v_dernier IS DISTINCT FROM 'lier' THEN
        RAISE EXCEPTION 'Cette preuve n''est pas liée à l''assertion.' USING ERRCODE = 'MPV02';
      END IF;
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER assertion_preuve_liens_controle BEFORE INSERT ON assertion_preuve_liens
  FOR EACH ROW EXECUTE FUNCTION controler_assertion_preuve_lien();

CREATE TABLE preuve_arbitrages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  numero bigint GENERATED ALWAYS AS IDENTITY,
  mission_id uuid NOT NULL,
  assertion_id uuid NOT NULL,
  preuve_id uuid NOT NULL,
  preuve_version int NOT NULL CHECK (preuve_version >= 1),
  decision text NOT NULL CHECK (decision IN ('contradiction_levee', 'contradiction_maintenue')),
  motif text NOT NULL CHECK (length(motif) BETWEEN 1 AND 1000),
  arbitre_par uuid NOT NULL,
  arbitre_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, mission_id) REFERENCES missions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, assertion_id) REFERENCES assertions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, preuve_id, preuve_version)
    REFERENCES preuve_versions (cabinet_id, preuve_id, version),
  FOREIGN KEY (cabinet_id, arbitre_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX preuve_arbitrages_couple_idx
  ON preuve_arbitrages (cabinet_id, assertion_id, preuve_id, numero DESC);
CREATE INDEX preuve_arbitrages_mission_idx ON preuve_arbitrages (cabinet_id, mission_id);
ALTER TABLE preuve_arbitrages ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON preuve_arbitrages
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON preuve_arbitrages AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON preuve_arbitrages FROM missionpilot_app;
CREATE TRIGGER preuve_arbitrages_ajout_seul BEFORE UPDATE OR DELETE ON preuve_arbitrages
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_preuves();

-- Arbitrage : la mission est celle de l'assertion, le lien courant est « contre » et la version
-- arbitrée est la version courante de la preuve (MPV05).
CREATE FUNCTION controler_preuve_arbitrage() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_lien record;
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM assertions a WHERE a.id = NEW.assertion_id
                   AND a.mission_id = NEW.mission_id) THEN
      RAISE EXCEPTION 'L''assertion n''appartient pas à la mission.' USING ERRCODE = 'MPV02';
    END IF;
    SELECT l.action, l.sens INTO v_lien FROM assertion_preuve_liens l
      WHERE l.assertion_id = NEW.assertion_id AND l.preuve_id = NEW.preuve_id
      ORDER BY l.numero DESC LIMIT 1;
    IF v_lien.action IS DISTINCT FROM 'lier' OR v_lien.sens IS DISTINCT FROM 'contre' THEN
      RAISE EXCEPTION 'Seule une preuve liée « contre » l''assertion s''arbitre.'
        USING ERRCODE = 'MPV05';
    END IF;
    IF NEW.preuve_version <> (SELECT max(v.version) FROM preuve_versions v
                              WHERE v.preuve_id = NEW.preuve_id) THEN
      RAISE EXCEPTION 'La preuve a été corrigée depuis : arbitrer sa version courante.'
        USING ERRCODE = 'MPV05';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER preuve_arbitrages_controle BEFORE INSERT ON preuve_arbitrages
  FOR EACH ROW EXECUTE FUNCTION controler_preuve_arbitrage();
