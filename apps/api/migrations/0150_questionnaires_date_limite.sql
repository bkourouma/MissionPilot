-- Date limite d'un questionnaire appliquée à la soumission (HANDOFF, point 6).
--
-- Jusqu'ici la date limite d'un envoi était une simple indication. Désormais,
-- une réponse ne peut plus être SOUMISE après la date limite de son envoi
-- (MPQ07) ; la date limite elle-même reste incluse (jour UTC). Le consultant
-- prolonge en repoussant la date limite de l'envoi (PATCH, 0141 l'autorise
-- tant que l'envoi n'est pas clos) ; supprimer la date limite lève aussi le
-- blocage. Les brouillons suivent la même règle côté application
-- (questionnaires/portail.ts) ; la base garde la soumission, seule étape qui
-- fige une réponse.

CREATE FUNCTION controler_date_limite_reponse() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_limite date;
  BEGIN
    IF NEW.statut = 'soumise' AND OLD.statut IS DISTINCT FROM 'soumise' THEN
      SELECT e.date_limite INTO v_limite FROM questionnaire_envois e WHERE e.id = NEW.envoi_id;
      IF v_limite IS NOT NULL AND v_limite < (now() AT TIME ZONE 'UTC')::date THEN
        RAISE EXCEPTION 'La date limite de ce questionnaire est dépassée.' USING ERRCODE = 'MPQ07';
      END IF;
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER questionnaire_reponses_date_limite BEFORE UPDATE ON questionnaire_reponses
  FOR EACH ROW EXECUTE FUNCTION controler_date_limite_reponse();
