-- Registre des preuves (PRV-01, PRD complémentaire §6) : preuves typées et sourcées,
-- rattachées à une mission et au client de cette mission.
--
-- - preuves          : IDENTITÉ d'une preuve (mission, client, créateur), jamais modifiée.
-- - preuve_versions  : contenu d'une preuve, en AJOUT SEUL. Une correction est une nouvelle
--   version (motif obligatoire dès la version 2) ; la version courante est la plus grande.
--   Les liens aux assertions (0242) visent l'identité, donc survivent aux corrections.
-- - preuve_dimensions : dimensions (axes d'analyse) déclarées pour une mission, point de départ de
--   la carte de triangulation (PRV-05) ; seuls le libellé et l'état actif changent.
--
-- Verbatim nominatif : `nominatif` marque un extrait qui identifie une personne ;
-- `accord_nominatif` dit que la personne a donné son accord pour qu'il soit cité. Sans accord,
-- l'API masque l'extrait et la source précise (SECURITY.md §8 ter).
--
-- Aucun calcul ici (l'indice de solidité sort de packages/engines/src/preuves) ; les contrôles
-- SQL sont structurels. SQLSTATE du domaine (lettre V, « preuVes ») :
-- MPV01 (historique en ajout seul, champ figé), MPV02 (cohérence mission, client ou source),
-- MPV03 (numérotation des versions), MPV04 (avis d'expert et signature),
-- MPV05 (arbitrage qui ne vise pas une contradiction courante).
-- Le portail client n'y accède jamais (politique restrictive `portail_interdit`).

CREATE FUNCTION refuser_modification_preuves() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    RAISE EXCEPTION 'Registre des preuves en ajout seul : corriger par une nouvelle version.'
      USING ERRCODE = 'MPV01';
  END $$;

CREATE TABLE preuves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  numero bigint GENERATED ALWAYS AS IDENTITY,
  mission_id uuid NOT NULL,
  client_id uuid NOT NULL,
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, mission_id) REFERENCES missions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, client_id) REFERENCES clients (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX preuves_mission_idx ON preuves (cabinet_id, mission_id, numero DESC);
ALTER TABLE preuves ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON preuves
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON preuves AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON preuves FROM missionpilot_app;
CREATE TRIGGER preuves_ajout_seul BEFORE UPDATE OR DELETE ON preuves
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_preuves();

-- Le client d'une preuve est celui de sa mission.
CREATE FUNCTION controler_preuve() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NOT EXISTS (
         SELECT 1 FROM missions m WHERE m.id = NEW.mission_id AND m.client_id = NEW.client_id) THEN
      RAISE EXCEPTION 'La preuve doit porter sur le client de sa mission.' USING ERRCODE = 'MPV02';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER preuves_controle BEFORE INSERT ON preuves
  FOR EACH ROW EXECUTE FUNCTION controler_preuve();

CREATE TABLE preuve_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  preuve_id uuid NOT NULL,
  version int NOT NULL CHECK (version >= 1),
  type_source text NOT NULL
    CHECK (type_source IN ('questionnaire', 'entretien', 'observation', 'document', 'donnee_externe')),
  source_precise text NOT NULL CHECK (length(source_precise) BETWEEN 1 AND 300),
  date_preuve date NOT NULL CHECK (date_preuve BETWEEN '2000-01-01' AND '2100-12-31'),
  -- Auteur de la preuve : le membre du cabinet qui l'a recueillie.
  auteur_id uuid NOT NULL,
  fiabilite text NOT NULL CHECK (fiabilite IN ('A', 'B', 'C', 'D')),
  extrait text CHECK (extrait IS NULL OR length(extrait) BETWEEN 1 AND 4000),
  -- Lien vers un élément existant (au plus un) : fichier, réponse de questionnaire, document.
  fichier_id uuid,
  reponse_id uuid,
  document_id uuid,
  -- Dimensions éclairées (codes), validés par l'API ; au plus 20.
  dimensions text[] NOT NULL DEFAULT '{}',
  nominatif boolean NOT NULL DEFAULT false,
  accord_nominatif boolean NOT NULL DEFAULT false,
  motif text CHECK (motif IS NULL OR length(motif) BETWEEN 1 AND 500),
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (preuve_id, version),
  UNIQUE (cabinet_id, preuve_id, version),
  CHECK ((version = 1) = (motif IS NULL)),
  CHECK (num_nonnulls(fichier_id, reponse_id, document_id) <= 1),
  CHECK (NOT accord_nominatif OR nominatif),
  CHECK (cardinality(dimensions) <= 20),
  CHECK (cardinality(dimensions) = 0
    OR (array_to_string(dimensions, ' ') ~ '^[a-z0-9_.-]{1,120}( [a-z0-9_.-]{1,120})*$')),
  FOREIGN KEY (cabinet_id, preuve_id) REFERENCES preuves (cabinet_id, id),
  FOREIGN KEY (cabinet_id, auteur_id) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, fichier_id) REFERENCES fichiers (cabinet_id, id),
  FOREIGN KEY (cabinet_id, reponse_id) REFERENCES questionnaire_reponses (cabinet_id, id),
  FOREIGN KEY (cabinet_id, document_id) REFERENCES mission_documents (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX preuve_versions_courante_idx ON preuve_versions (cabinet_id, preuve_id, version DESC);
ALTER TABLE preuve_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON preuve_versions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON preuve_versions AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON preuve_versions FROM missionpilot_app;
CREATE TRIGGER preuve_versions_ajout_seul BEFORE UPDATE OR DELETE ON preuve_versions
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_preuves();
-- L'auteur est un membre du cabinet, jamais un utilisateur du portail.
CREATE TRIGGER preuve_versions_auteur_sans_portail BEFORE INSERT ON preuve_versions
  FOR EACH ROW EXECUTE FUNCTION refuser_utilisateur_portail('auteur_id');

-- Versions consécutives (MPV03) ; document et réponse liés appartiennent à la mission (MPV02).
CREATE FUNCTION controler_preuve_version() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_mission uuid;
  BEGIN
    SELECT p.mission_id INTO v_mission FROM preuves p WHERE p.id = NEW.preuve_id;
    IF NEW.version <> (SELECT coalesce(max(v.version), 0) + 1 FROM preuve_versions v
                       WHERE v.preuve_id = NEW.preuve_id) THEN
      RAISE EXCEPTION 'Les versions d''une preuve se suivent sans trou.' USING ERRCODE = 'MPV03';
    END IF;
    IF NEW.document_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM mission_documents d WHERE d.id = NEW.document_id AND d.mission_id = v_mission) THEN
      RAISE EXCEPTION 'Le document lié n''appartient pas à la mission de la preuve.'
        USING ERRCODE = 'MPV02';
    END IF;
    IF NEW.reponse_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM questionnaire_reponses r JOIN questionnaire_envois e ON e.id = r.envoi_id
         WHERE r.id = NEW.reponse_id AND e.mission_id = v_mission) THEN
      RAISE EXCEPTION 'La réponse liée n''appartient pas à la mission de la preuve.'
        USING ERRCODE = 'MPV02';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER preuve_versions_controle BEFORE INSERT ON preuve_versions
  FOR EACH ROW EXECUTE FUNCTION controler_preuve_version();

CREATE TABLE preuve_dimensions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  mission_id uuid NOT NULL,
  code text NOT NULL CHECK (code ~ '^[a-z0-9_.-]{1,120}$'),
  libelle text NOT NULL CHECK (length(libelle) BETWEEN 1 AND 200),
  actif boolean NOT NULL DEFAULT true,
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, mission_id, code),
  FOREIGN KEY (cabinet_id, mission_id) REFERENCES missions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE preuve_dimensions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON preuve_dimensions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON preuve_dimensions AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE DELETE ON preuve_dimensions FROM missionpilot_app;

-- Seuls le libellé et l'état actif d'une dimension changent.
CREATE FUNCTION controler_preuve_dimension() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'DELETE' OR (NEW.cabinet_id, NEW.mission_id, NEW.code, NEW.cree_par, NEW.cree_le)
       IS DISTINCT FROM (OLD.cabinet_id, OLD.mission_id, OLD.code, OLD.cree_par, OLD.cree_le) THEN
      RAISE EXCEPTION 'Le code et la mission d''une dimension sont figés.' USING ERRCODE = 'MPV01';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER preuve_dimensions_controle BEFORE UPDATE OR DELETE ON preuve_dimensions
  FOR EACH ROW EXECUTE FUNCTION controler_preuve_dimension();
