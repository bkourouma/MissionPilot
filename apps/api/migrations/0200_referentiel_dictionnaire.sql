-- Référentiel de méthodes (lot STD, V3) — dictionnaire de données et taxonomies
-- (STD-10), facteurs de contexte typés (STD-04), services (STD-01), notes de
-- contexte (STD-06). PRD complémentaire §4, ADR-004.
--
-- PROPRIÉTÉ ET LECTURE (modèle commun à toutes les tables du référentiel,
-- 0200 à 0203) :
-- - `cabinet_id` NULL : ligne du STANDARD MissionPilot, propriété d'ACC,
--   posée par migration (rôle propriétaire). Lisible par tout cabinet dans
--   une transaction à contexte de cabinet (politique `standard_lecture`, FOR
--   SELECT) ; jamais modifiable ni supprimable par le rôle applicatif : la
--   politique `isolation` (USING et WITH CHECK `cabinet_id = app_cabinet_id()`)
--   est la seule qui admette INSERT, UPDATE et DELETE, et une valeur NULL ne
--   la satisfait jamais.
-- - `cabinet_id` renseigné : ligne d'un cabinet (variante, ajout), isolée par
--   RLS comme toute table métier.
-- - Sans contexte de cabinet, aucune ligne n'est visible (échec sûr), standard
--   compris. Le portail client ne voit rien (`portail_interdit`).
-- - Les codes suivent `codeReferentielSchema` (packages/shared, fondations.ts).

CREATE FUNCTION std_code_valide(p_code text) RETURNS boolean
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT p_code ~ '^[a-z0-9_.-]{1,120}$' $$;

CREATE FUNCTION std_libelle_valide(p_texte text, p_max integer) RETURNS boolean
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT length(btrim(p_texte)) BETWEEN 1 AND p_max AND p_texte !~ '[[:cntrl:]]' $$;

-- ---------------------------------------------------------------------------
-- Taxonomies (STD-10) : secteurs CITI rév. 4, filières, pays, zones, tailles,
-- fonctions, processus, familles de KPI et de risques.
-- ---------------------------------------------------------------------------

CREATE TABLE taxonomie_entrees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid REFERENCES cabinets (id) ON DELETE CASCADE,
  taxonomie text NOT NULL CHECK (taxonomie IN
    ('secteur', 'filiere', 'pays', 'zone', 'taille', 'fonction', 'processus', 'kpi', 'risque')),
  code text NOT NULL CHECK (std_code_valide(code)),
  libelle text NOT NULL CHECK (std_libelle_valide(libelle, 200)),
  parent_code text CHECK (parent_code IS NULL OR std_code_valide(parent_code)),
  description text CHECK (description IS NULL OR length(description) <= 2000),
  ordre integer NOT NULL DEFAULT 0,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (cabinet_id, taxonomie, code)
);
CREATE INDEX taxonomie_entrees_tri_idx ON taxonomie_entrees (taxonomie, ordre, code, id);
ALTER TABLE taxonomie_entrees ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON taxonomie_entrees
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY standard_lecture ON taxonomie_entrees FOR SELECT
  USING (cabinet_id IS NULL AND app_cabinet_id() IS NOT NULL);
CREATE POLICY portail_interdit ON taxonomie_entrees AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
-- Dictionnaire en ajout seul pour le rôle applicatif (une entrée sert de valeur de facteur).
REVOKE UPDATE, DELETE ON taxonomie_entrees FROM missionpilot_app;

-- ---------------------------------------------------------------------------
-- Facteurs de contexte (STD-04, PRD §4.3) : forme du moteur de modulation
-- (`DefinitionFacteurContexte`) ; `valeurs` porte en plus un libellé par code.
-- ---------------------------------------------------------------------------

CREATE TABLE facteurs_contexte (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid REFERENCES cabinets (id) ON DELETE CASCADE,
  code text NOT NULL CHECK (std_code_valide(code)),
  libelle text NOT NULL CHECK (std_libelle_valide(libelle, 200)),
  description text CHECK (description IS NULL OR length(description) <= 2000),
  type text NOT NULL CHECK (type IN ('booleen', 'nombre', 'enumeration', 'liste')),
  -- Tableau [{ "code", "libelle" }] pour une énumération ou une liste.
  valeurs jsonb CHECK (valeurs IS NULL OR (jsonb_typeof(valeurs) = 'array'
    AND jsonb_array_length(valeurs) BETWEEN 1 AND 200)),
  min numeric,
  max numeric,
  -- Où vit la valeur : dossier client (lot DOS) ou mission.
  porte_par text NOT NULL DEFAULT 'mission' CHECK (porte_par IN ('dossier', 'mission')),
  ordre integer NOT NULL DEFAULT 0,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (cabinet_id, code),
  CHECK ((type IN ('enumeration', 'liste')) = (valeurs IS NOT NULL)),
  CHECK (type = 'nombre' OR (min IS NULL AND max IS NULL)),
  CHECK (min IS NULL OR max IS NULL OR min <= max)
);
ALTER TABLE facteurs_contexte ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON facteurs_contexte
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY standard_lecture ON facteurs_contexte FOR SELECT
  USING (cabinet_id IS NULL AND app_cabinet_id() IS NOT NULL);
CREATE POLICY portail_interdit ON facteurs_contexte AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
-- Un facteur lu par des règles publiées ne change pas : ajout seul.
REVOKE UPDATE, DELETE ON facteurs_contexte FROM missionpilot_app;

-- ---------------------------------------------------------------------------
-- Services (STD-01) : notation, plan stratégique… ; un cabinet peut en ajouter.
-- ---------------------------------------------------------------------------

CREATE TABLE services_conseil (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid REFERENCES cabinets (id) ON DELETE CASCADE,
  code text NOT NULL CHECK (std_code_valide(code)),
  libelle text NOT NULL CHECK (std_libelle_valide(libelle, 200)),
  description text CHECK (description IS NULL OR length(description) <= 4000),
  ordre integer NOT NULL DEFAULT 0,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (cabinet_id, code)
);
ALTER TABLE services_conseil ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON services_conseil
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY standard_lecture ON services_conseil FOR SELECT
  USING (cabinet_id IS NULL AND app_cabinet_id() IS NOT NULL);
CREATE POLICY portail_interdit ON services_conseil AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON services_conseil FROM missionpilot_app;

-- ---------------------------------------------------------------------------
-- Notes de contexte (STD-06) : remarque qualitative rattachée à un élément
-- standard (pays, filière, usage local). Ajout seul.
-- ---------------------------------------------------------------------------

CREATE TABLE notes_contexte (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid REFERENCES cabinets (id) ON DELETE CASCADE,
  cible_type text NOT NULL CHECK (cible_type IN ('service', 'methode', 'brique', 'facteur', 'taxonomie')),
  cible_code text NOT NULL CHECK (std_code_valide(cible_code)),
  contexte text CHECK (contexte IS NULL OR std_libelle_valide(contexte, 120)),
  texte text NOT NULL CHECK (length(btrim(texte)) BETWEEN 1 AND 4000),
  auteur_id uuid,
  cree_le timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (cabinet_id, auteur_id) REFERENCES utilisateurs (cabinet_id, id),
  -- Note du standard : sans auteur ; note d'un cabinet : auteur du cabinet.
  CHECK ((cabinet_id IS NULL) = (auteur_id IS NULL))
);
CREATE INDEX notes_contexte_cible_idx ON notes_contexte (cible_type, cible_code, cree_le, id);
ALTER TABLE notes_contexte ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON notes_contexte
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY standard_lecture ON notes_contexte FOR SELECT
  USING (cabinet_id IS NULL AND app_cabinet_id() IS NOT NULL);
CREATE POLICY portail_interdit ON notes_contexte AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON notes_contexte FROM missionpilot_app;
