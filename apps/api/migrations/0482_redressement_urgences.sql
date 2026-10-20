-- Redressement : évaluations d'urgence (RED-01), EN AJOUT SEUL (SQLSTATE : voir 0480).
--
-- Grille fermée du moteur (15 questions, 5 domaines), renseignée par le consultant ; le résultat
-- (pourcentages pondérés et voyants) est la sortie de `evaluerUrgence`, conservée avec les réponses
-- et la version de la grille : la décision se rejoue.

CREATE TABLE red_urgences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  dossier_id uuid NOT NULL,
  grille_version int NOT NULL CHECK (grille_version >= 1),
  reponses jsonb NOT NULL CHECK (jsonb_typeof(reponses) = 'object' AND octet_length(reponses::text) <= 4000),
  resultat jsonb NOT NULL CHECK (jsonb_typeof(resultat) = 'object' AND octet_length(resultat::text) <= 8000),
  -- Copie du voyant global, pour filtrer sans ouvrir le résultat.
  voyant text NOT NULL CHECK (voyant IN ('vert', 'orange', 'rouge', 'non_evalue')),
  duree_secondes int CHECK (duree_secondes IS NULL OR duree_secondes BETWEEN 0 AND 86400),
  commentaire text CHECK (commentaire IS NULL OR length(commentaire) BETWEEN 1 AND 2000),
  saisi_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, dossier_id) REFERENCES red_dossiers (cabinet_id, id),
  FOREIGN KEY (cabinet_id, saisi_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX red_urgences_dossier_idx ON red_urgences (cabinet_id, dossier_id, cree_le DESC, id DESC);
ALTER TABLE red_urgences ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON red_urgences
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON red_urgences AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON red_urgences FROM missionpilot_app;
CREATE TRIGGER red_urgences_ajout_seul BEFORE UPDATE OR DELETE ON red_urgences
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_redressement();
CREATE TRIGGER red_urgences_01_mission_ouverte BEFORE INSERT ON red_urgences
  FOR EACH ROW EXECUTE FUNCTION red_controler_mission_ouverte();
CREATE TRIGGER red_urgences_plafond BEFORE INSERT ON red_urgences
  FOR EACH ROW EXECUTE FUNCTION red_controler_plafond('dossier_id', '200', 'évaluations d''urgence par dossier');
