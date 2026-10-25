-- Connexion de démonstration (lot 5) : la liste ne propose plus un compte que la 2FA rendrait
-- inconnectable. La connexion rapide ne contourne jamais la 2FA (403 CONNEXION_RAPIDE_2FA) ;
-- lister un tel compte le montrait cliquable à tort.
--
-- Un compte est « bloqué par la 2FA » (demo_tfa_bloquante, même décision que lireEtat de
-- src/auth/double-authentification.ts, hors plancher plateforme TOTP_REQUIS qui est une
-- variable de l'API, filtrée par la route) quand :
-- - sa 2FA est active (utilisateurs_2fa.active_le), ou
-- - compte du cabinet : l'un de ses rôles figure dans cabinets.tfa_obligatoire, ou
-- - compte du portail : portail_parametres.tfa_obligatoire est vrai pour son cabinet.
--
-- Seule la LISTE (demo_lister_comptes) les écarte. La recherche (demo_trouver_compte) et
-- demo_comptes_ouvrables sont inchangées : un compte non listé mais connu reste refusé en 403
-- (et non en 401) quand on le demande. « Listé implique trouvable », la réciproque est
-- fausse pour ces comptes. Les bornes (50 comptes par cabinet) s'appliquent avant ce filtre.
-- La fonction interne n'est pas accordée au rôle applicatif ; demo_lister_comptes garde sa
-- signature, ses droits (EXECUTE au seul rôle applicatif) et son search_path verrouillé.
CREATE FUNCTION demo_tfa_bloquante(p_cabinet_id uuid, p_utilisateur_id uuid,
  p_portail boolean, p_roles text[]) RETURNS boolean
  LANGUAGE sql STABLE SET search_path = public, pg_temp
  AS $$ SELECT EXISTS (SELECT 1 FROM utilisateurs_2fa t
                       WHERE t.utilisateur_id = demo_tfa_bloquante.p_utilisateur_id
                         AND t.active_le IS NOT NULL)
            OR CASE WHEN demo_tfa_bloquante.p_portail
                    THEN coalesce((SELECT pp.tfa_obligatoire FROM portail_parametres pp
                                   WHERE pp.cabinet_id = demo_tfa_bloquante.p_cabinet_id), false)
                    ELSE EXISTS (SELECT 1 FROM cabinets c
                                 WHERE c.id = demo_tfa_bloquante.p_cabinet_id
                                   AND c.tfa_obligatoire && demo_tfa_bloquante.p_roles)
               END $$;
REVOKE ALL ON FUNCTION demo_tfa_bloquante(uuid, uuid, boolean, text[]) FROM PUBLIC;

CREATE OR REPLACE FUNCTION demo_lister_comptes()
  RETURNS TABLE (cabinet_id uuid, cabinet_nom text, email text, nom text, roles text[],
                 portail boolean)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT o.cabinet_id, o.cabinet_nom, o.email, o.nom, o.roles, o.portail
        FROM demo_comptes_ouvrables() o
        WHERE NOT demo_tfa_bloquante(o.cabinet_id, o.utilisateur_id, o.portail, o.roles)
        ORDER BY lower(o.cabinet_nom), o.cabinet_id, o.portail, lower(o.email),
                 o.utilisateur_id $$;

-- CREATE OR REPLACE conserve les droits ; ils sont rappelés pour la relecture.
REVOKE ALL ON FUNCTION demo_lister_comptes() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION demo_lister_comptes() TO missionpilot_app;
