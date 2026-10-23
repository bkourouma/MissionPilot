-- Connexion de démonstration (lot 2b) : un super admin de démonstration a un mot de passe
-- PUBLIC (constante du dépôt). L'API refuse sa connexion PAR MOT DE PASSE tant que la
-- démonstration n'est pas active (routes/plateforme.ts) ; elle a besoin de savoir si un
-- super admin est de démonstration. `plateforme_trouver_connexion` (0572) garde sa
-- signature ; cette fonction renvoie seulement un booléen (faux si l'identifiant est
-- inconnu), jamais un haché ni une autre donnée. SECURITY DEFINER, search_path fixe,
-- EXECUTE retiré à PUBLIC puis accordé au seul rôle applicatif.
CREATE FUNCTION demo_super_admin_est_demo(p_super_admin_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT coalesce(bool_or(a.est_demo), false) FROM super_admins a
        WHERE a.id = demo_super_admin_est_demo.p_super_admin_id $$;

REVOKE ALL ON FUNCTION demo_super_admin_est_demo(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION demo_super_admin_est_demo(uuid) TO missionpilot_app;
