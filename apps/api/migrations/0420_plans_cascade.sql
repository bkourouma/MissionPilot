-- Cascade stratégique en graphe (PLA-12, PRD complémentaire §11.3) :
-- vision → axes → objectifs → initiatives → projets → jalons → KPI, chaque
-- nœud avec un porteur ; les trous (objectif sans KPI, initiative sans
-- porteur…) sont calculés par le moteur (`@missionpilot/engines`,
-- analyserCascade) à chaque lecture, jamais stockés.
--
-- Ce qui s'ajoute au plan (0180, 0183) :
-- - `plan_porteurs` : porteur de la vision, d'un axe ou d'un objectif (une
--   initiative a déjà son responsable, un KPI son propriétaire). Historique en
--   ajout seul : le porteur courant est la dernière version ; `porteur_id`
--   NULL retire le porteur.
-- - `plan_cascade_noeuds` et `plan_cascade_versions` : projets (sous une
--   initiative) et jalons (sous un projet), versionnés en ajout seul comme les
--   éléments du plan (retrait par une version `retire`).
-- Ni porteur ni nœud n'est un contenu rédigé ou proposé par l'IA : pas de
-- statut de validation ; tout reste interne au cabinet (`portail_interdit`).
--
-- SQLSTATE : MPS01 (ajout seul, fonction de 0180), MPS02 (incohérence :
-- version, parent, type, statut).

CREATE TABLE plan_porteurs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  plan_id uuid NOT NULL,
  element_id uuid NOT NULL,
  version integer NOT NULL CHECK (version BETWEEN 1 AND 10000),
  porteur_id uuid,
  auteur_id uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (element_id, version),
  FOREIGN KEY (cabinet_id, plan_id, element_id) REFERENCES plan_elements (cabinet_id, plan_id, id),
  FOREIGN KEY (cabinet_id, porteur_id) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, auteur_id) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX plan_porteurs_idx ON plan_porteurs (cabinet_id, plan_id, element_id, version DESC);
ALTER TABLE plan_porteurs ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON plan_porteurs
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON plan_porteurs AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON plan_porteurs FROM missionpilot_app;

CREATE TRIGGER plan_porteurs_ajout_seul BEFORE UPDATE OR DELETE ON plan_porteurs
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_plan();
CREATE TRIGGER plan_porteurs_sans_portail BEFORE INSERT ON plan_porteurs
  FOR EACH ROW EXECUTE FUNCTION refuser_utilisateur_portail('porteur_id');

-- Élément à porteur (vision, axe, objectif) et numéro de version suivant.
CREATE FUNCTION controler_plan_porteur() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_type text; v_max integer;
  BEGIN
    SELECT type INTO v_type FROM plan_elements WHERE id = NEW.element_id;
    IF v_type IS NULL OR v_type NOT IN ('vision_mission', 'axe', 'objectif') THEN
      RAISE EXCEPTION 'Porteur réservé à la vision, aux axes et aux objectifs.' USING ERRCODE = 'MPS02';
    END IF;
    SELECT max(version) INTO v_max FROM plan_porteurs WHERE element_id = NEW.element_id;
    IF NEW.version <> coalesce(v_max, 0) + 1 THEN
      RAISE EXCEPTION 'Numéro de version inattendu.' USING ERRCODE = 'MPS02';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER plan_porteurs_controle BEFORE INSERT ON plan_porteurs
  FOR EACH ROW EXECUTE FUNCTION controler_plan_porteur();

CREATE TABLE plan_cascade_noeuds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  plan_id uuid NOT NULL,
  type text NOT NULL CHECK (type IN ('projet', 'jalon')),
  -- Projet : initiative du plan ; jalon : projet du plan.
  initiative_id uuid,
  projet_id uuid,
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, plan_id, id),
  FOREIGN KEY (cabinet_id, plan_id) REFERENCES plans_strategiques (cabinet_id, id),
  FOREIGN KEY (cabinet_id, plan_id, initiative_id) REFERENCES plan_elements (cabinet_id, plan_id, id),
  FOREIGN KEY (cabinet_id, plan_id, projet_id) REFERENCES plan_cascade_noeuds (cabinet_id, plan_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id),
  CHECK ((type = 'projet') = (initiative_id IS NOT NULL)),
  CHECK ((type = 'jalon') = (projet_id IS NOT NULL))
);
CREATE INDEX plan_cascade_noeuds_idx ON plan_cascade_noeuds (cabinet_id, plan_id, cree_le, id);
ALTER TABLE plan_cascade_noeuds ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON plan_cascade_noeuds
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON plan_cascade_noeuds AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON plan_cascade_noeuds FROM missionpilot_app;

CREATE TRIGGER plan_cascade_noeuds_ajout_seul BEFORE UPDATE OR DELETE ON plan_cascade_noeuds
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_plan();

-- Parent du bon type : initiative pour un projet, projet pour un jalon.
CREATE FUNCTION controler_plan_cascade_noeud() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF (NEW.type = 'projet' AND NOT EXISTS (
          SELECT 1 FROM plan_elements e WHERE e.id = NEW.initiative_id AND e.type = 'initiative'))
       OR (NEW.type = 'jalon' AND NOT EXISTS (
          SELECT 1 FROM plan_cascade_noeuds n WHERE n.id = NEW.projet_id AND n.type = 'projet')) THEN
      RAISE EXCEPTION 'Parent incompatible : initiative pour un projet, projet pour un jalon.'
        USING ERRCODE = 'MPS02';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER plan_cascade_noeuds_controle BEFORE INSERT ON plan_cascade_noeuds
  FOR EACH ROW EXECUTE FUNCTION controler_plan_cascade_noeud();

CREATE TABLE plan_cascade_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  noeud_id uuid NOT NULL,
  version integer NOT NULL CHECK (version BETWEEN 1 AND 10000),
  titre text NOT NULL CHECK (length(btrim(titre)) BETWEEN 1 AND 200 AND titre !~ '[[:cntrl:]]'),
  description text CHECK (description IS NULL OR length(description) <= 5000),
  porteur_id uuid,
  debut date CHECK (debut BETWEEN '2000-01-01' AND '2100-12-31'),
  echeance date NOT NULL CHECK (echeance BETWEEN '2000-01-01' AND '2100-12-31'),
  statut text NOT NULL CHECK (statut IN
    ('a_lancer', 'en_cours', 'termine', 'suspendu', 'abandonne', 'prevu', 'atteint', 'manque')),
  retire boolean NOT NULL DEFAULT false,
  auteur_id uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (noeud_id, version),
  FOREIGN KEY (cabinet_id, noeud_id) REFERENCES plan_cascade_noeuds (cabinet_id, id),
  FOREIGN KEY (cabinet_id, porteur_id) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, auteur_id) REFERENCES utilisateurs (cabinet_id, id),
  CHECK (debut IS NULL OR debut <= echeance)
);
CREATE INDEX plan_cascade_versions_idx ON plan_cascade_versions (cabinet_id, noeud_id, version DESC);
ALTER TABLE plan_cascade_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON plan_cascade_versions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON plan_cascade_versions AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON plan_cascade_versions FROM missionpilot_app;

CREATE TRIGGER plan_cascade_versions_ajout_seul BEFORE UPDATE OR DELETE ON plan_cascade_versions
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_plan();
CREATE TRIGGER plan_cascade_versions_sans_portail BEFORE INSERT ON plan_cascade_versions
  FOR EACH ROW EXECUTE FUNCTION refuser_utilisateur_portail('porteur_id');

-- Numéro suivant ; statut du type (projet ou jalon) ; un jalon n'a pas de début.
CREATE FUNCTION controler_plan_cascade_version() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_type text; v_max integer;
  BEGIN
    SELECT type INTO v_type FROM plan_cascade_noeuds WHERE id = NEW.noeud_id;
    SELECT max(version) INTO v_max FROM plan_cascade_versions WHERE noeud_id = NEW.noeud_id;
    IF NEW.version <> coalesce(v_max, 0) + 1 THEN
      RAISE EXCEPTION 'Numéro de version inattendu.' USING ERRCODE = 'MPS02';
    END IF;
    IF (v_type = 'projet' AND NEW.statut NOT IN ('a_lancer', 'en_cours', 'termine', 'suspendu', 'abandonne'))
       OR (v_type = 'jalon' AND (NEW.statut NOT IN ('prevu', 'atteint', 'manque') OR NEW.debut IS NOT NULL)) THEN
      RAISE EXCEPTION 'Statut ou dates incompatibles avec le type du nœud.' USING ERRCODE = 'MPS02';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER plan_cascade_versions_controle BEFORE INSERT ON plan_cascade_versions
  FOR EACH ROW EXECUTE FUNCTION controler_plan_cascade_version();
