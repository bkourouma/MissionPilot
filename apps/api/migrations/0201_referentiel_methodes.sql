-- Référentiel de méthodes (lot STD) — méthodes versionnées, étapes, briques,
-- éléments (livrables, items, KPI types…), rubriques à ancrages, règles de
-- modulation et cas types (STD-01, STD-02, STD-03, STD-05, STD-09, STD-11).
-- Propriété et lecture : voir l'en-tête de 0200 (standard `cabinet_id` NULL
-- lisible par tous les cabinets, variante isolée par RLS).
--
-- Héritage (ADR-004) : une VARIANTE est une méthode d'un cabinet dont
-- `parent_id` désigne une méthode du standard ; sa version garde dans
-- `base_standard_id` la version publiée du standard dont elle part. Le
-- contenu est COPIÉ à la création (les différences se calculent par code,
-- `apps/api/src/standard/differences.ts`) : une évolution du standard ne
-- modifie jamais en silence une variante ni une mission (STD-08).
--
-- Immuabilité : une version PUBLIÉE ne change plus, ni elle ni son contenu
-- (MPM01) ; on corrige par une nouvelle version avec notes de version. Une
-- version se crée toujours en brouillon. Incohérences (propriétaire,
-- numérotation, transition) : MPM02.

CREATE TABLE methodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid REFERENCES cabinets (id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES services_conseil (id),
  code text NOT NULL CHECK (std_code_valide(code)),
  libelle text NOT NULL CHECK (std_libelle_valide(libelle, 200)),
  description text CHECK (description IS NULL OR length(description) <= 4000),
  -- Variante d'une méthode du standard (cabinet seulement).
  parent_id uuid REFERENCES methodes (id),
  cree_par uuid,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (cabinet_id, code),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id),
  CHECK ((cabinet_id IS NULL) = (cree_par IS NULL)),
  CHECK (parent_id IS NULL OR cabinet_id IS NOT NULL)
);
-- Une seule variante par méthode du standard et par cabinet.
CREATE UNIQUE INDEX methodes_variante_uniq ON methodes (cabinet_id, parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX methodes_tri_idx ON methodes (libelle, id);
ALTER TABLE methodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON methodes
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY standard_lecture ON methodes FOR SELECT
  USING (cabinet_id IS NULL AND app_cabinet_id() IS NOT NULL);
CREATE POLICY portail_interdit ON methodes AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON methodes FROM missionpilot_app;
GRANT UPDATE (libelle, description) ON methodes TO missionpilot_app;

/*
 * Service et parent : du standard ou du même cabinet ; le parent d'une
 * variante est une méthode du standard. Exécuté avec les droits de
 * l'appelant : pour le rôle applicatif, une ligne d'un autre cabinet est
 * invisible (RLS) et donc refusée comme inexistante.
 */
CREATE FUNCTION controler_methode() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_cabinet uuid;
  BEGIN
    IF TG_OP = 'UPDATE' AND (NEW.cabinet_id, NEW.service_id, NEW.code, NEW.parent_id)
       IS DISTINCT FROM (OLD.cabinet_id, OLD.service_id, OLD.code, OLD.parent_id) THEN
      RAISE EXCEPTION 'Identité d''une méthode figée.' USING ERRCODE = 'MPM02';
    END IF;
    SELECT cabinet_id INTO v_cabinet FROM services_conseil WHERE id = NEW.service_id;
    IF NOT FOUND OR (v_cabinet IS NOT NULL AND v_cabinet IS DISTINCT FROM NEW.cabinet_id) THEN
      RAISE EXCEPTION 'Service inconnu.' USING ERRCODE = 'MPM02';
    END IF;
    IF NEW.parent_id IS NOT NULL THEN
      SELECT cabinet_id INTO v_cabinet FROM methodes WHERE id = NEW.parent_id;
      IF NOT FOUND OR v_cabinet IS NOT NULL THEN
        RAISE EXCEPTION 'Une variante hérite d''une méthode du standard.' USING ERRCODE = 'MPM02';
      END IF;
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER methodes_controle BEFORE INSERT OR UPDATE ON methodes
  FOR EACH ROW EXECUTE FUNCTION controler_methode();

CREATE TABLE methode_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid REFERENCES cabinets (id) ON DELETE CASCADE,
  methode_id uuid NOT NULL REFERENCES methodes (id),
  version integer NOT NULL CHECK (version BETWEEN 1 AND 10000),
  statut text NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon', 'publiee')),
  notes_version text CHECK (notes_version IS NULL OR length(notes_version) <= 4000),
  -- Variante : version publiée du standard dont part ce contenu.
  base_standard_id uuid REFERENCES methode_versions (id),
  cree_par uuid,
  cree_le timestamptz NOT NULL DEFAULT now(),
  publie_par uuid,
  publie_le timestamptz,
  UNIQUE (methode_id, version),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, publie_par) REFERENCES utilisateurs (cabinet_id, id),
  CHECK ((cabinet_id IS NULL) = (cree_par IS NULL)),
  CHECK ((statut = 'publiee') = (publie_le IS NOT NULL)),
  CHECK (cabinet_id IS NULL OR (statut = 'publiee') = (publie_par IS NOT NULL))
);
-- Un seul brouillon à la fois par méthode.
CREATE UNIQUE INDEX methode_versions_brouillon_uniq ON methode_versions (methode_id) WHERE statut = 'brouillon';
ALTER TABLE methode_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON methode_versions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY standard_lecture ON methode_versions FOR SELECT
  USING (cabinet_id IS NULL AND app_cabinet_id() IS NOT NULL);
CREATE POLICY portail_interdit ON methode_versions AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE ON methode_versions FROM missionpilot_app;
GRANT UPDATE (notes_version, statut, publie_par, publie_le) ON methode_versions TO missionpilot_app;

/*
 * Version : même propriétaire que la méthode, numéro suivant, créée en
 * brouillon ; base du standard réservée aux variantes et publiée ; une
 * version publiée est définitive (ni modification, ni suppression).
 */
CREATE FUNCTION controler_methode_version() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    m methodes%ROWTYPE;
    v_max integer;
    v_base_methode uuid;
    v_base_statut text;
  BEGIN
    IF TG_OP = 'DELETE' THEN
      IF OLD.statut = 'publiee' THEN
        RAISE EXCEPTION 'Version publiée immuable.' USING ERRCODE = 'MPM01';
      END IF;
      RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE' THEN
      IF OLD.statut = 'publiee' THEN
        RAISE EXCEPTION 'Version publiée immuable : créer une nouvelle version.' USING ERRCODE = 'MPM01';
      END IF;
      IF (NEW.cabinet_id, NEW.methode_id, NEW.version, NEW.base_standard_id, NEW.cree_par)
         IS DISTINCT FROM (OLD.cabinet_id, OLD.methode_id, OLD.version, OLD.base_standard_id, OLD.cree_par) THEN
        RAISE EXCEPTION 'Identité d''une version figée.' USING ERRCODE = 'MPM02';
      END IF;
      RETURN NEW;
    END IF;
    SELECT * INTO m FROM methodes WHERE id = NEW.methode_id;
    IF NOT FOUND OR m.cabinet_id IS DISTINCT FROM NEW.cabinet_id THEN
      RAISE EXCEPTION 'Version d''une méthode d''un autre propriétaire.' USING ERRCODE = 'MPM02';
    END IF;
    IF NEW.statut <> 'brouillon' THEN
      RAISE EXCEPTION 'Une version se crée en brouillon.' USING ERRCODE = 'MPM02';
    END IF;
    SELECT max(version) INTO v_max FROM methode_versions WHERE methode_id = NEW.methode_id;
    IF NEW.version <> coalesce(v_max, 0) + 1 THEN
      RAISE EXCEPTION 'Numéro de version inattendu.' USING ERRCODE = 'MPM02';
    END IF;
    IF NEW.base_standard_id IS NOT NULL THEN
      SELECT methode_id, statut INTO v_base_methode, v_base_statut
        FROM methode_versions WHERE id = NEW.base_standard_id;
      IF m.parent_id IS NULL OR v_base_methode IS DISTINCT FROM m.parent_id
         OR v_base_statut IS DISTINCT FROM 'publiee' THEN
        RAISE EXCEPTION 'Base : version publiée de la méthode du standard parente.' USING ERRCODE = 'MPM02';
      END IF;
    ELSIF m.parent_id IS NOT NULL THEN
      RAISE EXCEPTION 'Une variante part d''une version publiée du standard.' USING ERRCODE = 'MPM02';
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER methode_versions_controle BEFORE INSERT OR UPDATE OR DELETE ON methode_versions
  FOR EACH ROW EXECUTE FUNCTION controler_methode_version();

-- ---------------------------------------------------------------------------
-- Contenu d'une version : étapes, briques, éléments, rubriques, règles, cas types.
-- ---------------------------------------------------------------------------

CREATE TABLE methode_etapes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid REFERENCES cabinets (id) ON DELETE CASCADE,
  version_id uuid NOT NULL REFERENCES methode_versions (id) ON DELETE CASCADE,
  code text NOT NULL CHECK (std_code_valide(code)),
  libelle text NOT NULL CHECK (std_libelle_valide(libelle, 200)),
  description text CHECK (description IS NULL OR length(description) <= 2000),
  ordre integer NOT NULL DEFAULT 0 CHECK (ordre BETWEEN 0 AND 10000),
  UNIQUE (version_id, code),
  UNIQUE (version_id, id)
);

-- Brique (PRD §4.1) : unité de standardisation.
CREATE TABLE methode_briques (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid REFERENCES cabinets (id) ON DELETE CASCADE,
  version_id uuid NOT NULL REFERENCES methode_versions (id) ON DELETE CASCADE,
  etape_id uuid NOT NULL,
  code text NOT NULL CHECK (std_code_valide(code)),
  libelle text NOT NULL CHECK (std_libelle_valide(libelle, 200)),
  objet text NOT NULL CHECK (length(btrim(objet)) BETWEEN 1 AND 2000),
  -- Contrat de données attendu en entrée.
  entrees text CHECK (entrees IS NULL OR length(entrees) <= 2000),
  -- Moteur de calcul (`MOTEURS_STANDARD`, packages/shared) ; agent IA autorisé (lot AGT).
  moteur text CHECK (moteur IS NULL OR std_code_valide(moteur)),
  agent text CHECK (agent IS NULL OR std_code_valide(agent)),
  classe_risque text NOT NULL CHECK (classe_risque IN ('R0', 'R1', 'R2', 'R3')),
  -- Précision sur la garde humaine (la garde elle-même découle de la classe, moteur `qualite`).
  garde text CHECK (garde IS NULL OR length(garde) <= 1000),
  sortie text CHECK (sortie IS NULL OR length(sortie) <= 2000),
  definition_termine text CHECK (definition_termine IS NULL OR length(definition_termine) <= 2000),
  temps_type_jours numeric(7, 2) CHECK (temps_type_jours IS NULL OR temps_type_jours BETWEEN 0 AND 1000),
  profil_temps text CHECK (profil_temps IS NULL OR std_libelle_valide(profil_temps, 120)),
  niveau_autonomie_max text NOT NULL CHECK (niveau_autonomie_max IN ('N0', 'N1', 'N2', 'N3', 'N4')),
  -- Active avant modulation ; une brique inactive ne s'active que par une règle ou une dérogation.
  active_par_defaut boolean NOT NULL DEFAULT true,
  ordre integer NOT NULL DEFAULT 0 CHECK (ordre BETWEEN 0 AND 10000),
  UNIQUE (version_id, code),
  UNIQUE (version_id, id),
  FOREIGN KEY (version_id, etape_id) REFERENCES methode_etapes (version_id, id) ON DELETE CASCADE
);

-- Livrables, items, KPI types, initiatives types, risques types, gabarits, automatisations (STD-01).
CREATE TABLE methode_elements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid REFERENCES cabinets (id) ON DELETE CASCADE,
  version_id uuid NOT NULL REFERENCES methode_versions (id) ON DELETE CASCADE,
  brique_id uuid,
  type text NOT NULL CHECK (type IN
    ('livrable', 'item', 'kpi_type', 'initiative_type', 'risque_type', 'gabarit', 'automatisation')),
  code text NOT NULL CHECK (std_code_valide(code)),
  libelle text NOT NULL CHECK (std_libelle_valide(libelle, 200)),
  description text CHECK (description IS NULL OR length(description) <= 2000),
  -- Item « essentiel » : conservé par le questionnaire réduit.
  essentiel boolean NOT NULL DEFAULT false,
  actif_par_defaut boolean NOT NULL DEFAULT true,
  UNIQUE (version_id, code),
  FOREIGN KEY (version_id, brique_id) REFERENCES methode_briques (version_id, id) ON DELETE CASCADE
);

-- Rubriques à ancrages comportementaux (STD-09, PRD §4.5) : cinq niveaux.
CREATE TABLE methode_rubriques (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid REFERENCES cabinets (id) ON DELETE CASCADE,
  version_id uuid NOT NULL REFERENCES methode_versions (id) ON DELETE CASCADE,
  brique_id uuid,
  code text NOT NULL CHECK (std_code_valide(code)),
  libelle text NOT NULL CHECK (std_libelle_valide(libelle, 200)),
  dimension text CHECK (dimension IS NULL OR std_code_valide(dimension)),
  -- [{ "niveau": 1..5, "description", "exemples": [{ "contexte", "texte" }] }] (schéma partagé).
  ancrages jsonb NOT NULL CHECK (jsonb_typeof(ancrages) = 'array' AND jsonb_array_length(ancrages) = 5
    AND octet_length(ancrages::text) <= 100000),
  UNIQUE (version_id, code),
  FOREIGN KEY (version_id, brique_id) REFERENCES methode_briques (version_id, id) ON DELETE CASCADE
);

-- Règle de modulation (STD-05) : forme JSON de `regleModulationSchema`, évaluée telle quelle.
CREATE TABLE methode_regles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid REFERENCES cabinets (id) ON DELETE CASCADE,
  version_id uuid NOT NULL REFERENCES methode_versions (id) ON DELETE CASCADE,
  code text NOT NULL CHECK (std_code_valide(code)),
  regle jsonb NOT NULL CHECK (jsonb_typeof(regle) = 'object' AND regle ->> 'code' = code
    AND octet_length(regle::text) <= 100000),
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (version_id, code)
);

-- Cas type (STD-05) : contexte, briques de base et attendus (clés de l'API).
CREATE TABLE methode_cas_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid REFERENCES cabinets (id) ON DELETE CASCADE,
  version_id uuid NOT NULL REFERENCES methode_versions (id) ON DELETE CASCADE,
  code text NOT NULL CHECK (std_code_valide(code)),
  libelle text CHECK (libelle IS NULL OR std_libelle_valide(libelle, 200)),
  cas jsonb NOT NULL CHECK (jsonb_typeof(cas) = 'object' AND octet_length(cas::text) <= 100000),
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (version_id, code)
);

/*
 * Contenu d'une version : même propriétaire que la version, jamais déplacé
 * d'une version à l'autre, et figé dès la publication (MPM01). Une ligne
 * supprimée en cascade d'un brouillon supprimé ne retrouve plus sa version :
 * admis.
 */
CREATE FUNCTION controler_contenu_methode() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_version uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.version_id ELSE NEW.version_id END;
    v_statut text;
    v_cabinet uuid;
  BEGIN
    SELECT statut, cabinet_id INTO v_statut, v_cabinet FROM methode_versions WHERE id = v_version;
    IF NOT FOUND THEN
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RAISE EXCEPTION 'Version inconnue.' USING ERRCODE = 'MPM02';
    END IF;
    IF v_statut = 'publiee' THEN
      RAISE EXCEPTION 'Version publiée immuable : créer une nouvelle version.' USING ERRCODE = 'MPM01';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    IF TG_OP = 'UPDATE' AND (NEW.version_id, NEW.cabinet_id, NEW.code)
       IS DISTINCT FROM (OLD.version_id, OLD.cabinet_id, OLD.code) THEN
      RAISE EXCEPTION 'Identité d''un élément de méthode figée.' USING ERRCODE = 'MPM02';
    END IF;
    IF NEW.cabinet_id IS DISTINCT FROM v_cabinet THEN
      RAISE EXCEPTION 'Contenu d''une version d''un autre propriétaire.' USING ERRCODE = 'MPM02';
    END IF;
    RETURN NEW;
  END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['methode_etapes', 'methode_briques', 'methode_elements',
                           'methode_rubriques', 'methode_regles', 'methode_cas_types'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY isolation ON %I USING (cabinet_id = app_cabinet_id())
                    WITH CHECK (cabinet_id = app_cabinet_id())', t);
    EXECUTE format('CREATE POLICY standard_lecture ON %I FOR SELECT
                    USING (cabinet_id IS NULL AND app_cabinet_id() IS NOT NULL)', t);
    EXECUTE format('CREATE POLICY portail_interdit ON %I AS RESTRICTIVE FOR ALL
                    USING (app_portail_client_id() IS NULL)', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON %I
                    FOR EACH ROW EXECUTE FUNCTION controler_contenu_methode()', t || '_controle', t);
  END LOOP;
END $$;

CREATE INDEX methode_briques_etape_idx ON methode_briques (version_id, etape_id, ordre);
