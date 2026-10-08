-- Satisfaction du client (QUA-08) : note de recommandation de 0 à 10 (NPS) à chaque jalon et à la
-- clôture de la mission.
--
-- La note est saisie par un membre du cabinet pour le compte du client (le portail n'écrit pas
-- ici : table `portail_interdit`). Ajout seul : une correction est une NOUVELLE ligne de même
-- clé (`cle` = identifiant du jalon, ou « cloture ») et de rang supérieur ; la dernière fait foi.
-- L'agrégat NPS (promoteurs 9–10, détracteurs 0–6) est calculé par le code, jamais en SQL.

CREATE TABLE qualite_satisfactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  mission_id uuid NOT NULL,
  moment text NOT NULL CHECK (moment IN ('jalon', 'cloture')),
  jalon_id uuid,
  cle text NOT NULL CHECK (length(cle) BETWEEN 1 AND 36),
  rang integer NOT NULL CHECK (rang >= 1),
  note integer NOT NULL CHECK (note BETWEEN 0 AND 10),
  commentaire text CHECK (commentaire IS NULL OR length(btrim(commentaire)) BETWEEN 1 AND 2000),
  repondant text CHECK (repondant IS NULL OR length(btrim(repondant)) BETWEEN 1 AND 200),
  saisi_par uuid NOT NULL,
  saisi_le timestamptz NOT NULL DEFAULT now(),
  CHECK ((moment = 'jalon') = (jalon_id IS NOT NULL)),
  CHECK ((moment = 'cloture' AND cle = 'cloture') OR (moment = 'jalon' AND cle = jalon_id::text)),
  UNIQUE (cabinet_id, id),
  UNIQUE (mission_id, cle, rang),
  FOREIGN KEY (cabinet_id, mission_id) REFERENCES missions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, mission_id, jalon_id) REFERENCES mission_jalons (cabinet_id, mission_id, id),
  FOREIGN KEY (cabinet_id, saisi_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX qualite_satisfactions_idx ON qualite_satisfactions (cabinet_id, mission_id, saisi_le);
ALTER TABLE qualite_satisfactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON qualite_satisfactions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON qualite_satisfactions AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON qualite_satisfactions FROM missionpilot_app;
CREATE TRIGGER qualite_satisfactions_ajout_seul BEFORE UPDATE OR DELETE ON qualite_satisfactions
  FOR EACH ROW EXECUTE FUNCTION qualite_ajout_seul();
