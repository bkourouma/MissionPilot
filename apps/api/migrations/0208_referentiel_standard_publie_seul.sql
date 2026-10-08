-- Référentiel de méthodes (lot STD) — correctif d'audit de sécurité : un cabinet
-- ne voit du standard MissionPilot (`cabinet_id` NULL) que les versions
-- PUBLIÉES. Un brouillon du standard (en préparation par ACC) et son contenu
-- restent invisibles du rôle applicatif. La politique `standard_lecture` de
-- 0201 est remplacée ; la méthode du standard reste lisible (son catalogue
-- n'expose que ses versions publiées). Le propriétaire (migrations, seed)
-- contourne RLS : le seed du standard n'est pas affecté.

DROP POLICY standard_lecture ON methode_versions;
CREATE POLICY standard_lecture ON methode_versions FOR SELECT
  USING (cabinet_id IS NULL AND statut = 'publiee' AND app_cabinet_id() IS NOT NULL);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['methode_etapes', 'methode_briques', 'methode_elements',
                           'methode_rubriques', 'methode_regles', 'methode_cas_types'] LOOP
    EXECUTE format('DROP POLICY standard_lecture ON %I', t);
    EXECUTE format('CREATE POLICY standard_lecture ON %I FOR SELECT
                    USING (cabinet_id IS NULL AND app_cabinet_id() IS NOT NULL
                      AND EXISTS (SELECT 1 FROM methode_versions v
                                   WHERE v.id = %I.version_id AND v.statut = ''publiee''))', t, t);
  END LOOP;
END $$;
