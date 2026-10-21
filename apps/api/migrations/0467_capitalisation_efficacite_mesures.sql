-- Capitalisation (lot CAP, lot 5b) — efficacité des recommandations (CAP-03), instantanés.
--
-- À chaque « mesurer l'effet », l'API inscrit un instantané CALCULÉ PAR LE MOTEUR
-- (packages/engines/src/capitalisation/efficacite.ts) : valeur de base, valeur d'effet, cible,
-- part de l'écart comblée, score 0 à 100. Ajout seul (MQK01) ; le dernier instantané d'une
-- recommandation fait foi. Non évaluable : score nul et raison explicite. SQLSTATE : voir 0466.

CREATE TABLE cap_efficacite_mesures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  recommandation_id uuid NOT NULL,
  evaluable boolean NOT NULL,
  score smallint CHECK (score BETWEEN 0 AND 100),
  raison_code text CHECK (raison_code IS NULL OR length(raison_code) BETWEEN 1 AND 60),
  raison text CHECK (raison IS NULL OR length(raison) BETWEEN 1 AND 500),
  delai_effet_jours smallint NOT NULL CHECK (delai_effet_jours BETWEEN 0 AND 3650),
  base_date date,
  base_valeur numeric CHECK (base_valeur IS NULL OR abs(base_valeur) < 1e15),
  effet_date date,
  effet_valeur numeric CHECK (effet_valeur IS NULL OR abs(effet_valeur) < 1e15),
  cible numeric NOT NULL CHECK (abs(cible) < 1e15),
  ecart_attendu numeric,
  ecart_realise numeric,
  part_comblee_pour_mille integer CHECK (part_comblee_pour_mille BETWEEN -100000 AND 100000),
  resultat jsonb NOT NULL CHECK (jsonb_typeof(resultat) = 'object'),
  calcule_par uuid NOT NULL,
  calcule_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, recommandation_id) REFERENCES cap_recommandations (cabinet_id, id),
  FOREIGN KEY (cabinet_id, calcule_par) REFERENCES utilisateurs (cabinet_id, id),
  CHECK (evaluable = (score IS NOT NULL)),
  CHECK (evaluable OR raison IS NOT NULL)
);
CREATE INDEX cap_efficacite_mesures_dernier_idx
  ON cap_efficacite_mesures (cabinet_id, recommandation_id, calcule_le DESC, id DESC);
ALTER TABLE cap_efficacite_mesures ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON cap_efficacite_mesures
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON cap_efficacite_mesures AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON cap_efficacite_mesures FROM missionpilot_app;
CREATE TRIGGER cap_efficacite_mesures_ajout_seul
  BEFORE UPDATE OR DELETE ON cap_efficacite_mesures
  FOR EACH ROW EXECUTE FUNCTION cap_efficacite_ajout_seul();

CREATE FUNCTION controler_cap_efficacite_mesure() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM cap_recommandations r
                   WHERE r.id = NEW.recommandation_id AND r.statut = 'mise_en_oeuvre') THEN
      RAISE EXCEPTION 'L''effet ne se mesure que pour une recommandation mise en oeuvre.'
        USING ERRCODE = 'MQK05';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER cap_efficacite_mesures_controle BEFORE INSERT ON cap_efficacite_mesures
  FOR EACH ROW EXECUTE FUNCTION controler_cap_efficacite_mesure();
