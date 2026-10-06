-- Durcissement issu de l'audit de sécurité (vague 1).

-- Les actions de clé étrangère (CASCADE / SET NULL) s'exécutent même quand le rôle
-- applicatif n'a pas le droit de modifier une table : sans ce retrait, supprimer un
-- cabinet ou un utilisateur effacerait ou anonymiserait le journal d'audit.
-- Les sessions restent supprimables (déconnexion, désactivation).
REVOKE DELETE ON cabinets, utilisateurs FROM missionpilot_app;

-- Une invitation n'est plus utilisable quand son auteur n'est plus un associé actif.
CREATE OR REPLACE FUNCTION resoudre_invitation(p_jeton_hash text)
  RETURNS TABLE (invitation_id uuid, cabinet_id uuid, email text, roles text[])
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT i.id, i.cabinet_id, i.email, i.roles FROM invitations i
        WHERE i.jeton_hash = p_jeton_hash AND i.expire_le > now() AND i.acceptee_le IS NULL
          AND (i.invite_par IS NULL OR EXISTS (
                SELECT 1 FROM utilisateurs u
                WHERE u.id = i.invite_par AND u.actif AND 'associe' = ANY (u.roles))) $$;
