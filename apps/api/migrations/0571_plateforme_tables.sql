-- Super admin de plateforme (lot 1) : tables de la plateforme (codes MQP : voir 0570).
--
-- Accès : le rôle applicatif n'a AUCUN droit sur ces tables ni sur leurs séquences
-- (les droits par défaut posés par 0001 sont retirés explicitement) ; RLS activée sans
-- politique permissive et politique RESTRICTIVE `portail_interdit` (test d'inventaire
-- d'isolation.test.ts). Seules les fonctions SECURITY DEFINER `plateforme_*` (0572,
-- 0573) les lisent et les écrivent.
--
-- Création d'un super admin : hors de l'application, avec le rôle propriétaire (aucune
-- fonction n'en crée). `mot_de_passe_hash` doit être un haché scrypt au format de
-- src/auth/password.ts (garde contre un mot de passe stocké en clair ; un changement
-- d'algorithme passe par une nouvelle migration).

CREATE TABLE super_admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL CHECK (email = btrim(email) AND length(email) BETWEEN 3 AND 254
    AND email ~ '^[^[:space:][:cntrl:]@]+@[^[:space:][:cntrl:]@]+$'),
  nom text NOT NULL CHECK (length(btrim(nom)) BETWEEN 1 AND 200 AND nom !~ '[[:cntrl:]]'),
  mot_de_passe_hash text NOT NULL
    CHECK (mot_de_passe_hash ~ '^scrypt\$[0-9]+\$[A-Za-z0-9+/]+={0,2}\$[A-Za-z0-9+/]+={0,2}$'),
  actif boolean NOT NULL DEFAULT true,
  est_demo boolean NOT NULL DEFAULT false,
  cree_le timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX super_admins_email_uniq ON super_admins (lower(email));

-- Sessions : durée fixe de 8 h décidée par plateforme_ouvrir_session ; jeton haché
-- (SHA-256 hexadécimal, hacherJeton de src/auth/session.ts), jamais le jeton.
CREATE TABLE plateforme_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  super_admin_id uuid NOT NULL REFERENCES super_admins (id) ON DELETE CASCADE,
  jeton_hash text NOT NULL UNIQUE CHECK (jeton_hash ~ '^[0-9a-f]{64}$'),
  expire_le timestamptz NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX plateforme_sessions_admin_idx ON plateforme_sessions (super_admin_id, cree_le);

-- Journal : une ligne par opération, écrite DANS la fonction (même transaction), sans
-- secret (ni mot de passe, ni haché, ni jeton, ni e-mail saisi lors d'un échec). Pas de
-- clé étrangère vers cabinets : le journal survit au cabinet.
CREATE TABLE journal_plateforme (
  id bigserial PRIMARY KEY,
  super_admin_id uuid REFERENCES super_admins (id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN ('connexion', 'connexion_echec', 'deconnexion',
    'cabinet_creation', 'cabinet_modification', 'utilisateur_creation',
    'utilisateur_modification')),
  cible text NOT NULL CHECK (cible IN ('super_admin', 'cabinet', 'utilisateur')),
  cible_id text,
  cabinet_id uuid,
  details jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(details) = 'object'),
  cree_le timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX journal_plateforme_date_idx ON journal_plateforme (cree_le DESC);
CREATE INDEX journal_plateforme_cabinet_idx ON journal_plateforme (cabinet_id, cree_le DESC)
  WHERE cabinet_id IS NOT NULL;

-- Ajout seul, même pour le propriétaire (MQP06). Seule exception : l'action de clé
-- étrangère ON DELETE SET NULL à la suppression d'un super admin (la ligne est
-- identique, à super_admin_id près, et le super admin n'existe plus).
CREATE FUNCTION journal_plateforme_ajout_seul() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF TG_OP = 'UPDATE' THEN
      IF OLD.super_admin_id IS NOT NULL AND NEW.super_admin_id IS NULL
         AND (NEW.id, NEW.action, NEW.cible, NEW.cible_id, NEW.cabinet_id, NEW.details, NEW.cree_le)
             IS NOT DISTINCT FROM
             (OLD.id, OLD.action, OLD.cible, OLD.cible_id, OLD.cabinet_id, OLD.details, OLD.cree_le)
         AND NOT EXISTS (SELECT 1 FROM super_admins a WHERE a.id = OLD.super_admin_id) THEN
        RETURN NEW;
      END IF;
    END IF;
    RAISE EXCEPTION 'Le journal de la plateforme est en ajout seul.' USING ERRCODE = 'MQP06';
  END $$;
REVOKE ALL ON FUNCTION journal_plateforme_ajout_seul() FROM PUBLIC;

CREATE TRIGGER journal_plateforme_ajout_seul BEFORE UPDATE OR DELETE ON journal_plateforme
  FOR EACH ROW EXECUTE FUNCTION journal_plateforme_ajout_seul();
CREATE TRIGGER journal_plateforme_sans_vidage BEFORE TRUNCATE ON journal_plateforme
  FOR EACH STATEMENT EXECUTE FUNCTION journal_plateforme_ajout_seul();

-- Cloisonnement : RLS sans politique permissive (aucune ligne visible hors propriétaire)
-- et politique RESTRICTIVE du portail.
ALTER TABLE super_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE plateforme_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_plateforme ENABLE ROW LEVEL SECURITY;
CREATE POLICY portail_interdit ON super_admins AS RESTRICTIVE FOR ALL USING (false);
CREATE POLICY portail_interdit ON plateforme_sessions AS RESTRICTIVE FOR ALL USING (false);
CREATE POLICY portail_interdit ON journal_plateforme AS RESTRICTIVE FOR ALL USING (false);

-- Aucun droit direct (les droits par défaut de 0001 sont retirés).
REVOKE ALL ON super_admins, plateforme_sessions, journal_plateforme FROM missionpilot_app;
REVOKE ALL ON super_admins, plateforme_sessions, journal_plateforme FROM PUBLIC;
REVOKE ALL ON SEQUENCE journal_plateforme_id_seq FROM missionpilot_app;
REVOKE ALL ON SEQUENCE journal_plateforme_id_seq FROM PUBLIC;
