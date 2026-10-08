-- Agents IA : un contenu dont la sortie d'agent est NON CONFORME au contrat de
-- l'agent (AGT-02, agents_executions.sortie_valide = faux) ne se valide pas
-- (ia_generations, version « valide ») : il se rejette. Doublé dans
-- ia/generations.ts (409 SORTIE_AGENT_NON_CONFORME).
--
-- SQLSTATE MPG06 : validation d'un contenu IA issu d'une sortie d'agent non conforme.

CREATE FUNCTION controler_validation_sortie_agent() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF EXISTS (SELECT 1 FROM agents_executions e
               WHERE e.demande_id = NEW.demande_id AND NOT e.sortie_valide) THEN
      RAISE EXCEPTION 'Validation refusée : la sortie de l''agent n''est pas conforme à son contrat.'
        USING ERRCODE = 'MPG06';
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER ia_generations_sortie_agent BEFORE INSERT ON ia_generations
  FOR EACH ROW WHEN (NEW.statut_contenu = 'valide')
  EXECUTE FUNCTION controler_validation_sortie_agent();
