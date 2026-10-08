-- Dépendances entre initiatives de la feuille de route (PLA-05).
--
-- Les dépendances d'une initiative font partie de son CONTENU versionné
-- (`contenu -> 'dependances'`, liste d'identifiants) : elles suivent le
-- statut, la validation et l'historique de l'initiative (0180). Le moteur
-- (`@missionpilot/engines`, controlerDependances) refuse les cycles avant
-- l'écriture ; la base double les contrôles structurels : liste réservée aux
-- initiatives, au plus 20 identifiants valides et distincts, chacun désignant
-- une AUTRE initiative du MÊME plan (MPS02). Le recalage des dates n'est
-- jamais stocké ici : il est recalculé par le moteur à chaque lecture.

CREATE FUNCTION controler_plan_dependances() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_deps jsonb := NEW.contenu -> 'dependances';
    v_plan uuid;
    v_type text;
  BEGIN
    IF v_deps IS NULL THEN
      RETURN NEW;
    END IF;
    SELECT plan_id, type INTO v_plan, v_type FROM plan_elements WHERE id = NEW.element_id;
    IF v_type IS DISTINCT FROM 'initiative' OR jsonb_typeof(v_deps) <> 'array'
       OR jsonb_array_length(v_deps) > 20 THEN
      RAISE EXCEPTION 'Dépendances réservées aux initiatives (au plus 20).' USING ERRCODE = 'MPS02';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_deps) d (x)
               WHERE jsonb_typeof(x) <> 'string'
                  OR (x #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
      RAISE EXCEPTION 'Dépendance mal formée.' USING ERRCODE = 'MPS02';
    END IF;
    IF (SELECT count(DISTINCT x::uuid) FROM jsonb_array_elements_text(v_deps) d (x))
       <> jsonb_array_length(v_deps)
       OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_deps) d (x)
                  WHERE x::uuid = NEW.element_id
                     OR NOT EXISTS (SELECT 1 FROM plan_elements e
                                    WHERE e.id = x::uuid AND e.plan_id = v_plan
                                      AND e.type = 'initiative')) THEN
      RAISE EXCEPTION 'Dépendance vers une initiative inconnue, en double ou vers elle-même.'
        USING ERRCODE = 'MPS02';
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER plan_element_versions_dependances BEFORE INSERT ON plan_element_versions
  FOR EACH ROW EXECUTE FUNCTION controler_plan_dependances();
