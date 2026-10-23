-- Revue contradictoire (AGT-06, PRD complémentaire §7, ADR-005) : l'agent « contradicteur »
-- (registre, migration 0260) relit un brouillon IA à la demande d'un consultant et liste
-- contre-preuves, incohérences et affirmations non sourcées.
--
-- Aucune nouvelle table : une revue EST une exécution d'agent (agents_executions, 0261) adossée à
-- une demande de l'orchestrateur (ia_demandes + ia_generations, 0102) qui porte la sortie en
-- brouillon IA. Le lien avec le brouillon relu est l'entité liée de la demande :
-- entite_type = 'revue_contradictoire', entite_id = demande du brouillon relu. La revue ne
-- modifie JAMAIS le brouillon relu (aucune écriture sur ses lignes) et rien ne dépend d'elle.
--
-- Deux garde-fous en base :
-- - UNE SEULE revue active (en file ou en cours) par brouillon : index unique partiel (le
--   conflit, SQLSTATE 23505, devient 409 REVUE_DEJA_ACTIVE) ;
-- - cohérence à la création (MQI50) : le brouillon relu existe dans le cabinet (RLS), n'est pas
--   lui-même une revue, et la revue est de la même mission que lui.
-- Les routes ne sont pas ouvertes au portail client (LISTE_BLANCHE_PORTAIL), les politiques
-- `isolation` et `portail_interdit` des tables concernées s'appliquent inchangées.

CREATE UNIQUE INDEX ia_demandes_revue_active_idx ON ia_demandes (cabinet_id, entite_id)
  WHERE entite_type = 'revue_contradictoire' AND statut IN ('en_file', 'en_cours');

CREATE FUNCTION controler_ia_revue_contradictoire() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_relu record;
  BEGIN
    IF NEW.entite_type IS DISTINCT FROM 'revue_contradictoire' THEN
      RETURN NEW;
    END IF;
    SELECT d.entite_type, d.mission_id INTO v_relu
      FROM ia_demandes d WHERE d.id = NEW.entite_id AND d.cabinet_id = NEW.cabinet_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Revue contradictoire : brouillon relu introuvable.' USING ERRCODE = 'MQI50';
    END IF;
    IF v_relu.entite_type IS NOT DISTINCT FROM 'revue_contradictoire' THEN
      RAISE EXCEPTION 'Revue contradictoire : une revue ne se relit pas.' USING ERRCODE = 'MQI50';
    END IF;
    IF v_relu.mission_id IS DISTINCT FROM NEW.mission_id THEN
      RAISE EXCEPTION 'Revue contradictoire : mission différente de celle du brouillon relu.'
        USING ERRCODE = 'MQI50';
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER ia_demandes_revue_contradictoire BEFORE INSERT ON ia_demandes
  FOR EACH ROW EXECUTE FUNCTION controler_ia_revue_contradictoire();
