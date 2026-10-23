-- Super admin de démonstration = BAC À SABLE (lot 2b ; codes MQP : voir 0570).
--
-- Un super admin `est_demo` (posé uniquement par le SQL propriétaire, 0571) n'atteint QUE
-- les cabinets `est_demo` :
-- - les autres cabinets sont absents de plateforme_lister_cabinets (compteurs compris) ;
-- - tout accès par identifiant à un autre cabinet (modification du cabinet, liste,
--   création ou modification de ses comptes) répond comme un cabinet inconnu : MQP02,
--   même code, même message, sans verrou posé sur le cabinet réel ;
-- - un cabinet qu'il crée naît `est_demo = true` (il apparaît ensuite dans la connexion de
--   démonstration « un clic », 0580). C'est la SEULE exception à « aucune fonction ne pose
--   est_demo à vrai » (0570, 0573, 0580) ; l'API n'a toujours aucun paramètre pour poser
--   est_demo, et un super admin réel crée toujours `est_demo = false`.
-- - il ne crée de compte (associé d'un nouveau cabinet, ou compte d'un cabinet) qu'avec une
--   adresse en `.test` (TLD réservé, RFC 2606), sinon MQP04 AVANT toute lecture des comptes
--   existants : les e-mails étant uniques sur toute la plateforme, une adresse réelle
--   donnerait sinon un oracle d'existence (23505) à tout visiteur de la démonstration
--   publique. Une collision entre adresses `.test` reste un 23505 ordinaire ;
-- - plafonds durs : 30 cabinets `est_demo` au plus dans toute la base (semis compris) pour
--   en créer un, 40 comptes au plus (portail compris) dans un cabinet de démonstration pour
--   y en créer un ; au-delà, MQP04. Contrôle sous verrou consultatif transactionnel dédié
--   (un pour les cabinets, un par cabinet pour les comptes) : deux créations simultanées
--   ne dépassent pas le plafond.
-- Ces refus MQP04 portent un indice (HINT) stable — demo_email_test, demo_plafond_cabinets,
-- demo_plafond_utilisateurs — que l'API traduit en message fixe (plateforme/service.ts).
-- Un super admin réel garde exactement le comportement de 0573 (mêmes lignes, colonnes,
-- verrous, journaux et codes d'erreur), sans plafond ni contrainte d'adresse.
--
-- Les six fonctions accordées de 0573 sont redéfinies (CREATE OR REPLACE : mêmes
-- signatures, mêmes paramètres, mêmes sorties, mêmes droits) en reprenant leurs corps à
-- l'identique, au filtrage et aux contrôles de démonstration près. Journaux (journal_plateforme et journal d'audit du
-- cabinet) inchangés. Aucun nouveau SQLSTATE. Les fonctions demo_* (0580, 0581) ne changent
-- pas.
--
-- Pose d'est_demo à la création : creer_cabinet (0001) insère le cabinet avec est_demo
-- faux, puis plateforme_creer_cabinet le passe à vrai par un UPDATE. Le déclencheur
-- cabinets_garder_etat_plateforme (0570) l'admet parce que la fonction est SECURITY DEFINER
-- (current_user = propriétaire de la table) ; le rôle applicatif reste refusé en direct
-- (42501).
--
-- Outils internes NON accordés au rôle applicatif (ils ne s'exécutent que dans une fonction
-- SECURITY DEFINER, donc avec les droits du propriétaire) : plateforme_admin_demo,
-- plateforme_cabinet_visible.

-- Le super admin est-il un bac à sable ? Introuvable (ne devrait pas arriver après
-- plateforme_session_verifiee) : traité comme un bac à sable (fermeture par défaut).
CREATE FUNCTION plateforme_admin_demo(p_super_admin_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SET search_path = public, pg_temp
  AS $$ SELECT coalesce((SELECT a.est_demo FROM super_admins a
                         WHERE a.id = p_super_admin_id), true) $$;

-- Existence ET visibilité d'un cabinet pour ce super admin, avec le verrou de la fonction
-- appelante ('exclusif' = FOR UPDATE, 'partage' = FOR SHARE, 'aucun'). La visibilité est
-- dans la condition de la requête : un cabinet réel n'est jamais verrouillé pour un super
-- admin de démonstration, et l'état relu après une attente de verrou fait foi. Inconnu ou
-- invisible : MQP02 (même erreur que 0573).
CREATE FUNCTION plateforme_cabinet_visible(p_super_admin_id uuid, p_cabinet_id uuid,
  p_verrou text) RETURNS void
  LANGUAGE plpgsql SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_demo boolean := plateforme_admin_demo(p_super_admin_id);
  BEGIN
    IF p_verrou = 'exclusif' THEN
      PERFORM 1 FROM cabinets c
        WHERE c.id = p_cabinet_id AND (c.est_demo OR NOT v_demo) FOR UPDATE;
    ELSIF p_verrou = 'partage' THEN
      PERFORM 1 FROM cabinets c
        WHERE c.id = p_cabinet_id AND (c.est_demo OR NOT v_demo) FOR SHARE;
    ELSIF p_verrou = 'aucun' THEN
      PERFORM 1 FROM cabinets c
        WHERE c.id = p_cabinet_id AND (c.est_demo OR NOT v_demo);
    ELSE
      RAISE EXCEPTION 'Mode de verrou non prévu.';
    END IF;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Cabinet introuvable.' USING ERRCODE = 'MQP02';
    END IF;
  END $$;

REVOKE ALL ON FUNCTION plateforme_admin_demo(uuid),
  plateforme_cabinet_visible(uuid, uuid, text) FROM PUBLIC;

-- 6. Liste des cabinets (0573), restreinte aux cabinets de démonstration pour un super
--    admin de démonstration.
CREATE OR REPLACE FUNCTION plateforme_lister_cabinets(p_jeton_hash text)
  RETURNS TABLE (id uuid, nom text, pays text, actif boolean, est_demo boolean,
                 cree_le timestamptz, nb_utilisateurs int, nb_utilisateurs_actifs int)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_admin uuid := plateforme_session_verifiee(p_jeton_hash);
    v_demo boolean := plateforme_admin_demo(v_admin);
  BEGIN
    RETURN QUERY
      SELECT c.id, c.nom, c.pays::text, c.actif, c.est_demo, c.cree_le,
             count(u.id)::int, (count(u.id) FILTER (WHERE u.actif))::int
      FROM cabinets c
      LEFT JOIN utilisateurs u
        ON u.cabinet_id = c.id AND u.roles <@ plateforme_roles_cabinet()
      WHERE c.est_demo OR NOT v_demo
      GROUP BY c.id
      ORDER BY c.nom, c.id;
  END $$;

-- 7. Création d'un cabinet et de son associé (0573) ; un super admin de démonstration crée
--    un cabinet de démonstration.
CREATE OR REPLACE FUNCTION plateforme_creer_cabinet(p_jeton_hash text, p_nom text,
  p_pays text, p_email text, p_nom_associe text, p_hash text)
  RETURNS TABLE (cabinet_id uuid, utilisateur_id uuid)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_admin uuid := plateforme_session_verifiee(p_jeton_hash);
    v_nom text := plateforme_exiger_nom(p_nom);
    v_pays text := plateforme_exiger_pays(p_pays);
    v_email text := plateforme_exiger_email(p_email);
    v_nom_associe text := plateforme_exiger_nom(p_nom_associe);
    v_hash text := plateforme_exiger_hash(p_hash);
    v_demo boolean := plateforme_admin_demo(v_admin);
    v_cabinet uuid;
    v_utilisateur uuid;
  BEGIN
    IF v_demo THEN
      IF lower(v_email) !~ '\.test$' THEN
        RAISE EXCEPTION 'Une adresse en .test est exigée en mode démonstration.'
          USING ERRCODE = 'MQP04', HINT = 'demo_email_test';
      END IF;
      PERFORM pg_advisory_xact_lock(hashtextextended('plateforme:demo_cabinets', 0));
      IF (SELECT count(*) FROM cabinets c WHERE c.est_demo) >= 30 THEN
        RAISE EXCEPTION 'Plafond de la démonstration atteint : 30 cabinets au plus.'
          USING ERRCODE = 'MQP04', HINT = 'demo_plafond_cabinets';
      END IF;
    END IF;
    v_cabinet := creer_cabinet(v_nom, v_pays::char(2), v_email, v_nom_associe, v_hash);
    IF v_demo THEN
      UPDATE cabinets c SET est_demo = true WHERE c.id = v_cabinet;
    END IF;
    SELECT u.id INTO STRICT v_utilisateur FROM utilisateurs u WHERE u.cabinet_id = v_cabinet;
    PERFORM plateforme_journaliser(v_admin, 'cabinet_creation', 'cabinet', v_cabinet::text,
      v_cabinet, jsonb_build_object('nom', v_nom, 'pays', v_pays,
                                    'associe_id', v_utilisateur));
    PERFORM plateforme_journal_cabinet(v_admin, v_cabinet, 'plateforme.cabinet_creation',
      'cabinet', v_cabinet::text,
      jsonb_build_object('pays', v_pays, 'associe_id', v_utilisateur));
    RETURN QUERY SELECT v_cabinet, v_utilisateur;
  END $$;

-- 8. Modification d'un cabinet (0573) : verrou et MQP02 par plateforme_cabinet_visible.
CREATE OR REPLACE FUNCTION plateforme_modifier_cabinet(p_jeton_hash text, p_cabinet_id uuid,
  p_nom text, p_actif boolean)
  RETURNS TABLE (id uuid, nom text, pays text, actif boolean, est_demo boolean,
                 cree_le timestamptz)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_admin uuid := plateforme_session_verifiee(p_jeton_hash);
    v_nom text;
  BEGIN
    PERFORM plateforme_cabinet_visible(v_admin, p_cabinet_id, 'exclusif');
    IF p_nom IS NULL AND p_actif IS NULL THEN
      RAISE EXCEPTION 'Aucun champ à modifier.' USING ERRCODE = 'MQP04';
    END IF;
    IF p_nom IS NOT NULL THEN
      v_nom := plateforme_exiger_nom(p_nom);
    END IF;
    UPDATE cabinets c SET nom = coalesce(v_nom, c.nom), actif = coalesce(p_actif, c.actif)
      WHERE c.id = p_cabinet_id;
    IF p_actif IS FALSE THEN
      DELETE FROM sessions s WHERE s.cabinet_id = p_cabinet_id;
      DELETE FROM defis_2fa d WHERE d.cabinet_id = p_cabinet_id;
    END IF;
    PERFORM plateforme_journaliser(v_admin, 'cabinet_modification', 'cabinet',
      p_cabinet_id::text, p_cabinet_id,
      jsonb_strip_nulls(jsonb_build_object('nom', v_nom, 'actif', p_actif)));
    PERFORM plateforme_journal_cabinet(v_admin, p_cabinet_id, 'plateforme.cabinet_modification',
      'cabinet', p_cabinet_id::text,
      jsonb_strip_nulls(jsonb_build_object('nom', v_nom, 'actif', p_actif)));
    RETURN QUERY
      SELECT c.id, c.nom, c.pays::text, c.actif, c.est_demo, c.cree_le
      FROM cabinets c WHERE c.id = p_cabinet_id;
  END $$;

-- 9. Comptes du cabinet, hors portail client (0573).
CREATE OR REPLACE FUNCTION plateforme_lister_utilisateurs(p_jeton_hash text, p_cabinet_id uuid)
  RETURNS TABLE (id uuid, email text, nom text, roles text[], actif boolean,
                 cree_le timestamptz)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_admin uuid := plateforme_session_verifiee(p_jeton_hash);
  BEGIN
    PERFORM plateforme_cabinet_visible(v_admin, p_cabinet_id, 'aucun');
    RETURN QUERY
      SELECT u.id, u.email, u.nom, u.roles, u.actif, u.cree_le
      FROM utilisateurs u
      WHERE u.cabinet_id = p_cabinet_id AND u.roles <@ plateforme_roles_cabinet()
      ORDER BY u.nom, u.id;
  END $$;

-- 10. Création d'un compte du cabinet (0573). E-mail déjà pris : 23505 laissé tel quel.
CREATE OR REPLACE FUNCTION plateforme_creer_utilisateur(p_jeton_hash text, p_cabinet_id uuid,
  p_email text, p_nom text, p_roles text[], p_hash text)
  RETURNS TABLE (id uuid, email text, nom text, roles text[], actif boolean,
                 cree_le timestamptz)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_admin uuid := plateforme_session_verifiee(p_jeton_hash);
    v_id uuid;
    v_email text;
    v_nom text;
    v_roles text[];
    v_hash text;
  BEGIN
    PERFORM plateforme_cabinet_visible(v_admin, p_cabinet_id, 'partage');
    v_email := plateforme_exiger_email(p_email);
    v_nom := plateforme_exiger_nom(p_nom);
    v_roles := plateforme_exiger_roles(p_roles);
    v_hash := plateforme_exiger_hash(p_hash);
    IF plateforme_admin_demo(v_admin) THEN
      IF lower(v_email) !~ '\.test$' THEN
        RAISE EXCEPTION 'Une adresse en .test est exigée en mode démonstration.'
          USING ERRCODE = 'MQP04', HINT = 'demo_email_test';
      END IF;
      -- Le verrou partagé du cabinet ne sérialise pas deux créations : verrou dédié.
      PERFORM pg_advisory_xact_lock(
        hashtextextended('plateforme:demo_utilisateurs:' || p_cabinet_id::text, 0));
      IF (SELECT count(*) FROM utilisateurs x WHERE x.cabinet_id = p_cabinet_id) >= 40 THEN
        RAISE EXCEPTION 'Plafond de la démonstration atteint : 40 comptes au plus par cabinet.'
          USING ERRCODE = 'MQP04', HINT = 'demo_plafond_utilisateurs';
      END IF;
    END IF;
    INSERT INTO utilisateurs AS u (cabinet_id, email, nom, roles, mot_de_passe_hash)
      VALUES (p_cabinet_id, v_email, v_nom, v_roles, v_hash)
      RETURNING u.id INTO v_id;
    PERFORM plateforme_journaliser(v_admin, 'utilisateur_creation', 'utilisateur', v_id::text,
      p_cabinet_id, jsonb_build_object('roles', to_jsonb(v_roles)));
    PERFORM plateforme_journal_cabinet(v_admin, p_cabinet_id, 'plateforme.utilisateur_creation',
      'utilisateur', v_id::text, jsonb_build_object('roles', to_jsonb(v_roles)));
    RETURN QUERY
      SELECT u.id, u.email, u.nom, u.roles, u.actif, u.cree_le
      FROM utilisateurs u WHERE u.id = v_id;
  END $$;

-- 11. Modification d'un compte du cabinet (0573) : verrou du cabinet (exclusif) puis du
--     compte, MQP03, MQP04, MQP05, sessions et consentements inchangés.
CREATE OR REPLACE FUNCTION plateforme_modifier_utilisateur(p_jeton_hash text,
  p_cabinet_id uuid, p_utilisateur_id uuid, p_actif boolean, p_roles text[])
  RETURNS TABLE (id uuid, email text, nom text, roles text[], actif boolean,
                 cree_le timestamptz)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_admin uuid := plateforme_session_verifiee(p_jeton_hash);
    v_actif_avant boolean;
    v_roles_avant text[];
    v_actif boolean;
    v_roles text[];
    v_canaux text[] := '{}';
  BEGIN
    PERFORM plateforme_cabinet_visible(v_admin, p_cabinet_id, 'exclusif');
    SELECT u.actif, u.roles INTO v_actif_avant, v_roles_avant
      FROM utilisateurs u
      WHERE u.id = p_utilisateur_id AND u.cabinet_id = p_cabinet_id
      FOR UPDATE;
    IF NOT FOUND OR NOT (v_roles_avant <@ plateforme_roles_cabinet()) THEN
      RAISE EXCEPTION 'Utilisateur introuvable dans ce cabinet.' USING ERRCODE = 'MQP03';
    END IF;
    IF p_actif IS NULL AND p_roles IS NULL THEN
      RAISE EXCEPTION 'Aucun champ à modifier.' USING ERRCODE = 'MQP04';
    END IF;
    IF p_roles IS NOT NULL THEN
      v_roles := plateforme_exiger_roles(p_roles);
    END IF;
    v_actif := coalesce(p_actif, v_actif_avant);
    IF v_actif_avant AND 'associe' = ANY (v_roles_avant)
       AND NOT (v_actif AND 'associe' = ANY (coalesce(v_roles, v_roles_avant)))
       AND NOT EXISTS (SELECT 1 FROM utilisateurs x
                       WHERE x.cabinet_id = p_cabinet_id AND x.id <> p_utilisateur_id
                         AND x.actif AND 'associe' = ANY (x.roles)) THEN
      RAISE EXCEPTION 'Le cabinet doit garder au moins un associé actif.' USING ERRCODE = 'MQP05';
    END IF;
    UPDATE utilisateurs u SET actif = v_actif, roles = coalesce(v_roles, u.roles)
      WHERE u.id = p_utilisateur_id;
    IF NOT v_actif THEN
      DELETE FROM sessions s WHERE s.utilisateur_id = p_utilisateur_id;
    END IF;
    -- Seul un passage de actif à inactif retire les consentements (comme routes/utilisateurs.ts).
    IF v_actif_avant AND NOT v_actif THEN
      v_canaux := plateforme_retirer_consentements(p_cabinet_id, p_utilisateur_id);
      IF cardinality(v_canaux) > 0 THEN
        PERFORM plateforme_journal_cabinet(v_admin, p_cabinet_id, 'canal.consentement.retirer',
          'utilisateur', p_utilisateur_id::text,
          jsonb_build_object('canaux', to_jsonb(v_canaux),
                             'source', 'desactivation_utilisateur', 'origine', 'plateforme'));
      END IF;
    END IF;
    PERFORM plateforme_journaliser(v_admin, 'utilisateur_modification', 'utilisateur',
      p_utilisateur_id::text, p_cabinet_id,
      jsonb_strip_nulls(jsonb_build_object('actif', p_actif, 'roles', to_jsonb(v_roles))));
    PERFORM plateforme_journal_cabinet(v_admin, p_cabinet_id,
      'plateforme.utilisateur_modification', 'utilisateur', p_utilisateur_id::text,
      jsonb_strip_nulls(jsonb_build_object('actif', p_actif, 'roles', to_jsonb(v_roles))));
    RETURN QUERY
      SELECT u.id, u.email, u.nom, u.roles, u.actif, u.cree_le
      FROM utilisateurs u WHERE u.id = p_utilisateur_id;
  END $$;

-- CREATE OR REPLACE conserve les droits ; ils sont rappelés à l'identique de 0573.
REVOKE ALL ON FUNCTION plateforme_lister_cabinets(text),
  plateforme_creer_cabinet(text, text, text, text, text, text),
  plateforme_modifier_cabinet(text, uuid, text, boolean),
  plateforme_lister_utilisateurs(text, uuid),
  plateforme_creer_utilisateur(text, uuid, text, text, text[], text),
  plateforme_modifier_utilisateur(text, uuid, uuid, boolean, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plateforme_lister_cabinets(text),
  plateforme_creer_cabinet(text, text, text, text, text, text),
  plateforme_modifier_cabinet(text, uuid, text, boolean),
  plateforme_lister_utilisateurs(text, uuid),
  plateforme_creer_utilisateur(text, uuid, text, text, text[], text),
  plateforme_modifier_utilisateur(text, uuid, uuid, boolean, text[]) TO missionpilot_app;
