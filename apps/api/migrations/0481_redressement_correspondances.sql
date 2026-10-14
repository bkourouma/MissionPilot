-- Redressement : correspondance de postes (RED-02). Une version par enregistrement, la dernière
-- est la courante ; EN AJOUT SEUL (SQLSTATE : voir 0480, MPZ01 à MPZ11).
--
-- Un poste de ratio (stocks, créances clients, dettes financières...) est relié aux codes des
-- lignes de l'état financier du client (le code est celui du plan comptable du client). Les ratios
-- sont calculés à la lecture par le moteur ; la correspondance n'est qu'une table de rattachement.

CREATE TABLE red_correspondances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  dossier_id uuid NOT NULL,
  version int NOT NULL CHECK (version >= 1),
  -- { "<poste>": { "codes": ["BB"], "sans_objet": false } } : forme validée par le schéma partagé
  -- et par le moteur.
  postes jsonb NOT NULL CHECK (jsonb_typeof(postes) = 'object' AND octet_length(postes::text) <= 20000),
  motif text CHECK (motif IS NULL OR length(motif) BETWEEN 1 AND 500),
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, dossier_id, version),
  FOREIGN KEY (cabinet_id, dossier_id) REFERENCES red_dossiers (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE red_correspondances ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON red_correspondances
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON red_correspondances AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON red_correspondances FROM missionpilot_app;
CREATE TRIGGER red_correspondances_ajout_seul BEFORE UPDATE OR DELETE ON red_correspondances
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_redressement();
CREATE TRIGGER red_correspondances_01_mission_ouverte BEFORE INSERT ON red_correspondances
  FOR EACH ROW EXECUTE FUNCTION red_controler_mission_ouverte();
CREATE TRIGGER red_correspondances_plafond BEFORE INSERT ON red_correspondances
  FOR EACH ROW EXECUTE FUNCTION red_controler_plafond('dossier_id', '100', 'versions de correspondance par dossier');
CREATE TRIGGER red_correspondances_version BEFORE INSERT ON red_correspondances
  FOR EACH ROW EXECUTE FUNCTION red_controler_version('dossier_id');
