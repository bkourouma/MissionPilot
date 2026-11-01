-- Activité de démonstration automatique (job « activite_demo », DECISIONS « Activité de
-- démonstration automatique », 2026-11-01) : planification MENSUELLE.
--
-- Fonction étroite, SECURITY DEFINER comme les autres planifications récurrentes (0304, 0308) :
-- une tâche par cabinet et par MOIS, clé `activite_demo:AAAA-MM`, pour les seuls cabinets de
-- démonstration ACTIFS (`cabinets.est_demo AND cabinets.actif`, 0570) qui ont au moins un
-- collaborateur interne actif rattaché à un utilisateur actif du même cabinet ET au moins une
-- mission signée ou en cours (les bacs à sable vides de 0582 sont écartés). L'activation
-- (DEMO_ACTIVITE_AUTO, config.ts) est contrôlée par l'appelant : inactive, il n'appelle pas cette
-- fonction. Le handler revérifie est_demo et actif dans la transaction du cabinet et met lui-même
-- en file les tâches de SUITE hebdomadaires (`activite_demo:AAAA-MM:AAAA-MM-JJ`), pas cette fonction.
--
-- Fonction STRICTE : aucun paramètre nul, clé cohérente avec le premier jour du mois visé, heure
-- d'exécution dans ce mois (UTC) : un appel ne peut ni occuper à l'avance la clé d'un mois lointain
-- pour tous les cabinets, ni différer la tâche hors du mois. Elle lit cabinets, collaborateurs,
-- utilisateurs et missions de tous les cabinets (propriétaire, hors RLS) mais ne renvoie qu'un
-- nombre ; search_path figé, EXECUTE accordé au seul rôle applicatif. Le planificateur ne lui passe
-- que des paramètres calculés par le code : une exception interromprait le cycle (worker.ts:178-184).
--
-- Aucune table : rien ne change dans les inventaires de `isolation.test.ts`. Le nom est hors des
-- préfixes inventoriés (`demo_`, `plateforme_`, `dd_`) des tests de droits existants.

CREATE FUNCTION planifier_activite_demo(p_cle text, p_execute_a timestamptz, p_premier date)
  RETURNS int
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE v_n int; v_debut timestamptz;
  BEGIN
    IF p_cle IS NULL OR p_execute_a IS NULL OR p_premier IS NULL THEN
      RAISE EXCEPTION 'Planification de l''activité de démonstration : paramètres obligatoires.';
    END IF;
    IF extract(day FROM p_premier) <> 1
       OR p_cle !~ '^activite_demo:[0-9]{4}-(0[1-9]|1[0-2])$'
       OR right(p_cle, 7) <> to_char(p_premier, 'YYYY-MM') THEN
      RAISE EXCEPTION 'Clé de l''activité de démonstration invalide (activite_demo:AAAA-MM du premier du mois attendue).';
    END IF;
    v_debut := p_premier::timestamp AT TIME ZONE 'UTC';
    IF p_execute_a < v_debut OR p_execute_a >= v_debut + interval '1 month' THEN
      RAISE EXCEPTION 'Heure d''exécution de l''activité de démonstration hors du mois visé.';
    END IF;
    INSERT INTO jobs (cabinet_id, type, charge, execute_a, cle)
      SELECT c.id, 'activite_demo', jsonb_build_object('mois', to_char(p_premier, 'YYYY-MM')),
             p_execute_a, p_cle
      FROM cabinets c
      WHERE c.est_demo AND c.actif
        AND EXISTS (SELECT 1 FROM collaborateurs k
                    JOIN utilisateurs u ON u.id = k.utilisateur_id AND u.cabinet_id = c.id
                    WHERE k.cabinet_id = c.id AND k.actif AND k.type = 'interne' AND u.actif)
        AND EXISTS (SELECT 1 FROM missions m
                    WHERE m.cabinet_id = c.id AND m.statut IN ('signee', 'en_cours'))
      ON CONFLICT (cabinet_id, cle) WHERE cle IS NOT NULL DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
  END $$;

REVOKE ALL ON FUNCTION planifier_activite_demo(text, timestamptz, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION planifier_activite_demo(text, timestamptz, date) TO missionpilot_app;
