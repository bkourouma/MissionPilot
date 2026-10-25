-- Super admin de plateforme (lot 1) : outils internes, connexion et sessions
-- (codes MQP : voir 0570).
--
-- Fonctions accordées au rôle applicatif (SECURITY DEFINER, search_path fixe, EXECUTE
-- retiré à PUBLIC) : plateforme_trouver_connexion, plateforme_ouvrir_session,
-- plateforme_echec_connexion, plateforme_resoudre_session, plateforme_fermer_session.
-- Les outils internes (plateforme_roles_cabinet, plateforme_session_verifiee,
-- plateforme_exiger_*, plateforme_journaliser) ne sont PAS accordés : ils ne s'exécutent
-- que dans une fonction SECURITY DEFINER, donc avec les droits du propriétaire.
--
-- Session : durée FIXE de 8 h décidée ici (l'API ne la fournit pas) ; à l'ouverture,
-- purge des sessions expirées du même super admin et plafond de 20 sessions simultanées
-- (la plus ancienne est supprimée). Les messages d'erreur ne reprennent jamais la valeur
-- reçue (pas d'e-mail, de haché ni de jeton dans un journal applicatif).

-- Les 8 rôles du cabinet (0001, 0110) : les seuls que la plateforme attribue ou liste.
CREATE FUNCTION plateforme_roles_cabinet() RETURNS text[]
  LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp
  AS $$ SELECT ARRAY['associe', 'directeur_mission', 'chef_mission', 'consultant', 'ressources',
                     'gestionnaire', 'expert_metier', 'expert_externe']::text[] $$;

-- Revérifie la session (existe, non expirée, super admin actif) ; sinon MQP01.
CREATE FUNCTION plateforme_session_verifiee(p_jeton_hash text) RETURNS uuid
  LANGUAGE plpgsql STABLE SET search_path = public, pg_temp
  AS $$
  DECLARE v_admin uuid;
  BEGIN
    SELECT a.id INTO v_admin
      FROM plateforme_sessions s JOIN super_admins a ON a.id = s.super_admin_id
      WHERE s.jeton_hash = p_jeton_hash AND s.expire_le > now() AND a.actif;
    IF v_admin IS NULL THEN
      RAISE EXCEPTION 'Session de plateforme invalide ou expirée.' USING ERRCODE = 'MQP01';
    END IF;
    RETURN v_admin;
  END $$;

-- Texte obligatoire (nom) : renvoyé sans espaces de bord ; vide, trop long ou avec
-- caractère de contrôle : MQP04.
CREATE FUNCTION plateforme_exiger_nom(p_valeur text) RETURNS text
  LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp
  AS $$
  DECLARE v text := btrim(p_valeur);
  BEGIN
    IF v IS NULL OR length(v) NOT BETWEEN 1 AND 200 OR v ~ '[[:cntrl:]]' THEN
      RAISE EXCEPTION 'Nom vide ou invalide.' USING ERRCODE = 'MQP04';
    END IF;
    RETURN v;
  END $$;

CREATE FUNCTION plateforme_exiger_email(p_valeur text) RETURNS text
  LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp
  AS $$
  DECLARE v text := btrim(p_valeur);
  BEGIN
    IF v IS NULL OR length(v) NOT BETWEEN 3 AND 254
       OR v !~ '^[^[:space:][:cntrl:]@]+@[^[:space:][:cntrl:]@]+$' THEN
      RAISE EXCEPTION 'E-mail vide ou invalide.' USING ERRCODE = 'MQP04';
    END IF;
    RETURN v;
  END $$;

CREATE FUNCTION plateforme_exiger_pays(p_valeur text) RETURNS text
  LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF p_valeur IS NULL OR p_valeur !~ '^[A-Z]{2}$' THEN
      RAISE EXCEPTION 'Pays invalide (deux lettres majuscules).' USING ERRCODE = 'MQP04';
    END IF;
    RETURN p_valeur;
  END $$;

-- Haché scrypt au format de src/auth/password.ts : refuse un mot de passe en clair.
CREATE FUNCTION plateforme_exiger_hash(p_valeur text) RETURNS text
  LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF p_valeur IS NULL
       OR p_valeur !~ '^scrypt\$[0-9]+\$[A-Za-z0-9+/]+={0,2}\$[A-Za-z0-9+/]+={0,2}$' THEN
      RAISE EXCEPTION 'Haché de mot de passe invalide.' USING ERRCODE = 'MQP04';
    END IF;
    RETURN p_valeur;
  END $$;

-- 1 à 8 rôles du cabinet, sans doublon ni valeur nulle, tableau à une dimension.
CREATE FUNCTION plateforme_exiger_roles(p_roles text[]) RETURNS text[]
  LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF p_roles IS NULL OR cardinality(p_roles) NOT BETWEEN 1 AND 8
       OR array_ndims(p_roles) <> 1
       OR array_position(p_roles, NULL) IS NOT NULL
       OR NOT (p_roles <@ plateforme_roles_cabinet())
       OR (SELECT count(DISTINCT r) FROM unnest(p_roles) r) <> cardinality(p_roles) THEN
      RAISE EXCEPTION 'Rôles non admis (1 à 8 rôles du cabinet, sans doublon).'
        USING ERRCODE = 'MQP04';
    END IF;
    RETURN p_roles;
  END $$;

CREATE FUNCTION plateforme_journaliser(p_super_admin_id uuid, p_action text, p_cible text,
  p_cible_id text, p_cabinet_id uuid, p_details jsonb) RETURNS void
  LANGUAGE sql SET search_path = public, pg_temp
  AS $$ INSERT INTO journal_plateforme (super_admin_id, action, cible, cible_id, cabinet_id, details)
        VALUES (p_super_admin_id, p_action, p_cible, p_cible_id, p_cabinet_id,
                coalesce(p_details, '{}'::jsonb)) $$;

REVOKE ALL ON FUNCTION plateforme_roles_cabinet(), plateforme_session_verifiee(text),
  plateforme_exiger_nom(text), plateforme_exiger_email(text), plateforme_exiger_pays(text),
  plateforme_exiger_hash(text), plateforme_exiger_roles(text[]),
  plateforme_journaliser(uuid, text, text, text, uuid, jsonb) FROM PUBLIC;

-- 1. Première étape de la connexion : e-mail insensible à la casse.
CREATE FUNCTION plateforme_trouver_connexion(p_email text)
  RETURNS TABLE (super_admin_id uuid, mot_de_passe_hash text, actif boolean)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT a.id, a.mot_de_passe_hash, a.actif FROM super_admins a
        WHERE lower(a.email) = lower(btrim(p_email)) $$;

-- 2. Ouverture de session (après vérification du mot de passe par l'API).
CREATE FUNCTION plateforme_ouvrir_session(p_super_admin_id uuid, p_jeton_hash text)
  RETURNS timestamptz
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE v_expire timestamptz;
  BEGIN
    -- Verrou du super admin : deux ouvertures simultanées ne dépassent pas le plafond.
    PERFORM 1 FROM super_admins a WHERE a.id = p_super_admin_id AND a.actif FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Session de plateforme invalide ou expirée.' USING ERRCODE = 'MQP01';
    END IF;
    DELETE FROM plateforme_sessions s
      WHERE s.super_admin_id = p_super_admin_id AND s.expire_le <= now();
    -- Plafond de 20 : on garde les 19 plus récentes avant d'ajouter la nouvelle.
    DELETE FROM plateforme_sessions s WHERE s.id IN (
      SELECT x.id FROM plateforme_sessions x
      WHERE x.super_admin_id = p_super_admin_id
      ORDER BY x.cree_le DESC, x.id DESC
      OFFSET 19);
    INSERT INTO plateforme_sessions AS s (super_admin_id, jeton_hash, expire_le)
      VALUES (p_super_admin_id, p_jeton_hash, now() + interval '8 hours')
      RETURNING s.expire_le INTO v_expire;
    PERFORM plateforme_journaliser(p_super_admin_id, 'connexion', 'super_admin',
                                   p_super_admin_id::text, NULL, '{}'::jsonb);
    RETURN v_expire;
  END $$;

-- 3. Échec de connexion d'un super admin connu : journalisé sans autre donnée.
CREATE FUNCTION plateforme_echec_connexion(p_super_admin_id uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF EXISTS (SELECT 1 FROM super_admins a WHERE a.id = p_super_admin_id) THEN
      PERFORM plateforme_journaliser(p_super_admin_id, 'connexion_echec', 'super_admin',
                                     p_super_admin_id::text, NULL, '{}'::jsonb);
    END IF;
  END $$;

-- 4. Résolution de session : aucune ligne si invalide, expirée ou super admin inactif.
CREATE FUNCTION plateforme_resoudre_session(p_jeton_hash text)
  RETURNS TABLE (super_admin_id uuid, email text, nom text, est_demo boolean)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT a.id, a.email, a.nom, a.est_demo
        FROM plateforme_sessions s JOIN super_admins a ON a.id = s.super_admin_id
        WHERE s.jeton_hash = p_jeton_hash AND s.expire_le > now() AND a.actif $$;

-- 5. Déconnexion : idempotente ; journalisée si la session existait.
CREATE FUNCTION plateforme_fermer_session(p_jeton_hash text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE v_admin uuid;
  BEGIN
    DELETE FROM plateforme_sessions s WHERE s.jeton_hash = p_jeton_hash
      RETURNING s.super_admin_id INTO v_admin;
    IF v_admin IS NOT NULL THEN
      PERFORM plateforme_journaliser(v_admin, 'deconnexion', 'super_admin', v_admin::text,
                                     NULL, '{}'::jsonb);
    END IF;
  END $$;

REVOKE ALL ON FUNCTION plateforme_trouver_connexion(text), plateforme_ouvrir_session(uuid, text),
  plateforme_echec_connexion(uuid), plateforme_resoudre_session(text),
  plateforme_fermer_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plateforme_trouver_connexion(text), plateforme_ouvrir_session(uuid, text),
  plateforme_echec_connexion(uuid), plateforme_resoudre_session(text),
  plateforme_fermer_session(text) TO missionpilot_app;
