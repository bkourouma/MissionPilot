-- Occurrences d'un avis (AO-01) : où et quand il a été vu, en AJOUT SEUL ; voir 0364.

CREATE TABLE ao_veille_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  resultat_id uuid NOT NULL,
  source_code text NOT NULL CHECK (source_code ~ '^[a-z0-9_]{1,40}$'),
  source_libelle text NOT NULL CHECK (length(source_libelle) BETWEEN 1 AND 150),
  jour date NOT NULL CHECK (jour BETWEEN '2000-01-01' AND '2100-12-31'),
  vu_le timestamptz NOT NULL DEFAULT now(),
  cree_par uuid NOT NULL,
  UNIQUE (cabinet_id, id),
  -- Une source n'ajoute qu'une occurrence par avis et par jour (collecte rejouée = sans effet).
  UNIQUE (resultat_id, source_code, jour),
  FOREIGN KEY (cabinet_id, resultat_id) REFERENCES ao_veille_resultats (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE ao_veille_occurrences ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON ao_veille_occurrences
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON ao_veille_occurrences AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON ao_veille_occurrences FROM missionpilot_app;
CREATE TRIGGER ao_veille_occurrences_ajout_seul BEFORE UPDATE OR DELETE ON ao_veille_occurrences
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_veille();

-- Plafond d'occurrences par résultat : MQA04.
CREATE FUNCTION plafonner_occurrences_veille() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF (SELECT count(*) FROM ao_veille_occurrences o WHERE o.resultat_id = NEW.resultat_id) >= 500 THEN
      RAISE EXCEPTION 'Plafond d''occurrences atteint pour ce résultat.' USING ERRCODE = 'MQA04';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER ao_veille_occurrences_plafond BEFORE INSERT ON ao_veille_occurrences
  FOR EACH ROW EXECUTE FUNCTION plafonner_occurrences_veille();
