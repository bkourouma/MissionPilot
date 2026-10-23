-- Super admin de plateforme (lot 1) : opérations sur les cabinets et leurs comptes
-- (codes MQP : voir 0570).
--
-- Chaque fonction reçoit en premier le HACHÉ du jeton de session de plateforme et
-- REVÉRIFIE la session (plateforme_session_verifiee, MQP01) avant toute lecture ; chaque
-- écriture est journalisée dans journal_plateforme, dans la même transaction, sans secret
-- (`details` : champs modifiés seulement, jamais le haché ni l'e-mail).
--
-- Périmètre : fiches des cabinets (identité, état) et comptes du cabinet (les 8 rôles du
-- cabinet). Les comptes du portail client (rôles client_*) ne sont ni listés, ni comptés,
-- ni modifiés (MQP03), ni créés (MQP04). Aucune donnée métier n'est lue ni renvoyée.
-- Aucune fonction ne pose `est_demo` à vrai.

-- Traçabilité côté cabinet : toute écriture plateforme laisse aussi une ligne dans le
-- journal d'audit DU CABINET cible (utilisateur_id NULL : l'auteur est un super admin, dont
-- l'identifiant figure dans `details`), pour que le cabinet voie ce que la plateforme a fait
-- chez lui. Ni secret, ni e-mail, ni haché. Fonction interne, non accordée au rôle applicatif.
CREATE FUNCTION plateforme_journal_cabinet(p_super_admin_id uuid, p_cabinet_id uuid,
  p_action text, p_entite text, p_entite_id text, p_details jsonb) RETURNS void
  LANGUAGE sql SET search_path = public, pg_temp
  AS $$ INSERT INTO journal_audit (cabinet_id, utilisateur_id, action, entite, entite_id, details)
        VALUES (p_cabinet_id, NULL, p_action, p_entite, p_entite_id,
                coalesce(p_details, '{}'::jsonb)
                || jsonb_build_object('super_admin_id', p_super_admin_id)) $$;
REVOKE ALL ON FUNCTION plateforme_journal_cabinet(uuid, uuid, text, text, text, jsonb) FROM PUBLIC;

-- Désactivation d'un compte : son consentement est retiré sur chacun de ses canaux (même
-- règle que canaux/consentements.ts, retirerConsentementsUtilisateur : source
-- `desactivation_utilisateur`, ligne `retire` seulement si l'état courant est « accordé »,
-- destinataire verrouillé, historique en ajout seul). CHECK de 0541 : un acteur est exigé
-- hors STOP ; faute de membre du cabinet à l'origine, l'acteur est le compte désactivé
-- lui-même. Renvoie les canaux retirés. Fonction interne.
CREATE FUNCTION plateforme_retirer_consentements(p_cabinet_id uuid, p_utilisateur_id uuid)
  RETURNS text[]
  LANGUAGE plpgsql SET search_path = public, pg_temp
  AS $$
  DECLARE
    d record;
    v_statut text;
    v_canaux text[] := '{}';
  BEGIN
    FOR d IN SELECT x.id, x.canal FROM canaux_destinataires x
             WHERE x.cabinet_id = p_cabinet_id AND x.utilisateur_id = p_utilisateur_id
             ORDER BY x.id FOR UPDATE
    LOOP
      SELECT c.statut INTO v_statut FROM canaux_consentements c
        WHERE c.destinataire_id = d.id ORDER BY c.id DESC LIMIT 1;
      IF v_statut = 'accorde' THEN
        INSERT INTO canaux_consentements (cabinet_id, destinataire_id, canal, statut, source,
                                          acteur_id)
          VALUES (p_cabinet_id, d.id, d.canal, 'retire', 'desactivation_utilisateur',
                  p_utilisateur_id);
        v_canaux := v_canaux || d.canal;
      END IF;
    END LOOP;
    RETURN v_canaux;
  END $$;
REVOKE ALL ON FUNCTION plateforme_retirer_consentements(uuid, uuid) FROM PUBLIC;

-- 6. Liste des cabinets, avec le nombre de comptes du cabinet (actifs et total).
CREATE FUNCTION plateforme_lister_cabinets(p_jeton_hash text)
  RETURNS TABLE (id uuid, nom text, pays text, actif boolean, est_demo boolean,
                 cree_le timestamptz, nb_utilisateurs int, nb_utilisateurs_actifs int)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    PERFORM plateforme_session_verifiee(p_jeton_hash);
    RETURN QUERY
      SELECT c.id, c.nom, c.pays::text, c.actif, c.est_demo, c.cree_le,
             count(u.id)::int, (count(u.id) FILTER (WHERE u.actif))::int
      FROM cabinets c
      LEFT JOIN utilisateurs u
        ON u.cabinet_id = c.id AND u.roles <@ plateforme_roles_cabinet()
      GROUP BY c.id
      ORDER BY c.nom, c.id;
  END $$;

-- 7. Création d'un cabinet et de son associé (creer_cabinet de 0001 : rôle `associe` ; le
--    déclencheur de 0030 sème les activités internes du cabinet).
CREATE FUNCTION plateforme_creer_cabinet(p_jeton_hash text, p_nom text, p_pays text,
  p_email text, p_nom_associe text, p_hash text)
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
    v_cabinet uuid;
    v_utilisateur uuid;
  BEGIN
    v_cabinet := creer_cabinet(v_nom, v_pays::char(2), v_email, v_nom_associe, v_hash);
    SELECT u.id INTO STRICT v_utilisateur FROM utilisateurs u WHERE u.cabinet_id = v_cabinet;
    PERFORM plateforme_journaliser(v_admin, 'cabinet_creation', 'cabinet', v_cabinet::text,
      v_cabinet, jsonb_build_object('nom', v_nom, 'pays', v_pays,
                                    'associe_id', v_utilisateur));
    PERFORM plateforme_journal_cabinet(v_admin, v_cabinet, 'plateforme.cabinet_creation',
      'cabinet', v_cabinet::text,
      jsonb_build_object('pays', v_pays, 'associe_id', v_utilisateur));
    RETURN QUERY SELECT v_cabinet, v_utilisateur;
  END $$;

-- 8. Modification d'un cabinet (NULL = inchangé). Désactiver supprime les sessions et les
--    défis de double authentification en cours de tous ses comptes (portail compris).
CREATE FUNCTION plateforme_modifier_cabinet(p_jeton_hash text, p_cabinet_id uuid,
  p_nom text, p_actif boolean)
  RETURNS TABLE (id uuid, nom text, pays text, actif boolean, est_demo boolean,
                 cree_le timestamptz)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_admin uuid := plateforme_session_verifiee(p_jeton_hash);
    v_nom text;
  BEGIN
    PERFORM 1 FROM cabinets c WHERE c.id = p_cabinet_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Cabinet introuvable.' USING ERRCODE = 'MQP02';
    END IF;
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

-- 9. Comptes du cabinet (hors portail client).
CREATE FUNCTION plateforme_lister_utilisateurs(p_jeton_hash text, p_cabinet_id uuid)
  RETURNS TABLE (id uuid, email text, nom text, roles text[], actif boolean,
                 cree_le timestamptz)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    PERFORM plateforme_session_verifiee(p_jeton_hash);
    IF NOT EXISTS (SELECT 1 FROM cabinets c WHERE c.id = p_cabinet_id) THEN
      RAISE EXCEPTION 'Cabinet introuvable.' USING ERRCODE = 'MQP02';
    END IF;
    RETURN QUERY
      SELECT u.id, u.email, u.nom, u.roles, u.actif, u.cree_le
      FROM utilisateurs u
      WHERE u.cabinet_id = p_cabinet_id AND u.roles <@ plateforme_roles_cabinet()
      ORDER BY u.nom, u.id;
  END $$;

-- 10. Création d'un compte du cabinet. E-mail déjà pris (toute la plateforme, insensible
--     à la casse) : 23505 laissé tel quel.
CREATE FUNCTION plateforme_creer_utilisateur(p_jeton_hash text, p_cabinet_id uuid,
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
    PERFORM 1 FROM cabinets c WHERE c.id = p_cabinet_id FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Cabinet introuvable.' USING ERRCODE = 'MQP02';
    END IF;
    v_email := plateforme_exiger_email(p_email);
    v_nom := plateforme_exiger_nom(p_nom);
    v_roles := plateforme_exiger_roles(p_roles);
    v_hash := plateforme_exiger_hash(p_hash);
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

-- 11. Modification d'un compte du cabinet (NULL = inchangé). Verrou du cabinet puis du
--     compte (même ordre que routes/utilisateurs.ts) : deux retraits simultanés ne
--     laissent pas le cabinet sans associé actif (MQP05). Désactiver supprime les sessions
--     du compte.
CREATE FUNCTION plateforme_modifier_utilisateur(p_jeton_hash text, p_cabinet_id uuid,
  p_utilisateur_id uuid, p_actif boolean, p_roles text[])
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
    PERFORM 1 FROM cabinets c WHERE c.id = p_cabinet_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Cabinet introuvable.' USING ERRCODE = 'MQP02';
    END IF;
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
