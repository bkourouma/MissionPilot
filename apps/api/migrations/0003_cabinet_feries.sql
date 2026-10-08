-- Paramètres du cabinet : jours fériés (SOC-04). Les autres paramètres
-- (pays, devise, unité de saisie, durée de journée, semaine) sont dans cabinets.
CREATE TABLE cabinet_feries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  date date NOT NULL,
  libelle text NOT NULL CHECK (length(libelle) BETWEEN 1 AND 120),
  nationale boolean NOT NULL DEFAULT true,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, date)
);
ALTER TABLE cabinet_feries ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON cabinet_feries
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());

ALTER TABLE cabinets ADD CONSTRAINT cabinets_jours_travailles_valides
  CHECK (cardinality(jours_travailles) BETWEEN 1 AND 7 AND jours_travailles <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[]);
