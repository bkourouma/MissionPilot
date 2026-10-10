-- Moteur d'automatisation (lot AUT-CORE, ADR-006) : événements publiés PAR LA BASE (AUT-01)
-- pour les modules existants, et planification quotidienne de la détection des événements nés
-- du temps (questionnaire sans réponse, KPI au rouge).
--
-- Publication par la base : un déclencheur AFTER UPDATE de la table du module enregistre
-- l'événement (clé idempotente) et, si une automatisation ACTIVE l'écoute, met en file son
-- traitement (job `automatisation_evenement`, clé unique). NON BLOQUANT : toute erreur est
-- absorbée (sous-transaction plpgsql) et l'écriture métier se poursuit ; rien n'est publié
-- depuis une transaction du portail client. Le contenu ne porte que des identifiants et des
-- libellés (jamais un montant).

CREATE FUNCTION automatisation_publier_base(p_cabinet uuid, p_code text, p_payload jsonb,
                                            p_cle text, p_mission uuid)
  RETURNS void
  LANGUAGE plpgsql
  AS $$
  DECLARE v_id uuid;
  BEGIN
    IF app_portail_client_id() IS NOT NULL THEN
      RETURN;
    END IF;
    BEGIN
      INSERT INTO automatisation_evenements (cabinet_id, code, payload, cle, source, mission_id)
        VALUES (p_cabinet, p_code, p_payload, p_code || ':' || p_cle, 'base', p_mission)
        ON CONFLICT (cabinet_id, cle) DO NOTHING
        RETURNING id INTO v_id;
      IF v_id IS NOT NULL AND EXISTS (
           SELECT 1 FROM automatisations a
           WHERE a.cabinet_id = p_cabinet AND a.active AND a.evenement_code = p_code) THEN
        INSERT INTO jobs (cabinet_id, type, charge, cle)
          VALUES (p_cabinet, 'automatisation_evenement', jsonb_build_object('evenement_id', v_id),
                  'automatisation_evenement:' || v_id)
          ON CONFLICT (cabinet_id, cle) WHERE cle IS NOT NULL DO NOTHING;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Publication de l''événement % ignorée (%).', p_code, SQLSTATE;
    END;
  END $$;

-- Jalon atteint (mission_jalons.atteint : faux → vrai).
CREATE FUNCTION automatisation_jalon_atteint() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    PERFORM automatisation_publier_base(NEW.cabinet_id, 'mission.jalon_atteint',
      jsonb_build_object('mission_id', NEW.mission_id, 'jalon_id', NEW.id,
                         'libelle', NEW.libelle),
      NEW.id::text, NEW.mission_id);
    RETURN NULL;
  END $$;

CREATE TRIGGER automatisation_jalon_atteint AFTER UPDATE OF atteint ON mission_jalons
  FOR EACH ROW WHEN (NEW.atteint AND NOT OLD.atteint)
  EXECUTE FUNCTION automatisation_jalon_atteint();

-- Mission signée (missions.date_signature : nulle → renseignée).
CREATE FUNCTION automatisation_mission_signee() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    PERFORM automatisation_publier_base(NEW.cabinet_id, 'mission.signee',
      jsonb_build_object('mission_id', NEW.id), NEW.id::text, NEW.id);
    RETURN NULL;
  END $$;

CREATE TRIGGER automatisation_mission_signee AFTER UPDATE OF date_signature ON missions
  FOR EACH ROW WHEN (OLD.date_signature IS NULL AND NEW.date_signature IS NOT NULL)
  EXECUTE FUNCTION automatisation_mission_signee();

-- Questionnaire clos (questionnaire_envois.statut → « clos »).
CREATE FUNCTION automatisation_questionnaire_clos() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    PERFORM automatisation_publier_base(NEW.cabinet_id, 'questionnaire.clos',
      jsonb_build_object('mission_id', NEW.mission_id, 'envoi_id', NEW.id),
      NEW.id::text, NEW.mission_id);
    RETURN NULL;
  END $$;

CREATE TRIGGER automatisation_questionnaire_clos AFTER UPDATE OF statut ON questionnaire_envois
  FOR EACH ROW WHEN (NEW.statut = 'clos' AND OLD.statut <> 'clos')
  EXECUTE FUNCTION automatisation_questionnaire_clos();

-- Détection quotidienne (worker, hors contexte de cabinet) : une tâche par cabinet qui a une
-- automatisation (active ou non : l'historique sert à la simulation, AUT-04) sur un événement
-- DÉTECTÉ et une mission non clôturée, clé `automatisation_detection:AAAA-MM-JJ` (une par
-- jour). Fonction étroite, SECURITY DEFINER comme les autres planifications récurrentes
-- (0030, 0160).
CREATE FUNCTION planifier_detection_automatisation(p_cle text, p_execute_a timestamptz)
  RETURNS int
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE v_n int;
  BEGIN
    IF p_cle IS NULL OR p_cle !~ '^automatisation_detection:\d{4}-\d{2}-\d{2}$' THEN
      RAISE EXCEPTION 'Clé de détection invalide.';
    END IF;
    INSERT INTO jobs (cabinet_id, type, charge, execute_a, cle)
      SELECT c.id, 'automatisation_detection', jsonb_build_object('jour', right(p_cle, 10)),
             p_execute_a, p_cle
      FROM cabinets c
      WHERE EXISTS (SELECT 1 FROM automatisations a WHERE a.cabinet_id = c.id
                      AND a.evenement_code IN ('questionnaire.sans_reponse', 'kpi.rouge_deux_periodes'))
        AND EXISTS (SELECT 1 FROM missions m WHERE m.cabinet_id = c.id AND m.statut <> 'cloturee')
      ON CONFLICT (cabinet_id, cle) WHERE cle IS NOT NULL DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
  END $$;

REVOKE ALL ON FUNCTION planifier_detection_automatisation(text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION planifier_detection_automatisation(text, timestamptz) TO missionpilot_app;
