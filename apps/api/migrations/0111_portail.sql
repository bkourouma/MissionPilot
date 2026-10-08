-- Portail client (SOC-09) : rattachement des utilisateurs du portail à UNE
-- entreprise cliente, partages explicites du cabinet, contact principal,
-- politique du portail, validations de jalons par le client.
--
-- Par défaut RIEN n'est partagé : un utilisateur du portail sans partage ne
-- voit rien. Toutes les références restent dans le cabinet (FK composites).

-- Rattachement : un utilisateur du portail appartient à un seul client, pour toujours.
CREATE TABLE utilisateurs_portail (
  utilisateur_id uuid PRIMARY KEY,
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  invitation_id uuid,
  invite_par uuid,
  statut text NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif', 'desactive')),
  cree_le timestamptz NOT NULL DEFAULT now(),
  modifie_le timestamptz NOT NULL DEFAULT now(),
  modifie_par uuid,
  UNIQUE (cabinet_id, utilisateur_id),
  FOREIGN KEY (cabinet_id, utilisateur_id) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, client_id) REFERENCES clients (cabinet_id, id),
  FOREIGN KEY (cabinet_id, invite_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, modifie_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX utilisateurs_portail_client_idx ON utilisateurs_portail (cabinet_id, client_id);
ALTER TABLE utilisateurs_portail ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON utilisateurs_portail
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE DELETE ON utilisateurs_portail FROM missionpilot_app;

-- Seuls des utilisateurs à rôles client se rattachent ; le client et l'utilisateur sont figés.
CREATE FUNCTION controler_utilisateur_portail() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'UPDATE' AND (NEW.utilisateur_id, NEW.client_id, NEW.cabinet_id)
         IS DISTINCT FROM (OLD.utilisateur_id, OLD.client_id, OLD.cabinet_id) THEN
      RAISE EXCEPTION 'Le rattachement d''un utilisateur du portail est figé.' USING ERRCODE = 'MPP01';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM utilisateurs u WHERE u.id = NEW.utilisateur_id
                   AND u.roles <@ ARRAY['client_dirigeant', 'client_contributeur', 'client_investisseur']) THEN
      RAISE EXCEPTION 'Seul un utilisateur à rôles client se rattache au portail.' USING ERRCODE = 'MPP01';
    END IF;
    NEW.modifie_le := now();
    RETURN NEW;
  END $$;
CREATE TRIGGER utilisateurs_portail_controle BEFORE INSERT OR UPDATE ON utilisateurs_portail
  FOR EACH ROW EXECUTE FUNCTION controler_utilisateur_portail();

-- Paramètres du portail du cabinet (politique 2FA des utilisateurs du portail).
CREATE TABLE portail_parametres (
  cabinet_id uuid PRIMARY KEY REFERENCES cabinets (id) ON DELETE CASCADE,
  tfa_obligatoire boolean NOT NULL DEFAULT false,
  modifie_par uuid,
  modifie_le timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (cabinet_id, modifie_par) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE portail_parametres ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON portail_parametres
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());

-- Réglages par client : contact principal du cabinet (seul nom interne montré au client).
CREATE TABLE portail_clients (
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  contact_principal_id uuid,
  modifie_par uuid NOT NULL,
  modifie_le timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cabinet_id, client_id),
  FOREIGN KEY (cabinet_id, client_id) REFERENCES clients (cabinet_id, id),
  FOREIGN KEY (cabinet_id, contact_principal_id) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, modifie_par) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE portail_clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON portail_clients
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());

-- Partages explicites : une ligne de mission (document_id NULL : intitulé,
-- statut, dates ; jalons et factures sur option) ou une ligne de document
-- (livrable). Remplacés en bloc par le cabinet (PUT), journalisés.
CREATE TABLE portail_partages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  mission_id uuid NOT NULL,
  document_id uuid,
  jalons boolean NOT NULL DEFAULT false,
  factures boolean NOT NULL DEFAULT false,
  partage_par uuid NOT NULL,
  partage_le timestamptz NOT NULL DEFAULT now(),
  CHECK (document_id IS NULL OR (NOT jalons AND NOT factures)),
  FOREIGN KEY (cabinet_id, client_id) REFERENCES clients (cabinet_id, id),
  FOREIGN KEY (cabinet_id, mission_id) REFERENCES missions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, document_id) REFERENCES mission_documents (cabinet_id, id),
  FOREIGN KEY (cabinet_id, partage_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE UNIQUE INDEX portail_partages_mission_uniq ON portail_partages (cabinet_id, mission_id)
  WHERE document_id IS NULL;
CREATE UNIQUE INDEX portail_partages_document_uniq ON portail_partages (cabinet_id, document_id)
  WHERE document_id IS NOT NULL;
CREATE INDEX portail_partages_client_idx ON portail_partages (cabinet_id, client_id, mission_id);
ALTER TABLE portail_partages ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON portail_partages
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());

-- Cohérence d'un partage : mission du client ; document de cette mission, de
-- type livrable ou lettre de mission, hors circuit IA ou VALIDÉ (« l'IA
-- propose, l'expert dispose » : aucun brouillon IA n'atteint le client) ;
-- un document n'est partagé que si sa mission l'est.
CREATE FUNCTION controler_portail_partage() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM missions m WHERE m.id = NEW.mission_id AND m.client_id = NEW.client_id) THEN
      RAISE EXCEPTION 'Mission d''un autre client.' USING ERRCODE = 'MPP02';
    END IF;
    IF NEW.document_id IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM mission_documents d WHERE d.id = NEW.document_id
                     AND d.mission_id = NEW.mission_id
                     AND d.type IN ('livrable', 'lettre_de_mission')
                     AND (d.statut_contenu IS NULL OR d.statut_contenu = 'valide')) THEN
        RAISE EXCEPTION 'Document non partageable.' USING ERRCODE = 'MPP02';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM portail_partages p WHERE p.mission_id = NEW.mission_id
                     AND p.client_id = NEW.client_id AND p.document_id IS NULL) THEN
        RAISE EXCEPTION 'La mission du document n''est pas partagée.' USING ERRCODE = 'MPP02';
      END IF;
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER portail_partages_controle BEFORE INSERT OR UPDATE ON portail_partages
  FOR EACH ROW EXECUTE FUNCTION controler_portail_partage();

-- Validation d'un jalon par le dirigeant client : horodatée, en ajout seul,
-- SANS modifier les données internes du jalon. Pas de clé étrangère vers le
-- jalon (la validation survit à sa suppression) : libellé et date prévue
-- sont copiés ; l'existence est contrôlée à l'insertion.
CREATE TABLE portail_validations_jalons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  mission_id uuid NOT NULL,
  jalon_id uuid NOT NULL,
  jalon_libelle text NOT NULL CHECK (length(jalon_libelle) BETWEEN 1 AND 200),
  jalon_date_prevue date,
  valide_par uuid NOT NULL,
  commentaire text CHECK (commentaire IS NULL OR length(commentaire) BETWEEN 1 AND 1000),
  valide_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, jalon_id),
  FOREIGN KEY (cabinet_id, client_id) REFERENCES clients (cabinet_id, id),
  FOREIGN KEY (cabinet_id, mission_id) REFERENCES missions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, valide_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX portail_validations_jalons_mission_idx ON portail_validations_jalons (cabinet_id, mission_id);
ALTER TABLE portail_validations_jalons ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON portail_validations_jalons
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE UPDATE, DELETE ON portail_validations_jalons FROM missionpilot_app;

CREATE FUNCTION controler_validation_jalon() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP <> 'INSERT' THEN
      RAISE EXCEPTION 'Une validation de jalon est définitive.' USING ERRCODE = 'MPP03';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM mission_jalons j WHERE j.id = NEW.jalon_id AND j.mission_id = NEW.mission_id) THEN
      RAISE EXCEPTION 'Jalon inconnu.' USING ERRCODE = 'MPP02';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER portail_validations_jalons_controle BEFORE INSERT OR UPDATE OR DELETE
  ON portail_validations_jalons FOR EACH ROW EXECUTE FUNCTION controler_validation_jalon();
