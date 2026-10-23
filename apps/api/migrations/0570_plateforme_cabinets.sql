-- Super admin de plateforme (lot 1) : état des cabinets et coupure à la désactivation.
--
-- Le super admin gère les cabinets et leurs comptes ; il ne lit JAMAIS de donnée
-- métier. Migrations du lot : 0570 (cette migration), 0571 (tables de la
-- plateforme), 0572 (fonctions de connexion et de session), 0573 (fonctions
-- d'opération). Le rôle applicatif n'a aucun droit direct sur les tables de la
-- plateforme : tout passe par les fonctions SECURITY DEFINER `plateforme_*`.
--
-- Préfixe SQLSTATE du domaine : `MQP` (plateforme).
-- - MQP01 session de plateforme invalide ou expirée, ou super admin inactif (API : 401)
-- - MQP02 cabinet introuvable (404)
-- - MQP03 utilisateur introuvable dans ce cabinet, ou compte du portail client (404)
-- - MQP04 paramètre invalide : rôle hors des 8 rôles du cabinet, liste de rôles vide,
--         trop longue ou avec doublon, nom ou e-mail vide, pays invalide, haché invalide,
--         modification sans aucun champ (400)
-- - MQP05 l'opération laisserait le cabinet sans associé actif (409)
-- - MQP06 journal_plateforme en ajout seul (UPDATE, DELETE et TRUNCATE refusés, même au
--         propriétaire)
-- E-mail déjà pris : violation d'unicité 23505 laissée telle quelle (API : 409).
--
-- Cette migration :
-- 1. ajoute `cabinets.actif` et `cabinets.est_demo` ; aucune fonction ni route ne pose
--    `est_demo` à vrai ;
-- 2. réserve ces deux colonnes au propriétaire des tables (donc aux fonctions SECURITY
--    DEFINER de la plateforme) : un rôle qui n'en est pas membre (le rôle applicatif,
--    même par une route de cabinet détournée) ne les modifie pas (42501). Déclencheur
--    plutôt que droits par colonne : une future colonne de `cabinets` reste modifiable
--    sans nouveau GRANT ;
-- 3. redéfinit `trouver_connexion` et `resoudre_session` (dernières définitions en
--    vigueur : 0001 ; mêmes signatures et mêmes colonnes de sortie) : un cabinet désactivé
--    coupe immédiatement la connexion (actif = faux) et les sessions existantes (aucune
--    ligne) de tous ses utilisateurs, portail client compris.

ALTER TABLE cabinets
  ADD COLUMN actif boolean NOT NULL DEFAULT true,
  ADD COLUMN est_demo boolean NOT NULL DEFAULT false;

CREATE FUNCTION cabinets_garder_etat_plateforme() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF NOT pg_has_role(current_user,
                       (SELECT c.relowner FROM pg_class c WHERE c.oid = TG_RELID), 'MEMBER') THEN
      RAISE EXCEPTION 'L''état d''un cabinet (actif, démonstration) ne se modifie que par la plateforme.'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END $$;
REVOKE ALL ON FUNCTION cabinets_garder_etat_plateforme() FROM PUBLIC;

CREATE TRIGGER cabinets_etat_plateforme_maj BEFORE UPDATE OF actif, est_demo ON cabinets
  FOR EACH ROW
  WHEN (OLD.actif IS DISTINCT FROM NEW.actif OR OLD.est_demo IS DISTINCT FROM NEW.est_demo)
  EXECUTE FUNCTION cabinets_garder_etat_plateforme();
CREATE TRIGGER cabinets_etat_plateforme_creation BEFORE INSERT ON cabinets
  FOR EACH ROW
  WHEN (NOT NEW.actif OR NEW.est_demo)
  EXECUTE FUNCTION cabinets_garder_etat_plateforme();

-- Connexion : un compte n'est actif que si son cabinet l'est aussi.
CREATE OR REPLACE FUNCTION trouver_connexion(p_email text)
  RETURNS TABLE (utilisateur_id uuid, cabinet_id uuid, mot_de_passe_hash text, actif boolean)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT u.id, u.cabinet_id, u.mot_de_passe_hash, u.actif AND c.actif
        FROM utilisateurs u JOIN cabinets c ON c.id = u.cabinet_id
        WHERE lower(u.email) = lower(p_email) $$;

-- Session : utilisateur actif ET cabinet actif.
CREATE OR REPLACE FUNCTION resoudre_session(p_jeton_hash text)
  RETURNS TABLE (utilisateur_id uuid, cabinet_id uuid, email text, nom text, roles text[])
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT u.id, u.cabinet_id, u.email, u.nom, u.roles
        FROM sessions s
        JOIN utilisateurs u ON u.id = s.utilisateur_id
        JOIN cabinets c ON c.id = u.cabinet_id
        WHERE s.jeton_hash = p_jeton_hash AND s.expire_le > now() AND u.actif AND c.actif $$;

-- CREATE OR REPLACE conserve les droits ; ils sont rappelés pour la relecture.
REVOKE ALL ON FUNCTION trouver_connexion(text), resoudre_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION trouver_connexion(text), resoudre_session(text) TO missionpilot_app;
