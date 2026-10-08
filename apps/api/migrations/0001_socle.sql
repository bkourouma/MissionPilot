-- Socle : cabinets (organisations isolées), utilisateurs, sessions, invitations,
-- journal d'audit, file de tâches. Toute table métier porte cabinet_id et RLS.
-- Le rôle applicatif (missionpilot_app) n'est ni propriétaire ni BYPASSRLS.

GRANT USAGE ON SCHEMA public TO missionpilot_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO missionpilot_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO missionpilot_app;

CREATE FUNCTION app_cabinet_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.cabinet_id', true), '')::uuid $$;

CREATE TABLE cabinets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nom text NOT NULL,
  pays char(2) NOT NULL DEFAULT 'CI',
  devise_base text NOT NULL DEFAULT 'XOF' CHECK (devise_base IN ('XOF', 'XAF', 'EUR', 'USD')),
  unite_saisie_temps text NOT NULL DEFAULT 'demi_journee'
    CHECK (unite_saisie_temps IN ('demi_journee', 'heure')),
  heures_par_jour numeric(4, 2) NOT NULL DEFAULT 8 CHECK (heures_par_jour > 0 AND heures_par_jour <= 24),
  jours_travailles smallint[] NOT NULL DEFAULT '{1,2,3,4,5}',
  cree_le timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE cabinets ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON cabinets
  USING (id = app_cabinet_id()) WITH CHECK (id = app_cabinet_id());

CREATE TABLE utilisateurs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  email text NOT NULL,
  nom text NOT NULL,
  roles text[] NOT NULL CHECK (cardinality(roles) > 0 AND roles <@ ARRAY[
    'associe', 'directeur_mission', 'chef_mission', 'consultant', 'ressources',
    'gestionnaire', 'expert_metier', 'expert_externe']),
  mot_de_passe_hash text NOT NULL,
  actif boolean NOT NULL DEFAULT true,
  cree_le timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX utilisateurs_email_uniq ON utilisateurs (lower(email));
CREATE INDEX utilisateurs_cabinet_idx ON utilisateurs (cabinet_id);
ALTER TABLE utilisateurs ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON utilisateurs
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  utilisateur_id uuid NOT NULL REFERENCES utilisateurs (id) ON DELETE CASCADE,
  jeton_hash text NOT NULL UNIQUE,
  expire_le timestamptz NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_utilisateur_idx ON sessions (utilisateur_id);
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON sessions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());

CREATE TABLE invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  email text NOT NULL,
  roles text[] NOT NULL,
  jeton_hash text NOT NULL UNIQUE,
  expire_le timestamptz NOT NULL,
  acceptee_le timestamptz,
  invite_par uuid REFERENCES utilisateurs (id) ON DELETE SET NULL,
  cree_le timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invitations_cabinet_idx ON invitations (cabinet_id);
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON invitations
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());

-- Journal d'audit : insertion et lecture seulement, jamais de modification.
CREATE TABLE journal_audit (
  id bigserial PRIMARY KEY,
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  utilisateur_id uuid REFERENCES utilisateurs (id) ON DELETE SET NULL,
  action text NOT NULL,
  entite text NOT NULL,
  entite_id text,
  details jsonb NOT NULL DEFAULT '{}',
  cree_le timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX journal_audit_cabinet_idx ON journal_audit (cabinet_id, cree_le DESC);
ALTER TABLE journal_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON journal_audit
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE UPDATE, DELETE ON journal_audit FROM missionpilot_app;

-- File de tâches (ADR-002).
CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  type text NOT NULL,
  charge jsonb NOT NULL DEFAULT '{}',
  statut text NOT NULL DEFAULT 'en_attente'
    CHECK (statut IN ('en_attente', 'en_cours', 'termine', 'echec')),
  tentatives int NOT NULL DEFAULT 0,
  tentatives_max int NOT NULL DEFAULT 3,
  execute_a timestamptz NOT NULL DEFAULT now(),
  verrouille_le timestamptz,
  progression smallint NOT NULL DEFAULT 0 CHECK (progression BETWEEN 0 AND 100),
  erreur text,
  cree_le timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_a_traiter_idx ON jobs (execute_a) WHERE statut = 'en_attente';
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON jobs
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());

-- Fonctions sans contexte de cabinet (connexion, session, onboarding, worker).
-- SECURITY DEFINER : exécutées avec les droits du propriétaire, qui n'est pas
-- soumis à RLS (pas de FORCE) ; chacune est volontairement étroite.
CREATE FUNCTION trouver_connexion(p_email text)
  RETURNS TABLE (utilisateur_id uuid, cabinet_id uuid, mot_de_passe_hash text, actif boolean)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT id, cabinet_id, mot_de_passe_hash, actif FROM utilisateurs WHERE lower(email) = lower(p_email) $$;

CREATE FUNCTION resoudre_session(p_jeton_hash text)
  RETURNS TABLE (utilisateur_id uuid, cabinet_id uuid, email text, nom text, roles text[])
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT u.id, u.cabinet_id, u.email, u.nom, u.roles
        FROM sessions s JOIN utilisateurs u ON u.id = s.utilisateur_id
        WHERE s.jeton_hash = p_jeton_hash AND s.expire_le > now() AND u.actif $$;

CREATE FUNCTION resoudre_invitation(p_jeton_hash text)
  RETURNS TABLE (invitation_id uuid, cabinet_id uuid, email text, roles text[])
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT id, cabinet_id, email, roles FROM invitations
        WHERE jeton_hash = p_jeton_hash AND expire_le > now() AND acceptee_le IS NULL $$;

CREATE FUNCTION creer_cabinet(p_nom text, p_pays char, p_email text, p_nom_utilisateur text, p_hash text)
  RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE v_cabinet uuid;
  BEGIN
    INSERT INTO cabinets (nom, pays) VALUES (p_nom, p_pays) RETURNING id INTO v_cabinet;
    INSERT INTO utilisateurs (cabinet_id, email, nom, roles, mot_de_passe_hash)
      VALUES (v_cabinet, p_email, p_nom_utilisateur, ARRAY['associe'], p_hash);
    RETURN v_cabinet;
  END $$;

CREATE FUNCTION reserver_job()
  RETURNS SETOF jobs
  LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    UPDATE jobs SET statut = 'en_cours', verrouille_le = now(), tentatives = tentatives + 1
    WHERE id = (SELECT id FROM jobs WHERE statut = 'en_attente' AND execute_a <= now()
                ORDER BY execute_a FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING * $$;

REVOKE ALL ON FUNCTION trouver_connexion(text), resoudre_session(text), resoudre_invitation(text),
  creer_cabinet(text, char, text, text, text), reserver_job() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION trouver_connexion(text), resoudre_session(text), resoudre_invitation(text),
  creer_cabinet(text, char, text, text, text), reserver_job() TO missionpilot_app;
