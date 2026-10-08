-- Portail client (SOC-09) : compléments de la défense en profondeur (0113),
-- constat d'audit « liste portail_interdit incomplète ».
--
-- Dans une transaction d'une requête du portail, db/pool.ts pose
-- `app.portail_client_id` ET `app.portail_utilisateur_id` (contexte rangé par
-- portail/garde.ts). Toute table à RLS porte désormais une politique
-- RESTRICTIVE `portail` ou `portail_interdit` (test d'inventaire SANS
-- exception : apps/api/test/isolation.test.ts) :
-- - secrets et mécanique interne : rien (sessions, 2FA, tâches, IA, politique
--   du portail, jours fériés du cabinet) ;
-- - cabinet : sa fiche en lecture (nom affiché par /api/portail/moi) ;
-- - notifications : SES notifications (l'insertion reste permise : un jalon
--   validé notifie le chef de mission) ;
-- - suppressions de fichiers : celles des fichiers visibles (le portail teste
--   qu'un livrable n'est pas retiré) ;
-- - utilisateurs : soi, le contact principal de son entreprise, les
--   directeurs et chefs des missions partagées, les auteurs des
--   questionnaires qui lui sont adressés ; jamais le reste de l'annuaire.
-- Hors portail (paramètre absent), ces politiques sont neutres.
--
-- NB `mot_de_passe_hash` : le rôle applicatif le relit dans withTenant pour
-- reconfirmer l'identité (auth/confirmer-identite.ts) : la colonne ne peut
-- pas lui être retirée par GRANT sans casser l'authentification. Dans le
-- contexte du portail, seules les lignes ci-dessus sont lisibles et aucune
-- route du portail ne projette cette colonne (projections explicites).

-- Utilisateur du portail de la transaction (même paramètre que
-- app_portail_utilisateur_id() de 0143, posé désormais à chaque transaction).
CREATE FUNCTION app_portail_utilisateur() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.portail_utilisateur_id', true), '')::uuid $$;

-- Tables internes : rien n'est visible ni modifiable dans une transaction du portail.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'sessions', 'utilisateurs_2fa', 'codes_secours_2fa', 'defis_2fa', 'jobs',
    'portail_parametres', 'cabinet_feries']
  LOOP
    EXECUTE format(
      'CREATE POLICY portail_interdit ON %I AS RESTRICTIVE FOR ALL USING (app_portail_client_id() IS NULL)',
      t);
  END LOOP;
  -- Toutes les tables de l'IA (0100-0109), y compris celles ajoutées depuis.
  FOR t IN
    SELECT c.relname FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relname LIKE 'ia\_%'
      AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid
                      AND p.polname IN ('portail', 'portail_interdit'))
  LOOP
    EXECUTE format(
      'CREATE POLICY portail_interdit ON %I AS RESTRICTIVE FOR ALL USING (app_portail_client_id() IS NULL)',
      t);
  END LOOP;
END $$;

-- Cabinet : sa propre fiche, en lecture.
CREATE POLICY portail ON cabinets AS RESTRICTIVE FOR SELECT
  USING (app_portail_client_id() IS NULL OR id = app_cabinet_id());

-- Suppressions de fichiers : celles des fichiers visibles (politique 0113 de fichiers).
CREATE POLICY portail ON fichiers_suppressions AS RESTRICTIVE FOR SELECT
  USING (app_portail_client_id() IS NULL
         OR EXISTS (SELECT 1 FROM fichiers f WHERE f.id = fichiers_suppressions.fichier_id));

-- Utilisateurs visibles du portail. PL/pgSQL : questionnaire_envois (0141)
-- est créée après cette migration ; la référence se résout à l'exécution.
-- SECURITY INVOKER : chaque sous-requête est elle-même filtrée par les
-- politiques du portail (missions partagées, envois adressés à l'utilisateur).
CREATE FUNCTION app_portail_interlocuteur(p_id uuid) RETURNS boolean
  LANGUAGE plpgsql STABLE SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF p_id = app_portail_utilisateur() THEN
      RETURN true;
    END IF;
    IF EXISTS (SELECT 1 FROM portail_clients pc
               WHERE pc.client_id = app_portail_client_id() AND pc.contact_principal_id = p_id) THEN
      RETURN true;
    END IF;
    IF EXISTS (SELECT 1 FROM missions m
               WHERE m.client_id = app_portail_client_id()
                 AND (m.directeur_id = p_id OR m.chef_id = p_id)) THEN
      RETURN true;
    END IF;
    -- Auteur d'un questionnaire adressé à l'utilisateur (notifié à la soumission).
    IF to_regclass('public.questionnaire_envois') IS NOT NULL THEN
      RETURN EXISTS (SELECT 1 FROM questionnaire_envois e
                     WHERE e.client_id = app_portail_client_id() AND e.envoye_par = p_id);
    END IF;
    RETURN false;
  END $$;

CREATE POLICY portail ON utilisateurs AS RESTRICTIVE FOR SELECT
  USING (app_portail_client_id() IS NULL OR app_portail_interlocuteur(id));

-- Lecture seule dans une transaction du portail (même convention que 0113).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cabinets', 'fichiers_suppressions', 'utilisateurs']
  LOOP
    EXECUTE format('CREATE POLICY portail_sans_insert ON %I AS RESTRICTIVE FOR INSERT
                      WITH CHECK (app_portail_client_id() IS NULL)', t);
    EXECUTE format('CREATE POLICY portail_sans_update ON %I AS RESTRICTIVE FOR UPDATE
                      USING (app_portail_client_id() IS NULL)', t);
    EXECUTE format('CREATE POLICY portail_sans_delete ON %I AS RESTRICTIVE FOR DELETE
                      USING (app_portail_client_id() IS NULL)', t);
  END LOOP;
END $$;

-- Notifications : l'utilisateur du portail ne lit, ne marque et ne supprime
-- (DELETE est de toute façon révoqué, 0020) que les SIENNES. L'insertion
-- reste permise (notifications/notifier.ts) ;
-- comme elle renvoie l'identifiant (RETURNING), la ligne insérée est aussi
-- contrôlée par la politique de lecture : une ligne qui N'EXISTE PAS ENCORE
-- (en cours d'insertion) y est admise. notification_existe est SECURITY
-- DEFINER pour lire hors RLS (sinon la politique se citerait elle-même) ; elle
-- ne révèle que l'existence, dans le cabinet de la transaction, d'un
-- identifiant déjà connu de l'appelant.
CREATE FUNCTION notification_existe(p_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT EXISTS (SELECT 1 FROM notifications n
                       WHERE n.id = p_id AND n.cabinet_id = app_cabinet_id()) $$;
REVOKE ALL ON FUNCTION notification_existe(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION notification_existe(uuid) TO missionpilot_app;

CREATE POLICY portail ON notifications AS RESTRICTIVE FOR SELECT
  USING (app_portail_client_id() IS NULL OR destinataire_id = app_portail_utilisateur()
         OR NOT notification_existe(id));
CREATE POLICY portail_modification ON notifications AS RESTRICTIVE FOR UPDATE
  USING (app_portail_client_id() IS NULL OR destinataire_id = app_portail_utilisateur());
CREATE POLICY portail_suppression ON notifications AS RESTRICTIVE FOR DELETE
  USING (app_portail_client_id() IS NULL OR destinataire_id = app_portail_utilisateur());
