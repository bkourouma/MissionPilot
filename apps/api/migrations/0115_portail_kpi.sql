-- Saisie des KPI depuis le portail (routes/portail-kpi.ts) : la mission du
-- KPI doit être ouverte. Dans une transaction du portail, la mission est
-- invisible si elle n'est pas partagée (politique 0113) : ce contrôle passait
-- par une transaction SANS contexte du portail (constat d'audit). Il passe
-- désormais par cette fonction étroite, appelée DANS le contexte du portail :
-- - NULL si le KPI n'est pas un KPI du client de la transaction dont
--   l'utilisateur du portail est contributeur désigné (même 404 que les
--   autres cas) ou hors contexte du portail ;
-- - sinon, seulement « la mission est clôturée » (vrai/faux), rien d'autre.
-- SECURITY DEFINER pour lire la mission hors RLS ; les filtres de cabinet,
-- de client et d'utilisateur sont ceux posés par db/pool.ts. PL/pgSQL : les
-- tables des KPI (0160) sont créées après cette migration.
CREATE FUNCTION portail_kpi_mission_cloturee(p_kpi_id uuid) RETURNS boolean
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE v_statut text;
  BEGIN
    IF app_cabinet_id() IS NULL OR app_portail_client_id() IS NULL
       OR app_portail_utilisateur() IS NULL THEN
      RETURN NULL;
    END IF;
    SELECT m.statut INTO v_statut
      FROM kpi_definitions d
      JOIN kpi_contributeurs k ON k.cabinet_id = d.cabinet_id AND k.kpi_id = d.id
      JOIN missions m ON m.cabinet_id = d.cabinet_id AND m.id = d.mission_id
      WHERE d.id = p_kpi_id AND d.cabinet_id = app_cabinet_id()
        AND d.client_id = app_portail_client_id()
        AND k.utilisateur_id = app_portail_utilisateur();
    IF NOT FOUND THEN
      RETURN NULL;
    END IF;
    RETURN v_statut = 'cloturee';
  END $$;
REVOKE ALL ON FUNCTION portail_kpi_mission_cloturee(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION portail_kpi_mission_cloturee(uuid) TO missionpilot_app;
