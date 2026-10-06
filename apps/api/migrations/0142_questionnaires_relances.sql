-- Relances des répondants (DECISIONS.md, V2 : automatiques à J+3 puis J+7,
-- relance manuelle possible). Historique en AJOUT SEUL. L'index unique
-- (répondant, palier) rend les relances automatiques idempotentes : un
-- double passage du job, ou deux workers, ne relancent qu'une fois.

CREATE TABLE questionnaire_relances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  envoi_id uuid NOT NULL,
  repondant_id uuid NOT NULL,
  nature text NOT NULL CHECK (nature IN ('j3', 'j7', 'manuelle')),
  relance_par uuid,
  relance_le timestamptz NOT NULL DEFAULT now(),
  CHECK ((nature = 'manuelle') = (relance_par IS NOT NULL)),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, envoi_id) REFERENCES questionnaire_envois (cabinet_id, id),
  FOREIGN KEY (cabinet_id, repondant_id) REFERENCES questionnaire_repondants (cabinet_id, id),
  FOREIGN KEY (cabinet_id, relance_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE UNIQUE INDEX questionnaire_relances_auto_uniq ON questionnaire_relances (cabinet_id, repondant_id, nature)
  WHERE nature <> 'manuelle';
CREATE INDEX questionnaire_relances_envoi_idx ON questionnaire_relances (cabinet_id, envoi_id, relance_le);
ALTER TABLE questionnaire_relances ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON questionnaire_relances
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE UPDATE, DELETE ON questionnaire_relances FROM missionpilot_app;

CREATE FUNCTION refuser_modification_relance_questionnaire() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    RAISE EXCEPTION 'L''historique des relances est en ajout seul.' USING ERRCODE = 'MPQ05';
  END $$;
CREATE TRIGGER questionnaire_relances_ajout_seul BEFORE UPDATE OR DELETE ON questionnaire_relances
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_relance_questionnaire();
