-- File de tâches (ADR-002) : réservation ÉQUITABLE entre cabinets.
--
-- Avant : `reserver_job_a` (0030) prenait le plus ancien job prêt de TOUS les cabinets (FIFO
-- global) : un cabinet qui met 50 tâches en file retardait tous les autres. Désormais on choisit
-- d'abord le CABINET, puis le plus ancien job prêt de ce cabinet :
--   1. le cabinet qui a le moins de jobs « en_cours » (un cabinet ne monopolise pas les workers) ;
--   2. à égalité, celui dont le dernier job réservé (`verrouille_le`, conservé sur les jobs
--      terminés) est le plus ancien, jamais réservé d'abord : tourniquet entre cabinets ;
--   3. à égalité, celui dont le plus ancien job prêt est le plus ancien (puis l'identifiant).
-- Dans le cabinet retenu : (execute_a, id), FOR UPDATE SKIP LOCKED, donc plusieurs workers ne
-- prennent jamais le même job. Si tous les jobs prêts du cabinet retenu sont déjà verrouillés par
-- un autre worker, on passe au cabinet suivant. Même signature et mêmes droits que 0030
-- (SECURITY DEFINER, search_path figé ; REVOKE/GRANT de 0030 conservés par CREATE OR REPLACE).
-- Le plafond « un seul rejeu en file par cabinet » (agents) n'est pas modifié.
--
-- Aucune nouvelle table : le « dernier réservé » se lit dans `jobs.verrouille_le`. Limite connue :
-- une reprise après échec ou la libération d'un job bloqué remet `verrouille_le` à NULL ; la
-- date de réservation de ce job est alors perdue pour le tourniquet (l'équité reste assurée par
-- le critère 1 et les autres jobs du cabinet).
--
-- Coût : un balayage de la table `cabinets` avec, par cabinet, trois recherches indexées
-- (premier job prêt, nombre en cours, dernière réservation) : indépendant du nombre de jobs en
-- attente.

CREATE INDEX jobs_equite_pret_idx ON jobs (cabinet_id, execute_a, id) WHERE statut = 'en_attente';
CREATE INDEX jobs_equite_en_cours_idx ON jobs (cabinet_id) WHERE statut = 'en_cours';
CREATE INDEX jobs_equite_reserve_idx ON jobs (cabinet_id, verrouille_le);

CREATE OR REPLACE FUNCTION reserver_job_a(p_maintenant timestamptz)
  RETURNS SETOF jobs
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_cabinet uuid;
    v_id uuid;
  BEGIN
    FOR v_cabinet IN
      SELECT c.id
      FROM cabinets c
      CROSS JOIN LATERAL (
        SELECT j.execute_a FROM jobs j
        WHERE j.cabinet_id = c.id AND j.statut = 'en_attente' AND j.execute_a <= p_maintenant
        ORDER BY j.execute_a, j.id LIMIT 1) pret
      CROSS JOIN LATERAL (
        SELECT count(*) AS n FROM jobs j
        WHERE j.cabinet_id = c.id AND j.statut = 'en_cours') encours
      CROSS JOIN LATERAL (
        SELECT max(j.verrouille_le) AS dernier FROM jobs j
        WHERE j.cabinet_id = c.id) reserve
      ORDER BY encours.n, reserve.dernier NULLS FIRST, pret.execute_a, c.id
    LOOP
      v_id := NULL;
      SELECT j.id INTO v_id FROM jobs j
      WHERE j.cabinet_id = v_cabinet AND j.statut = 'en_attente' AND j.execute_a <= p_maintenant
      ORDER BY j.execute_a, j.id
      FOR UPDATE SKIP LOCKED LIMIT 1;
      IF v_id IS NOT NULL THEN
        RETURN QUERY
          WITH pris AS (
            UPDATE jobs SET statut = 'en_cours', verrouille_le = p_maintenant,
                            tentatives = tentatives + 1
            WHERE id = v_id RETURNING *)
          SELECT * FROM pris;
        RETURN;
      END IF;
    END LOOP;
    RETURN;
  END $$;
