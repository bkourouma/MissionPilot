-- Calibration entre évaluateurs (NOT-13, PRD complémentaire §4.5 et §11.1) : sessions de
-- calibrage, double cotation d'un échantillon de cas, écart mesuré par le moteur
-- (`mesurerCalibration`, jamais en SQL).
--
-- - Une session porte la liste figée de ses cas (code et libellé), l'échelle et la tolérance ;
--   elle peut citer la notation dont l'échantillon est tiré (lecture soumise à la visibilité de
--   sa mission, contrôle de l'API). Elle se clôt une fois, avec une conclusion, par un expert
--   métier actif (MPN11) ; rien d'autre ne change.
-- - Une cotation : un cas de la session, un niveau de l'échelle, un évaluateur, une seule fois ;
--   ajout seul, refusée sur une session close (MPN11).

CREATE TABLE notation_calibrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  titre text NOT NULL CHECK (length(btrim(titre)) BETWEEN 1 AND 200),
  cas jsonb NOT NULL CHECK (jsonb_typeof(cas) = 'array' AND jsonb_array_length(cas) BETWEEN 1 AND 200
    AND octet_length(cas::text) <= 100000),
  niveaux int NOT NULL DEFAULT 5 CHECK (niveaux BETWEEN 2 AND 10),
  tolerance int NOT NULL DEFAULT 0 CHECK (tolerance >= 0 AND tolerance < niveaux),
  notation_id uuid,
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  cloturee_par uuid,
  cloturee_le timestamptz,
  conclusion text CHECK (conclusion IS NULL OR length(btrim(conclusion)) BETWEEN 1 AND 4000),
  CHECK ((cloturee_par IS NULL) = (cloturee_le IS NULL)),
  CHECK ((cloturee_par IS NULL) = (conclusion IS NULL)),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, notation_id) REFERENCES notations (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cloturee_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX notation_calibrations_tri_idx ON notation_calibrations (cabinet_id, cree_le DESC, id DESC);
ALTER TABLE notation_calibrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON notation_calibrations
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON notation_calibrations AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE DELETE ON notation_calibrations FROM missionpilot_app;

CREATE FUNCTION controler_notation_calibration() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'INSERT' THEN
      IF NEW.cloturee_par IS NOT NULL THEN
        RAISE EXCEPTION 'Une session de calibrage se crée ouverte.' USING ERRCODE = 'MPN11';
      END IF;
      RETURN NEW;
    END IF;
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Une session de calibrage ne se supprime pas.' USING ERRCODE = 'MPN11';
    END IF;
    IF OLD.cloturee_par IS NOT NULL THEN
      RAISE EXCEPTION 'Une session de calibrage close est figée.' USING ERRCODE = 'MPN11';
    END IF;
    IF (NEW.id, NEW.cabinet_id, NEW.titre, NEW.cas, NEW.niveaux, NEW.tolerance, NEW.notation_id,
        NEW.cree_par, NEW.cree_le)
       IS DISTINCT FROM (OLD.id, OLD.cabinet_id, OLD.titre, OLD.cas, OLD.niveaux, OLD.tolerance,
        OLD.notation_id, OLD.cree_par, OLD.cree_le) THEN
      RAISE EXCEPTION 'Seule la clôture modifie une session de calibrage.' USING ERRCODE = 'MPN11';
    END IF;
    IF NEW.cloturee_par IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM utilisateurs u WHERE u.id = NEW.cloturee_par AND u.actif
         AND 'expert_metier' = ANY (u.roles)) THEN
      RAISE EXCEPTION 'Seul un expert métier clôt une session de calibrage.' USING ERRCODE = 'MPN11';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER notation_calibrations_controle BEFORE INSERT OR UPDATE OR DELETE ON notation_calibrations
  FOR EACH ROW EXECUTE FUNCTION controler_notation_calibration();

CREATE TABLE notation_calibration_cotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  calibration_id uuid NOT NULL,
  cas text NOT NULL CHECK (cas ~ '^[a-z0-9][a-z0-9_.-]{0,79}$'),
  evaluateur_id uuid NOT NULL,
  niveau int NOT NULL CHECK (niveau BETWEEN 1 AND 10),
  motif text CHECK (motif IS NULL OR length(btrim(motif)) BETWEEN 1 AND 2000),
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, calibration_id, cas, evaluateur_id),
  FOREIGN KEY (cabinet_id, calibration_id) REFERENCES notation_calibrations (cabinet_id, id),
  FOREIGN KEY (cabinet_id, evaluateur_id) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE notation_calibration_cotations ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON notation_calibration_cotations
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON notation_calibration_cotations AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON notation_calibration_cotations FROM missionpilot_app;

CREATE FUNCTION controler_notation_calibration_cotation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_session notation_calibrations%ROWTYPE;
  BEGIN
    IF TG_OP <> 'INSERT' THEN
      RAISE EXCEPTION 'Une cotation de calibrage est en ajout seul.' USING ERRCODE = 'MPN11';
    END IF;
    -- Verrou : la clôture et les cotations de la session sont sérialisées.
    SELECT * INTO v_session FROM notation_calibrations c WHERE c.id = NEW.calibration_id FOR SHARE;
    IF v_session.cloturee_par IS NOT NULL THEN
      RAISE EXCEPTION 'La session de calibrage est close.' USING ERRCODE = 'MPN11';
    END IF;
    IF NEW.niveau > v_session.niveaux
       OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_session.cas) x WHERE x ->> 'code' = NEW.cas) THEN
      RAISE EXCEPTION 'Cas inconnu de la session ou niveau hors échelle.' USING ERRCODE = 'MPN11';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER notation_calibration_cotations_controle
  BEFORE INSERT OR UPDATE OR DELETE ON notation_calibration_cotations
  FOR EACH ROW EXECUTE FUNCTION controler_notation_calibration_cotation();
