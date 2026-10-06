-- Catalogue des types de mission et modèle hiérarchique (MIS-01, MIS-02, MIS-12).
CREATE TABLE types_mission (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  code text NOT NULL CHECK (code ~ '^[a-z0-9_]{1,40}$'),
  libelle text NOT NULL CHECK (length(libelle) BETWEEN 1 AND 160),
  domaine text,
  mode_facturation text NOT NULL
    CHECK (mode_facturation IN ('forfait', 'regie', 'forfait_variable', 'abonnement')),
  duree_type_jours int CHECK (duree_type_jours > 0),
  equipe_type jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(equipe_type) = 'array'),
  actif boolean NOT NULL DEFAULT true,
  -- Valeur de départ fournie par MissionPilot, à valider par le métier.
  a_valider boolean NOT NULL DEFAULT false,
  cree_le timestamptz NOT NULL DEFAULT now(),
  modifie_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, code),
  UNIQUE (cabinet_id, id)
);
ALTER TABLE types_mission ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON types_mission
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
-- Un type de mission est désactivé, jamais supprimé (les missions le référenceront).
REVOKE DELETE ON types_mission FROM missionpilot_app;

-- niveau 1 = phase, 2 = lot, 3 = tâche ; le parent est dans le même type.
CREATE TABLE modele_elements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  type_mission_id uuid NOT NULL,
  parent_id uuid,
  niveau smallint NOT NULL CHECK (niveau BETWEEN 1 AND 3),
  libelle text NOT NULL CHECK (length(libelle) BETWEEN 1 AND 200),
  ordre int NOT NULL DEFAULT 0,
  jours_par_grade jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(jours_par_grade) = 'object'),
  est_livrable boolean NOT NULL DEFAULT false,
  est_jalon boolean NOT NULL DEFAULT false,
  cree_le timestamptz NOT NULL DEFAULT now(),
  modifie_le timestamptz NOT NULL DEFAULT now(),
  CHECK ((niveau = 1) = (parent_id IS NULL)),
  UNIQUE (cabinet_id, type_mission_id, id),
  FOREIGN KEY (cabinet_id, type_mission_id) REFERENCES types_mission (cabinet_id, id),
  FOREIGN KEY (cabinet_id, type_mission_id, parent_id)
    REFERENCES modele_elements (cabinet_id, type_mission_id, id) ON DELETE CASCADE
);
CREATE INDEX modele_elements_type_idx ON modele_elements (type_mission_id, niveau, ordre);
ALTER TABLE modele_elements ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON modele_elements
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
