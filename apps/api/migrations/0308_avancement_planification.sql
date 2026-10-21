-- Rapport d'avancement hebdomadaire (AUT-10, lot 4c) : planification de la tâche « avancement_hebdo ».
--
-- Fonction étroite, SECURITY DEFINER comme les autres planifications récurrentes (0304, 0544) : une
-- tâche par cabinet et par SEMAINE, clé `avancement_hebdo:AAAA-MM-JJ` (lundi de la semaine), pour les
-- seuls cabinets qui ont au moins une mission signée ou en cours ET n'ont pas désactivé la fonction
-- (`avancement_parametres.actif`, activée sans ligne). Le planificateur l'appelle chaque jour ouvré
-- (lundi à vendredi, contrôlé par l'appelant) : la tâche s'exécute donc le premier jour ouvré où le
-- cabinet est éligible, et un second appel de la semaine ne la double pas (index unique
-- (cabinet_id, cle)). Les tâches de SUITE (missions au-delà d'un lot, clé suffixée par lot) sont mises
-- en file par le handler dans la transaction du cabinet, pas par cette fonction.
--
-- Fonction STRICTE : aucun paramètre nul, clé cohérente avec la date d'un lundi, heure d'exécution
-- dans la semaine visée (du lundi 00 h au lundi suivant 00 h, UTC) : un appel ne peut ni occuper à
-- l'avance la clé d'une semaine lointaine pour tous les cabinets, ni différer indéfiniment la tâche.
-- Elle lit missions et paramètres de tous les cabinets (propriétaire, hors RLS) mais ne renvoie qu'un
-- nombre ; search_path figé, EXECUTE accordé au seul rôle applicatif.

CREATE FUNCTION planifier_avancement_hebdo(p_cle text, p_execute_a timestamptz, p_semaine date)
  RETURNS int
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE v_n int;
  BEGIN
    IF p_cle IS NULL OR p_execute_a IS NULL OR p_semaine IS NULL THEN
      RAISE EXCEPTION 'Planification de l''avancement hebdomadaire : paramètres obligatoires.';
    END IF;
    IF p_cle !~ '^avancement_hebdo:[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR right(p_cle, 10) <> p_semaine::text
       OR extract(isodow FROM p_semaine) <> 1 THEN
      RAISE EXCEPTION 'Clé de l''avancement hebdomadaire invalide (date d''un lundi attendue).';
    END IF;
    IF p_execute_a < (p_semaine::timestamp AT TIME ZONE 'UTC')
       OR p_execute_a >= (p_semaine::timestamp AT TIME ZONE 'UTC') + interval '7 days' THEN
      RAISE EXCEPTION 'Heure d''exécution de l''avancement hebdomadaire hors de la semaine visée.';
    END IF;
    INSERT INTO jobs (cabinet_id, type, charge, execute_a, cle)
      SELECT c.id, 'avancement_hebdo', jsonb_build_object('semaine', p_semaine), p_execute_a, p_cle
      FROM cabinets c
      WHERE EXISTS (SELECT 1 FROM missions m
                    WHERE m.cabinet_id = c.id AND m.statut IN ('signee', 'en_cours'))
        AND NOT EXISTS (SELECT 1 FROM avancement_parametres p
                        WHERE p.cabinet_id = c.id AND NOT p.actif)
      ON CONFLICT (cabinet_id, cle) WHERE cle IS NOT NULL DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
  END $$;

REVOKE ALL ON FUNCTION planifier_avancement_hebdo(text, timestamptz, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION planifier_avancement_hebdo(text, timestamptz, date) TO missionpilot_app;
