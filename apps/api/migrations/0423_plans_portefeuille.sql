-- Priorisation du portefeuille d'initiatives (PLA-14, PRD complémentaire
-- §11.3) : score valeur, effort et risque ; optimisation sous contraintes de
-- budget et de capacité proposée par le moteur (`@missionpilot/engines`,
-- optimiserPortefeuille) ; arbitrage humain TRACÉ.
--
-- - `plan_portefeuille_evaluations` : notes (1 à 5) et charge en jours-homme
--   d'une initiative du plan, en versions (ajout seul) ; la courante est la
--   dernière. Le coût reste le budget de l'initiative (0180).
-- - `plan_portefeuille_arbitrages` : chaque arbitrage fige les contraintes,
--   la PROPOSITION recalculée par le moteur au moment de la décision (jamais
--   reçue du navigateur), la décision humaine (initiatives retenues) et un
--   motif pour chaque écart à la proposition (contrôlé par l'API et par le
--   déclencheur). Ajout seul : un nouvel arbitrage remplace le précédent sans
--   l'effacer.
--
-- SQLSTATE : MPS01 (ajout seul), MPS02 (version, initiative hors plan),
-- MPS08 (arbitrage incohérent : retenue hors plan, écart sans motif).

CREATE TABLE plan_portefeuille_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  plan_id uuid NOT NULL,
  initiative_id uuid NOT NULL,
  version integer NOT NULL CHECK (version BETWEEN 1 AND 10000),
  valeur smallint NOT NULL CHECK (valeur BETWEEN 1 AND 5),
  effort smallint NOT NULL CHECK (effort BETWEEN 1 AND 5),
  risque smallint NOT NULL CHECK (risque BETWEEN 1 AND 5),
  charge_jours integer NOT NULL CHECK (charge_jours BETWEEN 0 AND 100000),
  commentaire text CHECK (commentaire IS NULL OR length(commentaire) <= 1000),
  auteur_id uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (initiative_id, version),
  FOREIGN KEY (cabinet_id, plan_id, initiative_id) REFERENCES plan_elements (cabinet_id, plan_id, id),
  FOREIGN KEY (cabinet_id, auteur_id) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX plan_portefeuille_evaluations_idx
  ON plan_portefeuille_evaluations (cabinet_id, plan_id, initiative_id, version DESC);
ALTER TABLE plan_portefeuille_evaluations ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON plan_portefeuille_evaluations
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON plan_portefeuille_evaluations AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON plan_portefeuille_evaluations FROM missionpilot_app;

CREATE TRIGGER plan_portefeuille_evaluations_ajout_seul
  BEFORE UPDATE OR DELETE ON plan_portefeuille_evaluations
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_plan();

CREATE FUNCTION controler_plan_portefeuille_evaluation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_max integer;
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM plan_elements e WHERE e.id = NEW.initiative_id AND e.type = 'initiative') THEN
      RAISE EXCEPTION 'Évaluation réservée aux initiatives du plan.' USING ERRCODE = 'MPS02';
    END IF;
    SELECT max(version) INTO v_max FROM plan_portefeuille_evaluations
      WHERE initiative_id = NEW.initiative_id;
    IF NEW.version <> coalesce(v_max, 0) + 1 THEN
      RAISE EXCEPTION 'Numéro de version inattendu.' USING ERRCODE = 'MPS02';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER plan_portefeuille_evaluations_controle BEFORE INSERT ON plan_portefeuille_evaluations
  FOR EACH ROW EXECUTE FUNCTION controler_plan_portefeuille_evaluation();

CREATE TABLE plan_portefeuille_arbitrages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  plan_id uuid NOT NULL,
  -- Contraintes saisies (budget, capacité, poids, obligatoires, exclues).
  contraintes jsonb NOT NULL CHECK (jsonb_typeof(contraintes) = 'object'
    AND octet_length(contraintes::text) <= 50000),
  -- Proposition du moteur, figée : décisions, totaux, optimalité.
  proposition jsonb NOT NULL CHECK (jsonb_typeof(proposition) = 'object'
    AND octet_length(proposition::text) <= 200000),
  -- Décision humaine : identifiants des initiatives retenues.
  retenues jsonb NOT NULL CHECK (jsonb_typeof(retenues) = 'array'
    AND jsonb_array_length(retenues) <= 300),
  -- Motif de chaque écart à la proposition : [{initiative_id, motif}].
  motifs jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(motifs) = 'array'
    AND jsonb_array_length(motifs) <= 300 AND octet_length(motifs::text) <= 400000),
  commentaire text CHECK (commentaire IS NULL OR length(commentaire) <= 2000),
  moteur text NOT NULL CHECK (length(moteur) BETWEEN 1 AND 60),
  decide_par uuid NOT NULL,
  decide_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, plan_id) REFERENCES plans_strategiques (cabinet_id, id),
  FOREIGN KEY (cabinet_id, decide_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX plan_portefeuille_arbitrages_idx
  ON plan_portefeuille_arbitrages (cabinet_id, plan_id, decide_le DESC, id DESC);
ALTER TABLE plan_portefeuille_arbitrages ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON plan_portefeuille_arbitrages
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON plan_portefeuille_arbitrages AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON plan_portefeuille_arbitrages FROM missionpilot_app;

CREATE TRIGGER plan_portefeuille_arbitrages_ajout_seul
  BEFORE UPDATE OR DELETE ON plan_portefeuille_arbitrages
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_plan();

/*
 * Retenues : initiatives du plan (identifiants valides, distincts). Écarts :
 * toute initiative retenue que la proposition écarte, ou écartée qu'elle
 * retient, porte un motif non vide.
 */
CREATE FUNCTION controler_plan_portefeuille_arbitrage() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_ecart text;
  BEGIN
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.retenues) r (x)
               WHERE jsonb_typeof(x) <> 'string'
                  OR (x #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
       OR (SELECT count(DISTINCT x::uuid) FROM jsonb_array_elements_text(NEW.retenues) r (x))
          <> jsonb_array_length(NEW.retenues)
       OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(NEW.retenues) r (x)
                  WHERE NOT EXISTS (SELECT 1 FROM plan_elements e
                                    WHERE e.id = x::uuid AND e.plan_id = NEW.plan_id
                                      AND e.type = 'initiative')) THEN
      RAISE EXCEPTION 'Initiative retenue inconnue, en double ou hors du plan.' USING ERRCODE = 'MPS08';
    END IF;
    IF jsonb_typeof(NEW.proposition -> 'retenues') <> 'array' THEN
      RAISE EXCEPTION 'Proposition du moteur absente.' USING ERRCODE = 'MPS08';
    END IF;
    SELECT e INTO v_ecart FROM (
      (SELECT lower(x) AS e FROM jsonb_array_elements_text(NEW.retenues) r (x)
       EXCEPT SELECT lower(y) FROM jsonb_array_elements_text(NEW.proposition -> 'retenues') p (y))
      UNION
      (SELECT lower(y) FROM jsonb_array_elements_text(NEW.proposition -> 'retenues') p (y)
       EXCEPT SELECT lower(x) FROM jsonb_array_elements_text(NEW.retenues) r (x))) ecarts
    WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.motifs) m (o)
                      WHERE lower(o ->> 'initiative_id') = ecarts.e
                        AND length(btrim(coalesce(o ->> 'motif', ''))) > 0)
    LIMIT 1;
    IF v_ecart IS NOT NULL THEN
      RAISE EXCEPTION 'Écart à la proposition sans motif.' USING ERRCODE = 'MPS08';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER plan_portefeuille_arbitrages_controle BEFORE INSERT ON plan_portefeuille_arbitrages
  FOR EACH ROW EXECUTE FUNCTION controler_plan_portefeuille_arbitrage();
