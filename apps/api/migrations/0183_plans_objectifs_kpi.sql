-- KPI créés depuis les objectifs du plan stratégique (PLA-10).
--
-- Le KPI lui-même vit dans le module de pilotage (`kpi_definitions`, 0160) :
-- même mission que le plan, même client, mêmes règles. Cette table ne garde
-- que le RATTACHEMENT d'un KPI à l'objectif dont il est issu, et la version
-- de l'objectif au moment de la création. Ajout seul (MPS01) : un KPI
-- rattaché le reste (un KPI ne se supprime pas, 0160 ; il se désactive).
-- Un KPI n'est rattaché qu'à un objectif.
--
-- Invisible du portail (`portail_interdit`) : le client voit ses KPI par les
-- routes du portail KPI, jamais le plan.

CREATE TABLE plan_objectif_kpis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  plan_id uuid NOT NULL,
  objectif_id uuid NOT NULL,
  kpi_id uuid NOT NULL,
  objectif_version integer NOT NULL CHECK (objectif_version >= 1),
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (kpi_id),
  FOREIGN KEY (cabinet_id, plan_id, objectif_id) REFERENCES plan_elements (cabinet_id, plan_id, id),
  FOREIGN KEY (cabinet_id, kpi_id) REFERENCES kpi_definitions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX plan_objectif_kpis_idx ON plan_objectif_kpis (cabinet_id, plan_id, objectif_id, cree_le);
ALTER TABLE plan_objectif_kpis ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON plan_objectif_kpis
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON plan_objectif_kpis AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON plan_objectif_kpis FROM missionpilot_app;

CREATE TRIGGER plan_objectif_kpis_ajout_seul BEFORE UPDATE OR DELETE ON plan_objectif_kpis
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_plan();

-- Rattachement cohérent : un objectif du plan, une version existante de cet
-- objectif, un KPI de la mission du plan.
CREATE FUNCTION controler_plan_objectif_kpi() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM plan_elements e WHERE e.id = NEW.objectif_id AND e.type = 'objectif')
       OR NOT EXISTS (SELECT 1 FROM plan_element_versions v
                      WHERE v.element_id = NEW.objectif_id AND v.version = NEW.objectif_version)
       OR NOT EXISTS (SELECT 1 FROM kpi_definitions k JOIN plans_strategiques p ON p.id = NEW.plan_id
                      WHERE k.id = NEW.kpi_id AND k.mission_id = p.mission_id) THEN
      RAISE EXCEPTION 'Rattachement incohérent : objectif du plan et KPI de sa mission attendus.'
        USING ERRCODE = 'MPS02';
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER plan_objectif_kpis_controle BEFORE INSERT ON plan_objectif_kpis
  FOR EACH ROW EXECUTE FUNCTION controler_plan_objectif_kpi();
