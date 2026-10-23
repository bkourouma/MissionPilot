-- Connexion rapide de démonstration généralisée (super admin, lot 2b) : comptes des
-- cabinets de démonstration et super admins de démonstration.
--
-- Ouvre, côté API, une session SANS mot de passe : traitée comme une porte dérobée
-- potentielle (docs/governance/SECURITY.md §3, « Connexion rapide »). L'API n'atteint ces
-- comptes QUE par les quatre fonctions ci-dessous (SECURITY DEFINER, search_path fixe,
-- EXECUTE retiré à PUBLIC puis accordé au seul rôle applicatif) ; elle décide seule si la
-- connexion rapide est active (config.ts). Aucune table, aucune politique RLS ni aucun
-- droit existant n'est modifié ; aucun nouveau SQLSTATE (un refus rend zéro ligne).
--
-- Périmètre, posé UNIQUEMENT par le SQL propriétaire (aucune fonction ni route ne pose
-- `est_demo` à vrai, voir 0570) :
-- - les cabinets `est_demo` ET `actif`, leurs comptes actifs d'une famille de rôles pure
--   (que des rôles du cabinet, ou que des rôles client ; jamais un mélange, un rôle
--   inconnu ni un tableau vide) ; un compte du portail client (rôles client) seulement
--   s'il a un rattachement `utilisateurs_portail` actif à un client actif du même cabinet
--   (même logique que routes/connexion-demo.ts) ;
-- - les super admins `est_demo` ET `actif`.
-- Bornes en dur : 50 cabinets (ceux qui ont au moins un compte ouvrable, dans l'ordre de
-- la liste) et 50 comptes par cabinet ; 20 super admins.
--
-- Garanties :
-- - la liste (demo_lister_comptes) et la recherche (demo_trouver_compte) lisent le MÊME
--   ensemble (demo_comptes_ouvrables, bornes comprises) : un compte listé est trouvable,
--   un compte trouvable est listé ;
-- - aucune fonction ne renvoie de haché, de jeton, d'identifiant de client ni de donnée
--   métier ; la liste ne renvoie aucun identifiant de compte (cabinet_id est le seul
--   identifiant), la recherche renvoie l'identifiant du compte trouvé, nécessaire à
--   l'ouverture de sa session ;
-- - demo_ouvrir_session_plateforme verrouille la ligne du super admin (FOR UPDATE) avant
--   d'ouvrir la session : une désactivation ou un retrait de `est_demo` concurrent est
--   soit attendu, soit vu (zéro ligne, rien d'écrit). La session est ouverte par
--   plateforme_ouvrir_session (0572 : durée de 8 h, purge et plafond de 20, journal
--   « connexion ») ; une seconde ligne « connexion » de détail {"demo": true} marque
--   l'ouverture sans mot de passe (CHECK de journal_plateforme inchangé).
--
-- Fonctions internes NON accordées au rôle applicatif (elles ne s'exécutent que dans une
-- fonction SECURITY DEFINER, donc avec les droits du propriétaire) : demo_roles_client,
-- demo_comptes_ouvrables.

-- Les 3 rôles client du portail (0110), disjoints des 8 rôles du cabinet.
CREATE FUNCTION demo_roles_client() RETURNS text[]
  LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp
  AS $$ SELECT ARRAY['client_dirigeant', 'client_contributeur', 'client_investisseur']::text[] $$;

-- Comptes ouvrables par la connexion rapide, bornes appliquées. Seule source de la liste
-- et de la recherche. Classement : lower(nom du cabinet), cabinet, comptes du cabinet
-- avant ceux du portail, lower(e-mail), identifiant.
CREATE FUNCTION demo_comptes_ouvrables()
  RETURNS TABLE (cabinet_id uuid, cabinet_nom text, utilisateur_id uuid, email text,
                 nom text, roles text[], portail boolean)
  LANGUAGE sql STABLE SET search_path = public, pg_temp
  AS $$
    WITH comptes AS (
      SELECT c.id AS cabinet_id, c.nom AS cabinet_nom, u.id AS utilisateur_id,
             u.email AS email, u.nom AS nom, u.roles AS roles,
             u.roles <@ demo_roles_client() AS portail
      FROM cabinets c
      JOIN utilisateurs u ON u.cabinet_id = c.id
      WHERE c.est_demo AND c.actif AND u.actif
        AND cardinality(u.roles) > 0
        AND (u.roles <@ plateforme_roles_cabinet()
             OR (u.roles <@ demo_roles_client()
                 AND EXISTS (SELECT 1 FROM utilisateurs_portail up
                             JOIN clients cl
                               ON cl.id = up.client_id AND cl.cabinet_id = up.cabinet_id
                             WHERE up.utilisateur_id = u.id AND up.cabinet_id = u.cabinet_id
                               AND up.statut = 'actif' AND cl.actif)))
    ),
    classes AS (
      SELECT k.cabinet_id, k.cabinet_nom, k.utilisateur_id, k.email, k.nom, k.roles,
             k.portail,
             dense_rank() OVER (ORDER BY lower(k.cabinet_nom), k.cabinet_id) AS rang_cabinet,
             row_number() OVER (PARTITION BY k.cabinet_id
                                ORDER BY k.portail, lower(k.email), k.utilisateur_id)
               AS rang_compte
      FROM comptes k
    )
    SELECT x.cabinet_id, x.cabinet_nom, x.utilisateur_id, x.email, x.nom, x.roles, x.portail
    FROM classes x
    WHERE x.rang_cabinet <= 50 AND x.rang_compte <= 50
  $$;

REVOKE ALL ON FUNCTION demo_roles_client(), demo_comptes_ouvrables() FROM PUBLIC;

-- 1. Liste des comptes ouvrables (écran de connexion rapide).
CREATE FUNCTION demo_lister_comptes()
  RETURNS TABLE (cabinet_id uuid, cabinet_nom text, email text, nom text, roles text[],
                 portail boolean)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT o.cabinet_id, o.cabinet_nom, o.email, o.nom, o.roles, o.portail
        FROM demo_comptes_ouvrables() o
        ORDER BY lower(o.cabinet_nom), o.cabinet_id, o.portail, lower(o.email),
                 o.utilisateur_id $$;

-- 2. Liste des super admins de démonstration.
CREATE FUNCTION demo_lister_super_admins()
  RETURNS TABLE (email text, nom text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT a.email, a.nom FROM super_admins a
        WHERE a.est_demo AND a.actif
        ORDER BY lower(a.email), a.id
        LIMIT 20 $$;

-- 3. Compte ouvrable d'un cabinet de démonstration (e-mail insensible à la casse) : zéro
--    ou une ligne ; aucune si le cabinet n'est pas celui du compte.
CREATE FUNCTION demo_trouver_compte(p_cabinet_id uuid, p_email text)
  RETURNS TABLE (utilisateur_id uuid, email text, nom text, roles text[], portail boolean)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT o.utilisateur_id, o.email, o.nom, o.roles, o.portail
        FROM demo_comptes_ouvrables() o
        WHERE o.cabinet_id = demo_trouver_compte.p_cabinet_id
          AND lower(o.email) = lower(demo_trouver_compte.p_email) $$;

-- 4. Session de plateforme d'un super admin de démonstration (e-mail insensible à la
--    casse). Aucun super admin de démonstration actif : zéro ligne, rien d'écrit.
CREATE FUNCTION demo_ouvrir_session_plateforme(p_email text, p_jeton_hash text)
  RETURNS TABLE (super_admin_id uuid, email text, nom text)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_admin uuid;
    v_email text;
    v_nom text;
  BEGIN
    -- Verrou de la ligne : l'état relu après une éventuelle attente fait foi.
    SELECT a.id, a.email, a.nom INTO v_admin, v_email, v_nom
      FROM super_admins a
      WHERE lower(a.email) = lower(demo_ouvrir_session_plateforme.p_email)
        AND a.est_demo AND a.actif
      FOR UPDATE;
    IF v_admin IS NULL THEN
      RETURN;
    END IF;
    PERFORM plateforme_ouvrir_session(v_admin, demo_ouvrir_session_plateforme.p_jeton_hash);
    PERFORM plateforme_journaliser(v_admin, 'connexion', 'super_admin', v_admin::text, NULL,
                                   jsonb_build_object('demo', true));
    RETURN QUERY SELECT v_admin, v_email, v_nom;
  END $$;

REVOKE ALL ON FUNCTION demo_lister_comptes(), demo_lister_super_admins(),
  demo_trouver_compte(uuid, text), demo_ouvrir_session_plateforme(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION demo_lister_comptes(), demo_lister_super_admins(),
  demo_trouver_compte(uuid, text), demo_ouvrir_session_plateforme(text, text)
  TO missionpilot_app;
