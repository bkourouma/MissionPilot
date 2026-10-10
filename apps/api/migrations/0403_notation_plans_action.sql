-- Plan d'action d'une notation construit depuis une bibliothèque d'initiatives types (NOT-17,
-- PRD complémentaire §11.1), priorisé par l'impact observé dans des contextes semblables et la
-- capacité du client (moteur `prioriserInitiatives`, jamais en SQL).
--
-- Rapprochement : le lot PLA crée la bibliothèque d'initiatives du plan stratégique (PLA-13,
-- migrations 0420–0439). Les deux lots ont travaillé en parallèle : cette bibliothèque
-- MINIMALE, propre à la notation, s'appelle `notation_initiatives_types` pour ne pas entrer en
-- collision ; leur fusion (une seule bibliothèque, référencée par la notation et par le plan)
-- reste à décider et passera par une nouvelle migration.
--
-- - `notation_initiatives_types` : bibliothèque du cabinet ; code et auteur figés ; une
--   initiative se retire (active = false) mais ne se supprime pas (MPN12).
-- - `notation_initiatives_impacts` : gains de note OBSERVÉS par contexte (secteur, taille), en
--   ajout seul (MPN12) ; ils nourrissent la priorisation.
-- - `notation_plans_action` : plan priorisé d'une version de notation (contexte, capacité,
--   sortie du moteur figée), en ajout seul, rang consécutif par notation, version de la même
--   notation (MPN12).

CREATE TABLE notation_initiatives_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  code text NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9_.-]{0,79}$'),
  titre text NOT NULL CHECK (length(btrim(titre)) BETWEEN 1 AND 200),
  description text CHECK (description IS NULL OR length(btrim(description)) BETWEEN 1 AND 4000),
  dimensions text[] NOT NULL CHECK (cardinality(dimensions) BETWEEN 1 AND 20),
  effort int NOT NULL CHECK (effort BETWEEN 1 AND 5),
  duree_mois int NOT NULL CHECK (duree_mois BETWEEN 1 AND 60),
  active boolean NOT NULL DEFAULT true,
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  modifie_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, code),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX notation_initiatives_types_tri_idx ON notation_initiatives_types (cabinet_id, code, id);
ALTER TABLE notation_initiatives_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON notation_initiatives_types
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON notation_initiatives_types AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE DELETE ON notation_initiatives_types FROM missionpilot_app;

CREATE FUNCTION controler_notation_initiative_type() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Une initiative type se retire, elle ne se supprime pas.' USING ERRCODE = 'MPN12';
    END IF;
    IF TG_OP = 'UPDATE' AND (NEW.id, NEW.cabinet_id, NEW.code, NEW.cree_par, NEW.cree_le)
       IS DISTINCT FROM (OLD.id, OLD.cabinet_id, OLD.code, OLD.cree_par, OLD.cree_le) THEN
      RAISE EXCEPTION 'Le code et l''auteur d''une initiative type sont figés.' USING ERRCODE = 'MPN12';
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(NEW.dimensions) d
               WHERE d IS NULL OR d !~ '^[a-z0-9][a-z0-9_.-]{0,79}$') THEN
      RAISE EXCEPTION 'Dimension ciblée invalide.' USING ERRCODE = 'MPN12';
    END IF;
    NEW.modifie_le := now();
    RETURN NEW;
  END $$;
CREATE TRIGGER notation_initiatives_types_controle
  BEFORE INSERT OR UPDATE OR DELETE ON notation_initiatives_types
  FOR EACH ROW EXECUTE FUNCTION controler_notation_initiative_type();

CREATE TABLE notation_initiatives_impacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  initiative_id uuid NOT NULL,
  secteur text CHECK (secteur IS NULL OR secteur ~ '^[a-z0-9][a-z0-9_.-]{0,79}$'),
  taille text CHECK (taille IS NULL OR taille ~ '^[a-z0-9][a-z0-9_.-]{0,79}$'),
  gain numeric(4, 1) NOT NULL CHECK (gain BETWEEN 0 AND 100),
  source text NOT NULL CHECK (length(btrim(source)) BETWEEN 1 AND 500),
  observe_le date NOT NULL CHECK (observe_le BETWEEN '2000-01-01' AND '2100-12-31'),
  saisi_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, initiative_id) REFERENCES notation_initiatives_types (cabinet_id, id),
  FOREIGN KEY (cabinet_id, saisi_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX notation_initiatives_impacts_initiative_idx
  ON notation_initiatives_impacts (cabinet_id, initiative_id);
ALTER TABLE notation_initiatives_impacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON notation_initiatives_impacts
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON notation_initiatives_impacts AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON notation_initiatives_impacts FROM missionpilot_app;

CREATE FUNCTION refuser_modification_plan_notation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    RAISE EXCEPTION 'Impacts observés et plans d''action de notation sont en ajout seul.'
      USING ERRCODE = 'MPN12';
  END $$;
CREATE TRIGGER notation_initiatives_impacts_ajout_seul
  BEFORE UPDATE OR DELETE ON notation_initiatives_impacts
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_plan_notation();

CREATE TABLE notation_plans_action (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  notation_id uuid NOT NULL,
  version_id uuid NOT NULL,
  rang int NOT NULL CHECK (rang BETWEEN 1 AND 1000),
  capacite int NOT NULL CHECK (capacite BETWEEN 1 AND 100),
  contexte jsonb NOT NULL CHECK (jsonb_typeof(contexte) = 'object' AND octet_length(contexte::text) <= 2000),
  contenu jsonb NOT NULL CHECK (jsonb_typeof(contenu) = 'object' AND octet_length(contenu::text) <= 500000),
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, notation_id, rang),
  FOREIGN KEY (cabinet_id, notation_id) REFERENCES notations (cabinet_id, id),
  FOREIGN KEY (cabinet_id, version_id) REFERENCES notation_versions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE notation_plans_action ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON notation_plans_action
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON notation_plans_action AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON notation_plans_action FROM missionpilot_app;

CREATE FUNCTION controler_notation_plan_action() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM notation_versions v
                   WHERE v.id = NEW.version_id AND v.notation_id = NEW.notation_id) THEN
      RAISE EXCEPTION 'La version ne relève pas de cette notation.' USING ERRCODE = 'MPN12';
    END IF;
    IF NEW.rang <> coalesce((SELECT max(p.rang) FROM notation_plans_action p
                             WHERE p.notation_id = NEW.notation_id), 0) + 1 THEN
      RAISE EXCEPTION 'Rang de plan d''action inattendu.' USING ERRCODE = 'MPN12';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER notation_plans_action_controle BEFORE INSERT ON notation_plans_action
  FOR EACH ROW EXECUTE FUNCTION controler_notation_plan_action();
CREATE TRIGGER notation_plans_action_ajout_seul BEFORE UPDATE OR DELETE ON notation_plans_action
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_plan_notation();
