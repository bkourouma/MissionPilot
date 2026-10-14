-- Redressement : seuils d'alerte par secteur et scores d'alerte précoce (RED-10). SQLSTATE : voir 0480.
--
-- - red_seuils_versions : seuils d'un secteur, par cabinet, fixés par les experts du cabinet.
--   Versionnés ; une version est rédigée (brouillon) puis PUBLIÉE par un expert métier ou un
--   associé qui n'en est pas l'auteur (sauf associé), règle doublée par l'API (MPZ07). Seule
--   transition admise : brouillon -> publiee, sur la DERNIÈRE version du secteur. La version en
--   vigueur est la plus haute version publiée ; sans version publiée, le moteur applique ses
--   valeurs par défaut (provisoires, DECISIONS.md).
-- - red_scores : un enregistrement par calcul, EN AJOUT SEUL, conservé avec ses entrées, l'instantané
--   COMPLET des seuils appliqués et la version du moteur : il se rejoue à l'identique. Un score ne
--   référence que des seuils publiés, du même secteur, identiques à son instantané (MPZ02). Le
--   déclencheur ne recalcule pas le résultat (pas de calcul en base : SECURITY.md §15).

CREATE TABLE red_seuils_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  secteur text NOT NULL
    CHECK (secteur IN ('general', 'industrie', 'commerce', 'services', 'btp', 'agriculture')),
  version int NOT NULL CHECK (version >= 1),
  -- Forme de SeuilsAlerte (moteur), revalidée par `validerSeuilsAlerte` côté API.
  seuils jsonb NOT NULL CHECK (jsonb_typeof(seuils) = 'object' AND octet_length(seuils::text) <= 8000),
  statut text NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon', 'publiee')),
  motif text CHECK (motif IS NULL OR length(motif) BETWEEN 1 AND 500),
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  publiee_par uuid,
  publiee_le timestamptz,
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, secteur, version),
  CHECK ((statut = 'publiee') = (publiee_par IS NOT NULL AND publiee_le IS NOT NULL)),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, publiee_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX red_seuils_versions_secteur_idx
  ON red_seuils_versions (cabinet_id, secteur, version DESC);
ALTER TABLE red_seuils_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON red_seuils_versions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON red_seuils_versions AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
-- Seules la publication (statut, publiee_par, publiee_le) modifie une ligne (modèle 0271).
REVOKE UPDATE, DELETE ON red_seuils_versions FROM missionpilot_app;
GRANT UPDATE (statut, publiee_par, publiee_le) ON red_seuils_versions TO missionpilot_app;

CREATE FUNCTION red_controler_seuils() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_derniere int;
    v_nombre bigint;
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Une version de seuils ne se supprime pas.' USING ERRCODE = 'MPZ01';
    END IF;
    SELECT count(*), coalesce(max(s.version), 0) INTO v_nombre, v_derniere
      FROM red_seuils_versions s WHERE s.cabinet_id = NEW.cabinet_id AND s.secteur = NEW.secteur;
    IF TG_OP = 'INSERT' THEN
      IF NEW.statut <> 'brouillon' THEN
        RAISE EXCEPTION 'Une version de seuils naît en brouillon.' USING ERRCODE = 'MPZ06';
      END IF;
      IF v_nombre >= 50 THEN
        RAISE EXCEPTION 'Plafond atteint : au plus 50 versions de seuils par secteur.'
          USING ERRCODE = 'MPZ10';
      END IF;
      IF NEW.version <> v_derniere + 1 THEN
        RAISE EXCEPTION 'Les versions se suivent sans trou.' USING ERRCODE = 'MPZ05';
      END IF;
      -- Un seul brouillon à la fois par secteur : tant que la dernière version n'est pas publiée,
      -- aucune nouvelle ne s'ajoute (les 50 versions d'un secteur ne s'épuisent pas en brouillons,
      -- et la publication vise toujours la dernière version).
      IF EXISTS (SELECT 1 FROM red_seuils_versions s
                 WHERE s.cabinet_id = NEW.cabinet_id AND s.secteur = NEW.secteur
                   AND s.version = v_derniere AND s.statut = 'brouillon') THEN
        RAISE EXCEPTION 'Un brouillon de seuils est déjà en cours pour ce secteur.' USING ERRCODE = 'MPZ06';
      END IF;
      RETURN NEW;
    END IF;
    -- UPDATE : la seule transition admise est la publication.
    IF OLD.statut <> 'brouillon' OR NEW.statut <> 'publiee' THEN
      RAISE EXCEPTION 'Seule la publication d''un brouillon est admise.' USING ERRCODE = 'MPZ06';
    END IF;
    IF (NEW.cabinet_id, NEW.secteur, NEW.version, NEW.seuils, NEW.motif, NEW.cree_par, NEW.cree_le)
       IS DISTINCT FROM (OLD.cabinet_id, OLD.secteur, OLD.version, OLD.seuils, OLD.motif,
                         OLD.cree_par, OLD.cree_le) THEN
      RAISE EXCEPTION 'Le contenu d''une version de seuils est figé.' USING ERRCODE = 'MPZ04';
    END IF;
    IF NEW.version <> v_derniere THEN
      RAISE EXCEPTION 'Seule la dernière version du secteur se publie.' USING ERRCODE = 'MPZ05';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM utilisateurs u
                   WHERE u.id = NEW.publiee_par AND u.actif
                     AND u.roles && ARRAY['expert_metier', 'associe']) THEN
      RAISE EXCEPTION 'Les seuils sont publiés par un expert métier ou un associé actif.'
        USING ERRCODE = 'MPZ07';
    END IF;
    IF NEW.publiee_par = NEW.cree_par AND NOT red_valideur_dispense(NEW.publiee_par) THEN
      RAISE EXCEPTION 'L''auteur de seuils ne les publie pas lui-même.' USING ERRCODE = 'MPZ07';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER red_seuils_controle BEFORE INSERT OR UPDATE OR DELETE ON red_seuils_versions
  FOR EACH ROW EXECUTE FUNCTION red_controler_seuils();

CREATE TABLE red_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  dossier_id uuid NOT NULL,
  -- Secteur du dossier AU MOMENT du calcul.
  secteur text NOT NULL
    CHECK (secteur IN ('general', 'industrie', 'commerce', 'services', 'btp', 'agriculture')),
  seuils_version_id uuid,
  seuils_source text NOT NULL CHECK (seuils_source IN ('cabinet', 'defaut_moteur')),
  -- Instantané complet des seuils appliqués (reproductible même si les défauts du moteur changent).
  seuils jsonb NOT NULL CHECK (jsonb_typeof(seuils) = 'object' AND octet_length(seuils::text) <= 8000),
  version_moteur int NOT NULL CHECK (version_moteur >= 1),
  date_reference date NOT NULL CHECK (date_reference BETWEEN '2000-01-01' AND '2100-12-31'),
  -- { exercice_reference, etat_id, correspondance_version, ratios, tendances, incidents,
  --   analyses_indicatives, devise }
  entrees jsonb NOT NULL CHECK (jsonb_typeof(entrees) = 'object' AND octet_length(entrees::text) <= 20000),
  -- Sortie complète de `calculerScoreAlerte`.
  resultat jsonb NOT NULL CHECK (jsonb_typeof(resultat) = 'object' AND octet_length(resultat::text) <= 12000),
  score smallint CHECK (score BETWEEN 0 AND 100),
  niveau text NOT NULL CHECK (niveau IN ('insuffisant', 'faible', 'modere', 'eleve', 'critique')),
  calcule_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  CHECK ((seuils_source = 'cabinet') = (seuils_version_id IS NOT NULL)),
  CHECK ((niveau = 'insuffisant') = (score IS NULL)),
  FOREIGN KEY (cabinet_id, dossier_id) REFERENCES red_dossiers (cabinet_id, id),
  FOREIGN KEY (cabinet_id, seuils_version_id) REFERENCES red_seuils_versions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, calcule_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX red_scores_dossier_idx ON red_scores (cabinet_id, dossier_id, cree_le DESC, id DESC);
ALTER TABLE red_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON red_scores
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON red_scores AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON red_scores FROM missionpilot_app;
CREATE TRIGGER red_scores_ajout_seul BEFORE UPDATE OR DELETE ON red_scores
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_redressement();

-- Des seuils référencés : publiés, du même secteur, identiques à l'instantané.
CREATE FUNCTION red_controler_score() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_seuils red_seuils_versions%ROWTYPE;
  BEGIN
    IF NEW.seuils_version_id IS NOT NULL THEN
      SELECT * INTO v_seuils FROM red_seuils_versions s WHERE s.id = NEW.seuils_version_id;
      IF NOT FOUND OR v_seuils.statut <> 'publiee' OR v_seuils.secteur <> NEW.secteur
         OR v_seuils.seuils IS DISTINCT FROM NEW.seuils THEN
        RAISE EXCEPTION 'Le score doit référencer des seuils publiés du même secteur, identiques à son instantané.'
          USING ERRCODE = 'MPZ02';
      END IF;
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER red_scores_01_mission_ouverte BEFORE INSERT ON red_scores
  FOR EACH ROW EXECUTE FUNCTION red_controler_mission_ouverte();
CREATE TRIGGER red_scores_plafond BEFORE INSERT ON red_scores
  FOR EACH ROW EXECUTE FUNCTION red_controler_plafond('dossier_id', '500', 'scores d''alerte par dossier');
CREATE TRIGGER red_scores_seuils BEFORE INSERT ON red_scores
  FOR EACH ROW EXECUTE FUNCTION red_controler_score();
