-- Politique de double authentification APPLIQUÉE (SOC-02, constat M2).
--
-- L'API résout la session avant de connaître le cabinet (resoudre_session,
-- hors RLS). Pour refuser les routes métier à un utilisateur soumis à la
-- politique de son cabinet qui n'a pas activé la 2FA, il lui faut, dans la
-- même transaction, la politique du cabinet et l'état de sa propre 2FA.
-- Fonction étroite, comme resoudre_session : elle ne renvoie que des
-- informations sur le titulaire de la session, et seulement pour une session
-- valide d'un utilisateur actif.

CREATE FUNCTION etat_tfa_session(p_jeton_hash text)
  RETURNS TABLE (tfa_obligatoire text[], tfa_active boolean)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT c.tfa_obligatoire,
               EXISTS (SELECT 1 FROM utilisateurs_2fa t
                       WHERE t.utilisateur_id = u.id AND t.active_le IS NOT NULL)
        FROM sessions s
        JOIN utilisateurs u ON u.id = s.utilisateur_id AND u.cabinet_id = s.cabinet_id
        JOIN cabinets c ON c.id = u.cabinet_id
        WHERE s.jeton_hash = p_jeton_hash AND s.expire_le > now() AND u.actif $$;

REVOKE ALL ON FUNCTION etat_tfa_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION etat_tfa_session(text) TO missionpilot_app;
