-- Découpage d'une mission (PLN-01) : phases > lots (facultatifs) > tâches, jalons ;
-- budget en jours par tâche, par grade ou par personne (PLN-02) ;
-- dépendances fin → début entre tâches (PLN-03).
-- Toutes les références restent dans la même mission par clés composites.

CREATE TABLE mission_phases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  mission_id uuid NOT NULL,
  libelle text NOT NULL CHECK (length(libelle) BETWEEN 1 AND 200),
  ordre int NOT NULL DEFAULT 0,
  cree_le timestamptz NOT NULL DEFAULT now(),
  modifie_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, mission_id, id),
  FOREIGN KEY (cabinet_id, mission_id) REFERENCES missions (cabinet_id, id)
);
CREATE INDEX mission_phases_idx ON mission_phases (mission_id, ordre);
ALTER TABLE mission_phases ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON mission_phases
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());

CREATE TABLE mission_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  mission_id uuid NOT NULL,
  phase_id uuid NOT NULL,
  libelle text NOT NULL CHECK (length(libelle) BETWEEN 1 AND 200),
  ordre int NOT NULL DEFAULT 0,
  est_livrable boolean NOT NULL DEFAULT false,
  cree_le timestamptz NOT NULL DEFAULT now(),
  modifie_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, mission_id, id),
  UNIQUE (cabinet_id, mission_id, phase_id, id),
  FOREIGN KEY (cabinet_id, mission_id, phase_id)
    REFERENCES mission_phases (cabinet_id, mission_id, id) ON DELETE CASCADE
);
CREATE INDEX mission_lots_idx ON mission_lots (mission_id, phase_id, ordre);
ALTER TABLE mission_lots ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON mission_lots
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());

-- Une tâche est sous une phase, et sous un lot de cette même phase s'il y en a un.
-- Déplacer un lot vers une autre phase y entraîne ses tâches (ON UPDATE CASCADE).
CREATE TABLE mission_taches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  mission_id uuid NOT NULL,
  phase_id uuid NOT NULL,
  lot_id uuid,
  libelle text NOT NULL CHECK (length(libelle) BETWEEN 1 AND 200),
  ordre int NOT NULL DEFAULT 0,
  est_livrable boolean NOT NULL DEFAULT false,
  -- Début souhaité ; le planning calcule les dates au plus tôt en jours ouvrés.
  date_debut date,
  duree_jours_ouvres int NOT NULL DEFAULT 1 CHECK (duree_jours_ouvres BETWEEN 1 AND 1000),
  cree_le timestamptz NOT NULL DEFAULT now(),
  modifie_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, mission_id, id),
  FOREIGN KEY (cabinet_id, mission_id, phase_id)
    REFERENCES mission_phases (cabinet_id, mission_id, id) ON DELETE CASCADE,
  FOREIGN KEY (cabinet_id, mission_id, phase_id, lot_id)
    REFERENCES mission_lots (cabinet_id, mission_id, phase_id, id)
    ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX mission_taches_idx ON mission_taches (mission_id, phase_id, lot_id, ordre);
ALTER TABLE mission_taches ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON mission_taches
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());

CREATE TABLE mission_jalons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  mission_id uuid NOT NULL,
  phase_id uuid,
  libelle text NOT NULL CHECK (length(libelle) BETWEEN 1 AND 200),
  date_prevue date,
  atteint boolean NOT NULL DEFAULT false,
  ordre int NOT NULL DEFAULT 0,
  cree_le timestamptz NOT NULL DEFAULT now(),
  modifie_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, mission_id, id),
  FOREIGN KEY (cabinet_id, mission_id) REFERENCES missions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, mission_id, phase_id)
    REFERENCES mission_phases (cabinet_id, mission_id, id) ON DELETE CASCADE
);
CREATE INDEX mission_jalons_idx ON mission_jalons (mission_id, ordre);
ALTER TABLE mission_jalons ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON mission_jalons
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());

-- Budget en jours d'une tâche : une ligne par grade ou par personne.
CREATE TABLE tache_budget_lignes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  mission_id uuid NOT NULL,
  tache_id uuid NOT NULL,
  grade_id uuid,
  collaborateur_id uuid,
  jours numeric(8, 2) NOT NULL CHECK (jours >= 0),
  CHECK ((grade_id IS NULL) <> (collaborateur_id IS NULL)),
  FOREIGN KEY (cabinet_id, mission_id, tache_id)
    REFERENCES mission_taches (cabinet_id, mission_id, id) ON DELETE CASCADE,
  FOREIGN KEY (cabinet_id, grade_id) REFERENCES grades (cabinet_id, id),
  FOREIGN KEY (cabinet_id, collaborateur_id) REFERENCES collaborateurs (cabinet_id, id)
);
CREATE UNIQUE INDEX tache_budget_grade_uniq ON tache_budget_lignes (tache_id, grade_id)
  WHERE grade_id IS NOT NULL;
CREATE UNIQUE INDEX tache_budget_collaborateur_uniq ON tache_budget_lignes (tache_id, collaborateur_id)
  WHERE collaborateur_id IS NOT NULL;
CREATE INDEX tache_budget_mission_idx ON tache_budget_lignes (mission_id);
ALTER TABLE tache_budget_lignes ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON tache_budget_lignes
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());

CREATE TABLE mission_dependances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  mission_id uuid NOT NULL,
  predecesseur_id uuid NOT NULL,
  successeur_id uuid NOT NULL,
  -- Décalage en jours ouvrés (négatif : chevauchement).
  decalage int NOT NULL DEFAULT 0 CHECK (decalage BETWEEN -365 AND 365),
  cree_le timestamptz NOT NULL DEFAULT now(),
  CHECK (predecesseur_id <> successeur_id),
  UNIQUE (predecesseur_id, successeur_id),
  FOREIGN KEY (cabinet_id, mission_id, predecesseur_id)
    REFERENCES mission_taches (cabinet_id, mission_id, id) ON DELETE CASCADE,
  FOREIGN KEY (cabinet_id, mission_id, successeur_id)
    REFERENCES mission_taches (cabinet_id, mission_id, id) ON DELETE CASCADE
);
CREATE INDEX mission_dependances_idx ON mission_dependances (mission_id);
ALTER TABLE mission_dependances ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON mission_dependances
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
