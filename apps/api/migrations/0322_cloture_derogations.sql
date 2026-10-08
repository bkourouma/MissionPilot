-- Dérogations motivées à un item bloquant de la check-list de clôture (AUT-08).
--
-- Ajout seul (MPX01 pour la modification, MPX02 pour la garde de rôle) : une dérogation est
-- « accordée » puis éventuellement « retirée » par une NOUVELLE ligne ; la dernière ligne d'un
-- couple (mission, contrôle) fait foi. Accordée ou retirée par un directeur de mission ou un
-- associé actif seulement (règle doublée en base, MPX02). Le motif est obligatoire (10 à 500
-- caractères) : une dérogation sans motif ne se crée pas.
-- Codes SQLSTATE : MPX01 ajout seul, MPX02 auteur sans le rôle requis.

CREATE FUNCTION controler_derogation_cloture() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM utilisateurs u
                   WHERE u.cabinet_id = NEW.cabinet_id AND u.id = NEW.par AND u.actif
                     AND (u.roles && ARRAY['associe', 'directeur_mission']::text[])) THEN
      RAISE EXCEPTION 'Dérogation de clôture : réservée à un directeur de mission ou à un associé.'
        USING ERRCODE = 'MPX02';
    END IF;
    RETURN NEW;
  END $$;

CREATE TABLE cloture_derogations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  mission_id uuid NOT NULL,
  controle text NOT NULL CHECK (controle IN ('temps_valides', 'debours_traites', 'factures_emises',
    'livrables_signes', 'encaissements_soldes', 'satisfaction_demandee', 'capitalisation_faite')),
  action text NOT NULL CHECK (action IN ('accordee', 'retiree')),
  motif text NOT NULL CHECK (length(btrim(motif)) BETWEEN 10 AND 500),
  par uuid NOT NULL,
  le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, mission_id) REFERENCES missions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX cloture_derogations_idx
  ON cloture_derogations (cabinet_id, mission_id, controle, le DESC, id);
ALTER TABLE cloture_derogations ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON cloture_derogations
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON cloture_derogations AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON cloture_derogations FROM missionpilot_app;
CREATE TRIGGER cloture_derogations_ajout_seul BEFORE UPDATE OR DELETE ON cloture_derogations
  FOR EACH ROW EXECUTE FUNCTION cloture_ajout_seul();
CREATE TRIGGER cloture_derogations_role BEFORE INSERT ON cloture_derogations
  FOR EACH ROW EXECUTE FUNCTION controler_derogation_cloture();
