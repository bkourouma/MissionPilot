-- Bibliothèque d'initiatives types (PLA-13, PRD complémentaire §11.3) :
-- prérequis, coût et durée types, risques, efficacité observée par contexte.
--
-- Propriété (modèle du référentiel de méthodes, 0201) :
-- - le STANDARD (`cabinet_id` NULL) est posé par migration (0422) et lisible
--   de tous les cabinets (`standard_lecture`) ; le rôle applicatif ne peut ni
--   l'écrire (WITH CHECK de l'isolation) ni le modifier ;
-- - une VARIANTE est une initiative du cabinet dont `standard_id` désigne une
--   initiative du standard (même code, une seule variante par cabinet) ; son
--   contenu est COPIÉ puis adapté : une évolution du standard ne change jamais
--   une variante en silence ;
-- - une initiative PROPRE au cabinet a son code (sans `standard_id`).
-- Contenu en versions, ajout seul (retrait : version `retire`).
--
-- Efficacité observée : observations (0 à 100) d'un cabinet, sur une
-- initiative du standard ou de ses initiatives, avec leur contexte (secteur,
-- taille, pays) ; la synthèse par contexte est calculée par le moteur
-- (syntheseEfficacite), jamais stockée. Les observations restent privées au
-- cabinet.
--
-- Origine d'une initiative d'un plan créée depuis la bibliothèque :
-- `plan_initiatives_origines` (version de l'initiative type reprise).
--
-- SQLSTATE : MPS01 (ajout seul), MPS07 (bibliothèque incohérente :
-- propriétaire, variante, version, coûts).

CREATE TABLE initiatives_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid REFERENCES cabinets (id) ON DELETE CASCADE,
  code text NOT NULL CHECK (code ~ '^[a-z0-9_]{1,40}$'),
  -- Variante d'une initiative du standard (cabinet seulement).
  standard_id uuid REFERENCES initiatives_types (id),
  cree_par uuid,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE NULLS NOT DISTINCT (cabinet_id, code),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id),
  CHECK ((cabinet_id IS NULL) = (cree_par IS NULL)),
  CHECK (standard_id IS NULL OR cabinet_id IS NOT NULL)
);
CREATE INDEX initiatives_types_tri_idx ON initiatives_types (code, id);
ALTER TABLE initiatives_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON initiatives_types
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY standard_lecture ON initiatives_types FOR SELECT
  USING (cabinet_id IS NULL AND app_cabinet_id() IS NOT NULL);
CREATE POLICY portail_interdit ON initiatives_types AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON initiatives_types FROM missionpilot_app;

CREATE FUNCTION refuser_modification_bibliotheque() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    RAISE EXCEPTION 'Bibliothèque d''initiatives en ajout seul : ajouter une nouvelle version.'
      USING ERRCODE = 'MPS01';
  END $$;
CREATE TRIGGER initiatives_types_ajout_seul BEFORE UPDATE OR DELETE ON initiatives_types
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_bibliotheque();

/*
 * Variante : d'une initiative du standard, même code. Fonction d'appelant :
 * sous RLS, une ligne d'un autre cabinet est invisible, donc refusée.
 */
CREATE FUNCTION controler_initiative_type() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE s initiatives_types%ROWTYPE;
  BEGIN
    IF NEW.standard_id IS NOT NULL THEN
      SELECT * INTO s FROM initiatives_types WHERE id = NEW.standard_id;
      IF NOT FOUND OR s.cabinet_id IS NOT NULL OR s.code <> NEW.code THEN
        RAISE EXCEPTION 'Une variante reprend le code d''une initiative du standard.'
          USING ERRCODE = 'MPS07';
      END IF;
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER initiatives_types_controle BEFORE INSERT ON initiatives_types
  FOR EACH ROW EXECUTE FUNCTION controler_initiative_type();

CREATE TABLE initiative_type_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid REFERENCES cabinets (id) ON DELETE CASCADE,
  initiative_type_id uuid NOT NULL REFERENCES initiatives_types (id),
  version integer NOT NULL CHECK (version BETWEEN 1 AND 10000),
  titre text NOT NULL CHECK (length(btrim(titre)) BETWEEN 1 AND 200 AND titre !~ '[[:cntrl:]]'),
  description text CHECK (description IS NULL OR length(description) <= 5000),
  perspective text CHECK (perspective IS NULL
    OR perspective IN ('finances', 'clients', 'processus', 'apprentissage')),
  -- Listes de textes ({libelle, niveau} pour les risques), schéma partagé
  -- (packages/shared/src/schemas/plans-augmentes.ts).
  prerequis jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(prerequis) = 'array'
    AND jsonb_array_length(prerequis) <= 20 AND octet_length(prerequis::text) <= 20000),
  risques jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(risques) = 'array'
    AND jsonb_array_length(risques) <= 20 AND octet_length(risques::text) <= 20000),
  cout_min bigint NOT NULL CHECK (cout_min >= 0),
  cout_type bigint NOT NULL,
  cout_max bigint NOT NULL,
  devise text NOT NULL DEFAULT 'XOF' CHECK (devise IN ('XOF', 'XAF', 'EUR', 'USD')),
  duree_type_jours integer NOT NULL CHECK (duree_type_jours BETWEEN 1 AND 3650),
  charge_type_jours integer CHECK (charge_type_jours IS NULL OR charge_type_jours BETWEEN 0 AND 100000),
  retire boolean NOT NULL DEFAULT false,
  auteur_id uuid,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (initiative_type_id, version),
  FOREIGN KEY (cabinet_id, initiative_type_id) REFERENCES initiatives_types (cabinet_id, id),
  FOREIGN KEY (cabinet_id, auteur_id) REFERENCES utilisateurs (cabinet_id, id),
  CHECK ((cabinet_id IS NULL) = (auteur_id IS NULL)),
  CHECK (cout_min <= cout_type AND cout_type <= cout_max)
);
CREATE INDEX initiative_type_versions_idx ON initiative_type_versions (initiative_type_id, version DESC);
ALTER TABLE initiative_type_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON initiative_type_versions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY standard_lecture ON initiative_type_versions FOR SELECT
  USING (cabinet_id IS NULL AND app_cabinet_id() IS NOT NULL);
CREATE POLICY portail_interdit ON initiative_type_versions AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON initiative_type_versions FROM missionpilot_app;

CREATE TRIGGER initiative_type_versions_ajout_seul BEFORE UPDATE OR DELETE ON initiative_type_versions
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_bibliotheque();

-- Même propriétaire que l'initiative type, numéro suivant.
CREATE FUNCTION controler_initiative_type_version() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_cabinet uuid; v_max integer;
  BEGIN
    SELECT cabinet_id INTO v_cabinet FROM initiatives_types WHERE id = NEW.initiative_type_id;
    IF NOT FOUND OR v_cabinet IS DISTINCT FROM NEW.cabinet_id THEN
      RAISE EXCEPTION 'Version d''une initiative type d''un autre propriétaire.' USING ERRCODE = 'MPS07';
    END IF;
    SELECT max(version) INTO v_max FROM initiative_type_versions
      WHERE initiative_type_id = NEW.initiative_type_id;
    IF NEW.version <> coalesce(v_max, 0) + 1 THEN
      RAISE EXCEPTION 'Numéro de version inattendu.' USING ERRCODE = 'MPS07';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER initiative_type_versions_controle BEFORE INSERT ON initiative_type_versions
  FOR EACH ROW EXECUTE FUNCTION controler_initiative_type_version();

CREATE TABLE initiative_type_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  -- Initiative du standard ou du cabinet (contrôlé par le déclencheur).
  initiative_type_id uuid NOT NULL REFERENCES initiatives_types (id),
  secteur text CHECK (secteur IS NULL OR (length(btrim(secteur)) BETWEEN 1 AND 80
    AND secteur !~ '[[:cntrl:]]')),
  taille text CHECK (taille IS NULL OR taille IN ('tpe', 'pme', 'eti', 'grande_entreprise')),
  pays char(2) CHECK (pays IS NULL OR pays ~ '^[A-Z]{2}$'),
  efficacite smallint NOT NULL CHECK (efficacite BETWEEN 0 AND 100),
  plan_initiative_id uuid,
  commentaire text CHECK (commentaire IS NULL OR length(commentaire) <= 1000),
  auteur_id uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, plan_initiative_id) REFERENCES plan_elements (cabinet_id, id),
  FOREIGN KEY (cabinet_id, auteur_id) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX initiative_type_observations_idx
  ON initiative_type_observations (cabinet_id, initiative_type_id, cree_le);
ALTER TABLE initiative_type_observations ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON initiative_type_observations
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON initiative_type_observations AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON initiative_type_observations FROM missionpilot_app;

CREATE TRIGGER initiative_type_observations_ajout_seul
  BEFORE UPDATE OR DELETE ON initiative_type_observations
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_bibliotheque();

-- Initiative type du standard ou du cabinet ; initiative du plan de type initiative.
CREATE FUNCTION controler_initiative_type_observation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_cabinet uuid;
  BEGIN
    SELECT cabinet_id INTO v_cabinet FROM initiatives_types WHERE id = NEW.initiative_type_id;
    IF NOT FOUND OR (v_cabinet IS NOT NULL AND v_cabinet <> NEW.cabinet_id) THEN
      RAISE EXCEPTION 'Initiative type inconnue.' USING ERRCODE = 'MPS07';
    END IF;
    IF NEW.plan_initiative_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM plan_elements e WHERE e.id = NEW.plan_initiative_id AND e.type = 'initiative') THEN
      RAISE EXCEPTION 'L''observation cite une initiative d''un plan.' USING ERRCODE = 'MPS07';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER initiative_type_observations_controle BEFORE INSERT ON initiative_type_observations
  FOR EACH ROW EXECUTE FUNCTION controler_initiative_type_observation();

CREATE TABLE plan_initiatives_origines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  plan_id uuid NOT NULL,
  initiative_id uuid NOT NULL,
  initiative_type_id uuid NOT NULL REFERENCES initiatives_types (id),
  initiative_type_version integer NOT NULL CHECK (initiative_type_version >= 1),
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (initiative_id),
  FOREIGN KEY (cabinet_id, plan_id, initiative_id) REFERENCES plan_elements (cabinet_id, plan_id, id),
  FOREIGN KEY (initiative_type_id, initiative_type_version)
    REFERENCES initiative_type_versions (initiative_type_id, version),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX plan_initiatives_origines_idx ON plan_initiatives_origines (cabinet_id, plan_id);
ALTER TABLE plan_initiatives_origines ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON plan_initiatives_origines
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON plan_initiatives_origines AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON plan_initiatives_origines FROM missionpilot_app;

CREATE TRIGGER plan_initiatives_origines_ajout_seul BEFORE UPDATE OR DELETE ON plan_initiatives_origines
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_plan();

-- Initiative du plan ; initiative type du standard ou du cabinet.
CREATE FUNCTION controler_plan_initiative_origine() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_cabinet uuid;
  BEGIN
    SELECT cabinet_id INTO v_cabinet FROM initiatives_types WHERE id = NEW.initiative_type_id;
    IF NOT FOUND OR (v_cabinet IS NOT NULL AND v_cabinet <> NEW.cabinet_id)
       OR NOT EXISTS (SELECT 1 FROM plan_elements e
                      WHERE e.id = NEW.initiative_id AND e.type = 'initiative') THEN
      RAISE EXCEPTION 'Origine incohérente : initiative du plan et initiative type visible attendues.'
        USING ERRCODE = 'MPS07';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER plan_initiatives_origines_controle BEFORE INSERT ON plan_initiatives_origines
  FOR EACH ROW EXECUTE FUNCTION controler_plan_initiative_origine();
