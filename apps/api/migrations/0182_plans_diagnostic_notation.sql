-- Diagnostic du plan stratégique : lien vers une notation PUBLIÉE (service #1,
-- PLA-02 ; annoncé par 0180).
--
-- Historique en ajout seul : chaque ligne fixe le lien courant du plan (rang
-- suivant) ; `notation_version_id` NULL retire le lien. Le lien courant est la
-- ligne de plus grand rang. La version liée doit être PUBLIÉE (statut dérivé
-- des événements de revue, 0146 : une version publiée est immuable) et porter
-- sur le même client que la mission du plan ; une notation menée dans une
-- autre mission du même client est admise (l'API exige en plus que
-- l'utilisateur voie cette mission). Aucun chiffre n'est copié : score et
-- classe se relisent dans la version publiée, par le moteur de notation.
--
-- Invisible du portail (`portail_interdit`) tant qu'aucune route du portail ne
-- sert le plan. SQLSTATE : MPS01 (ajout seul), MPS02 (rang ou lien inchangé),
-- MPS05 (plafond de l'historique), MPS06 (notation non publiée ou d'un autre
-- client).

CREATE TABLE plan_diagnostic_notations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  plan_id uuid NOT NULL,
  rang integer NOT NULL CHECK (rang >= 1),
  notation_version_id uuid,
  lie_par uuid NOT NULL,
  lie_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (plan_id, rang),
  FOREIGN KEY (cabinet_id, plan_id) REFERENCES plans_strategiques (cabinet_id, id),
  FOREIGN KEY (cabinet_id, notation_version_id) REFERENCES notation_versions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, lie_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX plan_diagnostic_notations_idx ON plan_diagnostic_notations (cabinet_id, plan_id, rang DESC);
ALTER TABLE plan_diagnostic_notations ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON plan_diagnostic_notations
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON plan_diagnostic_notations AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON plan_diagnostic_notations FROM missionpilot_app;

CREATE TRIGGER plan_diagnostic_notations_ajout_seul BEFORE UPDATE OR DELETE ON plan_diagnostic_notations
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_plan();

-- Rang suivant, au plus 200 changements de lien par plan, lien différent du
-- lien courant, version publiée d'une notation du client de la mission du plan.
CREATE FUNCTION controler_plan_diagnostic_notation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_courant plan_diagnostic_notations%ROWTYPE;
  BEGIN
    SELECT * INTO v_courant FROM plan_diagnostic_notations
      WHERE plan_id = NEW.plan_id ORDER BY rang DESC LIMIT 1;
    IF coalesce(v_courant.rang, 0) >= 200 THEN
      RAISE EXCEPTION 'Un plan compte au plus 200 changements de lien vers une notation.'
        USING ERRCODE = 'MPS05';
    END IF;
    IF NEW.rang <> coalesce(v_courant.rang, 0) + 1 THEN
      RAISE EXCEPTION 'Rang de lien inattendu.' USING ERRCODE = 'MPS02';
    END IF;
    IF NEW.notation_version_id IS NOT DISTINCT FROM v_courant.notation_version_id THEN
      RAISE EXCEPTION 'Le lien vers la notation est inchangé.' USING ERRCODE = 'MPS02';
    END IF;
    IF NEW.notation_version_id IS NOT NULL THEN
      IF notation_version_statut(NEW.notation_version_id) <> 'publiee' THEN
        RAISE EXCEPTION 'Seule une notation publiée se lie au diagnostic.' USING ERRCODE = 'MPS06';
      END IF;
      IF NOT EXISTS (
           SELECT 1
           FROM notation_versions v
           JOIN notations n ON n.id = v.notation_id
           JOIN plans_strategiques p ON p.id = NEW.plan_id
           JOIN missions m ON m.id = p.mission_id
           WHERE v.id = NEW.notation_version_id AND n.client_id = m.client_id) THEN
        RAISE EXCEPTION 'La notation porte sur un autre client que le plan.' USING ERRCODE = 'MPS06';
      END IF;
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER plan_diagnostic_notations_controle BEFORE INSERT ON plan_diagnostic_notations
  FOR EACH ROW EXECUTE FUNCTION controler_plan_diagnostic_notation();
