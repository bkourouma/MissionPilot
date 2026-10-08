-- Invitations du portail client (SOC-09).
--
-- La route d'acceptation interne (resoudre_invitation) n'accepte plus que
-- les invitations INTERNES (client_id NULL) : une invitation du portail ne
-- peut pas créer un compte du cabinet, et réciproquement. L'acceptation du
-- portail passe par resoudre_invitation_portail, aussi étroite : jeton haché
-- valide, non expiré, non consommé, client encore ACTIF, auteur encore actif
-- et, À L'ACCEPTATION, encore habilité pour CE client : associé ou directeur
-- de mission, sinon chef de mission qui dirige (chef ou directeur) encore une
-- mission de ce client (un initié retiré du client n'ouvre plus d'accès par
-- une invitation en attente). Les rôles viennent de la base, jamais du corps
-- de la requête.

-- Reprend À L'IDENTIQUE tous les contrôles de la dernière définition
-- (0015, constat F3 : auteur obligatoire, associé ACTIF du MÊME cabinet) et
-- n'ajoute que l'exclusion des invitations du portail (client_id NULL).
CREATE OR REPLACE FUNCTION resoudre_invitation(p_jeton_hash text)
  RETURNS TABLE (invitation_id uuid, cabinet_id uuid, email text, roles text[])
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT i.id, i.cabinet_id, i.email, i.roles FROM invitations i
        WHERE i.jeton_hash = p_jeton_hash AND i.expire_le > now() AND i.acceptee_le IS NULL
          AND i.client_id IS NULL
          AND EXISTS (
                SELECT 1 FROM utilisateurs u
                WHERE u.id = i.invite_par AND u.cabinet_id = i.cabinet_id
                  AND u.actif AND 'associe' = ANY (u.roles)) $$;

CREATE FUNCTION resoudre_invitation_portail(p_jeton_hash text)
  RETURNS TABLE (invitation_id uuid, cabinet_id uuid, email text, roles text[], client_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT i.id, i.cabinet_id, i.email, i.roles, i.client_id FROM invitations i
        JOIN clients c ON c.id = i.client_id AND c.cabinet_id = i.cabinet_id AND c.actif
        WHERE i.jeton_hash = p_jeton_hash AND i.expire_le > now() AND i.acceptee_le IS NULL
          AND i.client_id IS NOT NULL
          AND i.roles <@ ARRAY['client_dirigeant', 'client_contributeur', 'client_investisseur']
          AND EXISTS (SELECT 1 FROM utilisateurs u
                      WHERE u.id = i.invite_par AND u.cabinet_id = i.cabinet_id AND u.actif
                        AND (u.roles && ARRAY['associe', 'directeur_mission']
                             OR ('chef_mission' = ANY (u.roles) AND EXISTS (
                                   SELECT 1 FROM missions m
                                   WHERE m.cabinet_id = i.cabinet_id AND m.client_id = i.client_id
                                     AND (m.chef_id = u.id OR m.directeur_id = u.id))))) $$;

REVOKE ALL ON FUNCTION resoudre_invitation_portail(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resoudre_invitation_portail(text) TO missionpilot_app;
