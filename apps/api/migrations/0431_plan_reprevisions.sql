-- Plan vivant (PLA-18) : re-prévisions trimestrielles.
--
-- `plan_reprevisions` enregistre chaque re-prévision d'un exercice, calculée par
-- le moteur `reprevoirExercice` (packages/engines, plan-strategique/reprevision)
-- à partir d'une version VALIDÉE du modèle financier (scénario de base) et des
-- réalisés courants : méthode, répartition, seuil, ENTRÉES FIGÉES (copie des
-- réalisés utilisés), RÉSULTAT du moteur (écarts, décomposition, faits) et
-- identifiant du moteur. Ajout seul : une re-prévision ne se modifie ni ne se
-- supprime ; les numéros de version, par (plan, exercice), sont strictement
-- séquentiels. Le plan validé et la version du modèle ne sont JAMAIS modifiés :
-- cette table ne fait que les référencer (clé étrangère composite).
--
-- Volume borné : au plus 40 re-prévisions par exercice (MQL23) ; entrées
-- d'au plus 20 Kio, résultat d'au plus 200 Kio.
--
-- Table à RLS : politique `isolation` (cabinet) et politique RESTRICTIVE
-- `portail_interdit` (états financiers du client : jamais au portail).
-- SQLSTATE : voir l'en-tête de 0430 (MQL19 à MQL24 pour cette table).

CREATE TABLE plan_reprevisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  plan_id uuid NOT NULL,
  modele_version_id uuid NOT NULL,
  exercice integer NOT NULL CHECK (exercice BETWEEN 2000 AND 2100),
  version integer NOT NULL CHECK (version BETWEEN 1 AND 40),
  dernier_trimestre integer NOT NULL CHECK (dernier_trimestre BETWEEN 1 AND 4),
  methode text NOT NULL CHECK (methode IN ('reste_du_plan', 'tendance')),
  repartition jsonb NOT NULL CHECK (jsonb_typeof(repartition) = 'array'
    AND jsonb_array_length(repartition) = 4),
  seuil_pour_mille integer NOT NULL CHECK (seuil_pour_mille BETWEEN 1 AND 1000),
  -- Copie des réalisés utilisés : [{trimestre, version, chiffreAffaires, ...}], 1 à 4 éléments.
  entrees jsonb NOT NULL CHECK (jsonb_typeof(entrees) = 'array'
    AND jsonb_array_length(entrees) BETWEEN 1 AND 4
    AND octet_length(entrees::text) <= 20000),
  resultat jsonb NOT NULL CHECK (jsonb_typeof(resultat) = 'object'
    AND octet_length(resultat::text) <= 200000),
  moteur text NOT NULL CHECK (length(moteur) BETWEEN 1 AND 60),
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (plan_id, exercice, version),
  FOREIGN KEY (cabinet_id, plan_id) REFERENCES plans_strategiques (cabinet_id, id),
  FOREIGN KEY (cabinet_id, modele_version_id) REFERENCES plan_modele_versions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX plan_reprevisions_plan_idx
  ON plan_reprevisions (cabinet_id, plan_id, cree_le DESC, id DESC);
ALTER TABLE plan_reprevisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON plan_reprevisions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON plan_reprevisions AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON plan_reprevisions FROM missionpilot_app;

CREATE FUNCTION refuser_modification_reprevision() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    RAISE EXCEPTION 'Une re-prévision enregistrée ne se modifie ni ne se supprime.'
      USING ERRCODE = 'MQL19';
  END $$;
CREATE TRIGGER plan_reprevisions_ajout_seul
  BEFORE UPDATE OR DELETE ON plan_reprevisions
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_reprevision();

/*
 * Version du modèle du MÊME plan et VALIDÉE, numéro de version séquentiel par
 * (plan, exercice), plafond par exercice, cohérence des entrées figées et du
 * résultat avec les colonnes (méthode, nombre de trimestres, répartition, seuil).
 */
CREATE FUNCTION controler_plan_reprevision() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_max integer;
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM plan_modele_versions v
                   WHERE v.id = NEW.modele_version_id AND v.plan_id = NEW.plan_id) THEN
      RAISE EXCEPTION 'Version du modèle financier d''un autre plan.' USING ERRCODE = 'MQL20';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM plan_modele_validations x
                   WHERE x.modele_version_id = NEW.modele_version_id) THEN
      RAISE EXCEPTION 'La version du modèle financier doit être validée.' USING ERRCODE = 'MQL21';
    END IF;
    SELECT max(version) INTO v_max FROM plan_reprevisions
      WHERE plan_id = NEW.plan_id AND exercice = NEW.exercice;
    IF NEW.version IS DISTINCT FROM coalesce(v_max, 0) + 1 THEN
      RAISE EXCEPTION 'Numéro de version de re-prévision non séquentiel.' USING ERRCODE = 'MQL22';
    END IF;
    IF NEW.version > 40 THEN
      RAISE EXCEPTION 'Un exercice compte au plus 40 re-prévisions.' USING ERRCODE = 'MQL23';
    END IF;
    IF jsonb_array_length(NEW.entrees) IS DISTINCT FROM NEW.dernier_trimestre
       OR (NEW.resultat ->> 'trimestresRealises') IS DISTINCT FROM NEW.dernier_trimestre::text
       OR (NEW.resultat ->> 'methode') IS DISTINCT FROM NEW.methode
       OR (NEW.resultat ->> 'seuilEcartPourMille') IS DISTINCT FROM NEW.seuil_pour_mille::text
       OR (NEW.resultat -> 'repartition') IS DISTINCT FROM NEW.repartition
       OR (NEW.resultat ->> 'moteur') IS DISTINCT FROM NEW.moteur THEN
      RAISE EXCEPTION 'Re-prévision incohérente avec ses entrées figées ou son résultat.'
        USING ERRCODE = 'MQL24';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER plan_reprevisions_controle BEFORE INSERT ON plan_reprevisions
  FOR EACH ROW EXECUTE FUNCTION controler_plan_reprevision();
