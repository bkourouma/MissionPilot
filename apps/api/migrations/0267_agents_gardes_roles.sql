-- Agents IA : gardes de rôle doublées en base (corrections d'audit, lot AGT).
--
-- SQLSTATE :
--   MPG07 classe de risque d'une brique refusée : sous le PLANCHER de la méthode
--         (classe la plus haute des briques du référentiel de même code, visibles
--         du cabinet), ou R0 déclarée par un non-associé ;
--   MPG08 action réservée : lever (réactiver, relever le niveau) une restriction
--         d'agent posée par un associé sans être associé ; décider d'une exécution
--         d'agent sans en être le déclencheur, le chef ou le directeur de la
--         mission, ni un associé.
--
-- « Associé » : utilisateur actif dont les rôles contiennent « associe » (même
-- règle que MPG03, 0262). Les rôles lus sont ceux du moment de l'écriture.

-- Rang d'une classe de risque (R0 → 0 … R3 → 3).
CREATE FUNCTION rang_classe_risque_agent(p text) RETURNS int
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT substr(p, 2, 1)::int $$;

CREATE FUNCTION est_associe_actif(p_utilisateur uuid) RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT EXISTS (SELECT 1 FROM utilisateurs u WHERE u.id = p_utilisateur AND u.actif
                       AND 'associe' = ANY (u.roles)) $$;

-- Brique : classe au moins égale au plancher de la méthode ; R0 réservée à un associé.
CREATE FUNCTION controler_classe_brique_agent() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_plancher int;
  BEGIN
    SELECT max(rang_classe_risque_agent(mb.classe_risque)) INTO v_plancher
      FROM methode_briques mb WHERE mb.code = NEW.brique_code;
    IF v_plancher IS NOT NULL AND rang_classe_risque_agent(NEW.classe_risque) < v_plancher THEN
      RAISE EXCEPTION 'Classe de risque sous le plancher de la méthode pour cette brique.'
        USING ERRCODE = 'MPG07';
    END IF;
    IF NEW.classe_risque = 'R0' AND NOT est_associe_actif(NEW.cree_par) THEN
      RAISE EXCEPTION 'Une brique R0 est déclarée par un associé.' USING ERRCODE = 'MPG07';
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER agents_briques_classe BEFORE INSERT ON agents_briques
  FOR EACH ROW EXECUTE FUNCTION controler_classe_brique_agent();

-- Restriction : la plus récente restriction posée par un associé est un plancher de
-- sévérité pour un non-associé (ni réactivation, ni niveau plus haut).
CREATE FUNCTION controler_levee_restriction() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_std text;
    v_ref agents_restrictions%ROWTYPE;
  BEGIN
    PERFORM pg_advisory_xact_lock(
      hashtextextended('agents_restriction:' || NEW.cabinet_id::text || ':' || NEW.agent_code, 0));
    IF est_associe_actif(NEW.auteur_id) THEN
      RETURN NEW;
    END IF;
    SELECT s.* INTO v_ref FROM agents_restrictions s
      WHERE s.cabinet_id = NEW.cabinet_id AND s.agent_code = NEW.agent_code
        AND EXISTS (SELECT 1 FROM utilisateurs u WHERE u.id = s.auteur_id AND 'associe' = ANY (u.roles))
      ORDER BY s.id DESC LIMIT 1;
    IF NOT FOUND THEN
      RETURN NEW;
    END IF;
    SELECT niveau_max INTO v_std FROM agents_registre_courant WHERE code = NEW.agent_code;
    IF (NOT v_ref.actif AND NEW.actif)
       OR rang_niveau_autonomie(coalesce(NEW.niveau_max, v_std))
          > rang_niveau_autonomie(coalesce(v_ref.niveau_max, v_std)) THEN
      RAISE EXCEPTION 'Restriction posée par un associé : seul un associé la lève.'
        USING ERRCODE = 'MPG08';
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER agents_restrictions_levee BEFORE INSERT ON agents_restrictions
  FOR EACH ROW EXECUTE FUNCTION controler_levee_restriction();

-- Décision sur une exécution : déclencheur, chef ou directeur de la mission, ou associé.
CREATE FUNCTION controler_decideur_execution() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_exec agents_executions%ROWTYPE;
  BEGIN
    SELECT * INTO v_exec FROM agents_executions WHERE id = NEW.execution_id;
    IF NEW.decideur_id = v_exec.declencheur_id OR est_associe_actif(NEW.decideur_id)
       OR EXISTS (SELECT 1 FROM missions m WHERE m.id = v_exec.mission_id
                    AND (m.chef_id = NEW.decideur_id OR m.directeur_id = NEW.decideur_id)) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Décision réservée au déclencheur, au chef ou au directeur de la mission, ou à un associé.'
      USING ERRCODE = 'MPG08';
  END $$;

CREATE TRIGGER agents_execution_decisions_decideur BEFORE INSERT ON agents_execution_decisions
  FOR EACH ROW EXECUTE FUNCTION controler_decideur_execution();
