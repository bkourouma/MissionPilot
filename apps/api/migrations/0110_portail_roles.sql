-- Portail client (SOC-09) : rôles client, DISJOINTS des rôles du cabinet.
--
-- Un utilisateur porte soit des rôles du cabinet, soit des rôles client,
-- jamais les deux (CHECK) ; il ne change jamais de famille (déclencheur
-- MPP01). Une invitation du portail porte un client et des rôles client
-- seulement ; une invitation interne, des rôles du cabinet seulement.

ALTER TABLE utilisateurs DROP CONSTRAINT utilisateurs_roles_check;
ALTER TABLE utilisateurs ADD CONSTRAINT utilisateurs_roles_check CHECK (
  cardinality(roles) > 0
  AND (roles <@ ARRAY['associe', 'directeur_mission', 'chef_mission', 'consultant', 'ressources',
                      'gestionnaire', 'expert_metier', 'expert_externe']
       OR roles <@ ARRAY['client_dirigeant', 'client_contributeur', 'client_investisseur']));

CREATE FUNCTION refuser_changement_famille_roles() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_clients text[] := ARRAY['client_dirigeant', 'client_contributeur', 'client_investisseur'];
  BEGIN
    IF (OLD.roles && v_clients) IS DISTINCT FROM (NEW.roles && v_clients) THEN
      RAISE EXCEPTION 'Un utilisateur du portail ne devient pas un utilisateur du cabinet, ni l''inverse.'
        USING ERRCODE = 'MPP01';
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER utilisateurs_famille_roles BEFORE UPDATE OF roles ON utilisateurs
  FOR EACH ROW EXECUTE FUNCTION refuser_changement_famille_roles();

ALTER TABLE invitations
  ADD COLUMN client_id uuid,
  ADD CONSTRAINT invitations_client_fk
    FOREIGN KEY (cabinet_id, client_id) REFERENCES clients (cabinet_id, id),
  ADD CONSTRAINT invitations_roles_famille CHECK (
    cardinality(roles) > 0 AND CASE
      WHEN client_id IS NULL THEN roles <@ ARRAY['associe', 'directeur_mission', 'chef_mission',
        'consultant', 'ressources', 'gestionnaire', 'expert_metier', 'expert_externe']
      ELSE roles <@ ARRAY['client_dirigeant', 'client_contributeur', 'client_investisseur'] END);
CREATE INDEX invitations_client_idx ON invitations (cabinet_id, client_id) WHERE client_id IS NOT NULL;
