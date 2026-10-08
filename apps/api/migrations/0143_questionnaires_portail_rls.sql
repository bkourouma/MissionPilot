-- Questionnaires et portail client : défense en profondeur par RLS.
--
-- Dans une transaction du portail (`app.portail_client_id` posé par
-- portail/acces.ts `avecPortail`), les routes des questionnaires posent EN
-- PLUS `app.portail_utilisateur_id` (questionnaires/portail.ts). Les
-- politiques RESTRICTIVES ci-dessous limitent alors :
-- - les répondants à CE client et à CET utilisateur ;
-- - les envois à ceux, envoyés ou clos, où il est répondant (la sous-requête
--   est elle-même filtrée par la politique des répondants) ;
-- - les réponses à la sienne, ou à la réponse collective d'un tel envoi.
-- Sans `app.portail_utilisateur_id`, rien n'est visible dans le portail
-- (échec sûr). Modèles, versions et relances restent invisibles au portail.
-- Envois et répondants sont en LECTURE SEULE dans le portail : la politique
-- `portail` ne vaut que pour SELECT, et des politiques restrictives refusent
-- INSERT, UPDATE et DELETE (et donc SELECT … FOR UPDATE) quand
-- `app.portail_client_id` est posé. Le portail n'écrit que SA réponse
-- (questionnaire_reponses) ; il sérialise ses saisies par un verrou
-- consultatif sur l'envoi (questionnaires/portail.ts), jamais par un verrou
-- de ligne sur l'envoi. Hors portail, ces politiques sont neutres.

CREATE FUNCTION app_portail_utilisateur_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.portail_utilisateur_id', true), '')::uuid $$;

CREATE POLICY portail_interdit ON questionnaire_modeles AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
CREATE POLICY portail_interdit ON questionnaire_versions AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
CREATE POLICY portail_interdit ON questionnaire_relances AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);

CREATE POLICY portail ON questionnaire_repondants AS RESTRICTIVE FOR SELECT
  USING (app_portail_client_id() IS NULL OR (
    client_id = app_portail_client_id() AND utilisateur_id = app_portail_utilisateur_id()));

CREATE POLICY portail ON questionnaire_envois AS RESTRICTIVE FOR SELECT
  USING (app_portail_client_id() IS NULL OR (
    client_id = app_portail_client_id() AND statut IN ('envoye', 'clos')
    AND EXISTS (SELECT 1 FROM questionnaire_repondants r WHERE r.envoi_id = questionnaire_envois.id)));

-- Écritures : jamais depuis le portail (envois et répondants).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['questionnaire_envois', 'questionnaire_repondants'] LOOP
    EXECUTE format(
      'CREATE POLICY portail_sans_insertion ON %I AS RESTRICTIVE FOR INSERT
         WITH CHECK (app_portail_client_id() IS NULL)', t);
    EXECUTE format(
      'CREATE POLICY portail_sans_modification ON %I AS RESTRICTIVE FOR UPDATE
         USING (app_portail_client_id() IS NULL) WITH CHECK (app_portail_client_id() IS NULL)', t);
    EXECUTE format(
      'CREATE POLICY portail_sans_suppression ON %I AS RESTRICTIVE FOR DELETE
         USING (app_portail_client_id() IS NULL)', t);
  END LOOP;
END $$;

CREATE POLICY portail ON questionnaire_reponses AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL OR (
    client_id = app_portail_client_id()
    AND EXISTS (SELECT 1 FROM questionnaire_envois e WHERE e.id = questionnaire_reponses.envoi_id)
    AND (repondant_id IS NULL
         OR EXISTS (SELECT 1 FROM questionnaire_repondants r WHERE r.id = questionnaire_reponses.repondant_id))));
