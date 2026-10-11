-- Brief quotidien par rôle (AUT-07, PRD complémentaire §8.3, lot « lacunes de la vague 2 »).
--
-- Aucune table : le brief est un calcul déterministe fait à la demande (GET /api/brief) et par la
-- tâche quotidienne « brief_quotidien », qui ne crée que des notifications internes (table
-- `notifications`, déjà sous RLS). Cette migration ne pose que la planification de la tâche.
--
-- Planification quotidienne (fonction étroite, SECURITY DEFINER comme les autres planifications
-- récurrentes : 0030, 0160, 0302) : une tâche `brief_quotidien` par cabinet et par jour, clé
-- `brief_quotidien:AAAA-MM-JJ`, pour les seuls cabinets qui ont au moins un utilisateur interne
-- actif (rôle du cabinet, jamais un rôle du portail client). Un second passage ne la double pas
-- (index unique (cabinet_id, cle)). Le contrôle des jours ouvrés est fait par l'appelant.
--
-- Fonction STRICTE : aucun paramètre nul (un `p_date` nul contournerait la cohérence clé/date et
-- créerait une tâche sans date), et l'heure d'exécution tient dans la journée visée (de la
-- veille à J+2 de `p_date`, UTC) : un appel ne peut ni occuper à l'avance la clé d'un jour
-- lointain pour tous les cabinets, ni différer indéfiniment une tâche. La borne est relative à
-- `p_date` et non à `now()` : le planificateur reçoit une horloge injectable (tests) ; la date
-- réelle du jour est celle du planificateur, qui lit l'heure du worker.
--
-- Les tâches de SUITE (utilisateurs au-delà d'un lot, clé `brief_quotidien:AAAA-MM-JJ:apres:<id>`)
-- ne passent pas par cette fonction : le handler les met en file dans la transaction du cabinet
-- (brief/quotidien.ts).

CREATE FUNCTION planifier_brief_quotidien(p_cle text, p_execute_a timestamptz, p_date date)
  RETURNS int
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE v_n int;
  BEGIN
    IF p_cle IS NULL OR p_execute_a IS NULL OR p_date IS NULL THEN
      RAISE EXCEPTION 'Planification du brief quotidien : paramètres obligatoires.';
    END IF;
    IF p_cle !~ '^brief_quotidien:[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR right(p_cle, 10) <> p_date::text THEN
      RAISE EXCEPTION 'Clé du brief quotidien invalide.';
    END IF;
    IF p_execute_a < (p_date::timestamp AT TIME ZONE 'UTC') - interval '1 day'
       OR p_execute_a > (p_date::timestamp AT TIME ZONE 'UTC') + interval '2 days' THEN
      RAISE EXCEPTION 'Heure d''exécution du brief quotidien hors de la journée visée.';
    END IF;
    INSERT INTO jobs (cabinet_id, type, charge, execute_a, cle)
      SELECT c.id, 'brief_quotidien', jsonb_build_object('date', p_date), p_execute_a, p_cle
      FROM cabinets c
      WHERE EXISTS (SELECT 1 FROM utilisateurs u
                    WHERE u.cabinet_id = c.id AND u.actif
                      AND NOT (u.roles && ARRAY['client_dirigeant', 'client_contributeur',
                                                'client_investisseur']))
      ON CONFLICT (cabinet_id, cle) WHERE cle IS NOT NULL DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
  END $$;

REVOKE ALL ON FUNCTION planifier_brief_quotidien(text, timestamptz, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION planifier_brief_quotidien(text, timestamptz, date) TO missionpilot_app;
