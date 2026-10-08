-- Définition de terminé par type de livrable et résultats de vérification (QUA-02).
--
-- Une définition est une liste d'items VÉRIFIABLES. Un item est soit contrôlé par du code
-- déterministe (`controle` : présence des sections, statut de validation du contenu source,
-- chiffres tracés, enregistrement du livrable), soit `manuel` : le relecteur l'atteste avec un
-- commentaire. Une définition se VERSIONNE (ajout seul) ; la définition appliquée à un suivi est
-- celle en vigueur à l'ouverture (`qualite_suivis.definition_id`). Les définitions par défaut
-- (rapports, notation, plan, questionnaire, état) sont amorcées par le code à la première
-- ouverture d'un suivi du type, par cabinet (`qualite/definitions.ts`).
--
-- Un résultat de vérification est en ajout seul : le résultat EN VIGUEUR d'un item est le dernier
-- (rang le plus élevé). `non_evaluable` : le code ne sait pas conclure (contenu opaque) ; l'item
-- n'est satisfait que par une attestation (`atteste`), ce que seul un humain pose.

CREATE TABLE qualite_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  type_livrable text NOT NULL CHECK (type_livrable IN
    ('rapport', 'notation', 'plan', 'questionnaire', 'etat', 'autre')),
  version integer NOT NULL CHECK (version BETWEEN 1 AND 10000),
  libelle text NOT NULL CHECK (length(btrim(libelle)) BETWEEN 1 AND 200),
  cree_par uuid,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, type_livrable, version),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE qualite_definitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON qualite_definitions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON qualite_definitions AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON qualite_definitions FROM missionpilot_app;
CREATE TRIGGER qualite_definitions_ajout_seul BEFORE UPDATE OR DELETE ON qualite_definitions
  FOR EACH ROW EXECUTE FUNCTION qualite_ajout_seul();

CREATE TABLE qualite_definition_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  definition_id uuid NOT NULL,
  code text NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9_]{0,59}$'),
  libelle text NOT NULL CHECK (length(btrim(libelle)) BETWEEN 1 AND 300),
  controle text NOT NULL CHECK (controle IN
    ('enregistrement', 'statut_source', 'sections', 'chiffres_traces', 'manuel')),
  obligatoire boolean NOT NULL DEFAULT true,
  ordre integer NOT NULL CHECK (ordre >= 0),
  parametres jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(parametres) = 'object'),
  UNIQUE (cabinet_id, id),
  UNIQUE (definition_id, code),
  FOREIGN KEY (cabinet_id, definition_id) REFERENCES qualite_definitions (cabinet_id, id)
);
ALTER TABLE qualite_definition_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON qualite_definition_items
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON qualite_definition_items AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON qualite_definition_items FROM missionpilot_app;
CREATE TRIGGER qualite_definition_items_ajout_seul BEFORE UPDATE OR DELETE ON qualite_definition_items
  FOR EACH ROW EXECUTE FUNCTION qualite_ajout_seul();

ALTER TABLE qualite_suivis
  ADD FOREIGN KEY (cabinet_id, definition_id) REFERENCES qualite_definitions (cabinet_id, id);

CREATE TABLE qualite_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  suivi_id uuid NOT NULL,
  item_id uuid NOT NULL,
  rang integer NOT NULL CHECK (rang >= 1),
  statut text NOT NULL CHECK (statut IN ('conforme', 'non_conforme', 'non_evaluable', 'atteste')),
  detail text CHECK (detail IS NULL OR length(detail) <= 1000),
  -- NULL : contrôle exécuté par le code ; sinon l'humain qui atteste.
  par uuid,
  le timestamptz NOT NULL DEFAULT now(),
  -- Une attestation est humaine et motivée.
  CHECK ((statut = 'atteste') = (par IS NOT NULL)),
  CHECK (statut <> 'atteste' OR coalesce(length(btrim(detail)), 0) >= 1),
  UNIQUE (cabinet_id, id),
  UNIQUE (suivi_id, item_id, rang),
  FOREIGN KEY (cabinet_id, suivi_id) REFERENCES qualite_suivis (cabinet_id, id),
  FOREIGN KEY (cabinet_id, item_id) REFERENCES qualite_definition_items (cabinet_id, id),
  FOREIGN KEY (cabinet_id, par) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE qualite_verifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON qualite_verifications
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON qualite_verifications AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON qualite_verifications FROM missionpilot_app;
CREATE TRIGGER qualite_verifications_ajout_seul BEFORE UPDATE OR DELETE ON qualite_verifications
  FOR EACH ROW EXECUTE FUNCTION qualite_ajout_seul();
