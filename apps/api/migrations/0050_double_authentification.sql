-- Double authentification TOTP (SOC-02, exigences non fonctionnelles « Sécurité »).
--
-- Aucun secret en clair : le secret TOTP est chiffré (AES-256-GCM, clé dérivée
-- de SESSION_SECRET par HKDF, version de clé stockée pour la rotation), les
-- codes de secours et les défis de connexion ne sont stockés que hachés.

-- Politique du cabinet : rôles sensibles pour lesquels la 2FA est obligatoire.
ALTER TABLE cabinets ADD COLUMN tfa_obligatoire text[] NOT NULL DEFAULT '{}'
  CHECK (tfa_obligatoire <@ ARRAY['associe', 'directeur_mission', 'gestionnaire']);

-- Un enregistrement par utilisateur. active_le NULL : initialisation en
-- attente de confirmation par un premier code valide.
CREATE TABLE utilisateurs_2fa (
  utilisateur_id uuid PRIMARY KEY,
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  -- nonce (12 octets) || étiquette GCM (16 octets) || secret chiffré (20 octets).
  secret_chiffre bytea NOT NULL CHECK (octet_length(secret_chiffre) BETWEEN 29 AND 128),
  cle_version smallint NOT NULL CHECK (cle_version > 0),
  active_le timestamptz,
  -- Anti-rejeu : dernier pas de temps (30 s) accepté ; un pas n'est accepté qu'une fois.
  dernier_pas bigint CHECK (dernier_pas >= 0),
  cree_le timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (cabinet_id, utilisateur_id) REFERENCES utilisateurs (cabinet_id, id)
    ON DELETE CASCADE
);
ALTER TABLE utilisateurs_2fa ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON utilisateurs_2fa
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());

-- Codes de secours : empreinte HMAC (clé dérivée, versionnée), usage unique.
CREATE TABLE codes_secours_2fa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  utilisateur_id uuid NOT NULL,
  code_hash text NOT NULL CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  cle_version smallint NOT NULL CHECK (cle_version > 0),
  utilise_le timestamptz,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (utilisateur_id, code_hash),
  FOREIGN KEY (cabinet_id, utilisateur_id) REFERENCES utilisateurs (cabinet_id, id)
    ON DELETE CASCADE
);
CREATE INDEX codes_secours_2fa_cabinet_idx ON codes_secours_2fa (cabinet_id);
ALTER TABLE codes_secours_2fa ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON codes_secours_2fa
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());

-- Défi de connexion : jeton à usage unique (haché), court, lié à l'utilisateur,
-- avec un plafond de tentatives.
CREATE TABLE defis_2fa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  utilisateur_id uuid NOT NULL,
  defi_hash text NOT NULL UNIQUE CHECK (defi_hash ~ '^[0-9a-f]{64}$'),
  expire_le timestamptz NOT NULL,
  tentatives smallint NOT NULL DEFAULT 0 CHECK (tentatives BETWEEN 0 AND 20),
  consomme_le timestamptz,
  cree_le timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (cabinet_id, utilisateur_id) REFERENCES utilisateurs (cabinet_id, id)
    ON DELETE CASCADE
);
CREATE INDEX defis_2fa_utilisateur_idx ON defis_2fa (utilisateur_id);
CREATE INDEX defis_2fa_cabinet_idx ON defis_2fa (cabinet_id);
ALTER TABLE defis_2fa ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON defis_2fa
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());

-- Second temps de la connexion : le cabinet n'est pas encore connu. Fonction
-- étroite, comme trouver_connexion : défi valide, non consommé, utilisateur actif.
CREATE FUNCTION resoudre_defi_2fa(p_defi_hash text)
  RETURNS TABLE (defi_id uuid, cabinet_id uuid, utilisateur_id uuid, email text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT d.id, d.cabinet_id, d.utilisateur_id, u.email
        FROM defis_2fa d JOIN utilisateurs u ON u.id = d.utilisateur_id AND u.cabinet_id = d.cabinet_id
        WHERE d.defi_hash = p_defi_hash AND d.expire_le > now() AND d.consomme_le IS NULL
          AND u.actif $$;

REVOKE ALL ON FUNCTION resoudre_defi_2fa(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resoudre_defi_2fa(text) TO missionpilot_app;
