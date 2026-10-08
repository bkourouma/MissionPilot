-- Plan comptable du cabinet pour l'export des écritures (FIN-13). Absence de
-- ligne : plan de départ SYSCOHADA révisé défini dans l'API
-- (apps/api/src/finance/plan-comptable.ts), VALEURS DE DÉPART à faire valider
-- par un expert-comptable (`valeurs_validees`). Une ligne par compte ou par
-- journal ; le journal d'audit trace chaque modification et chaque export
-- (qui, période, nombre de lignes, jamais de montant).

CREATE TABLE plan_comptable_cabinet (
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('compte', 'journal')),
  cle text NOT NULL CHECK (cle ~ '^[a-z_]{1,40}$'),
  valeur text NOT NULL CHECK (valeur ~ '^[0-9A-Z]{1,12}$'),
  modifie_par uuid,
  modifie_le timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cabinet_id, type, cle),
  CHECK (type <> 'compte' OR valeur ~ '^[0-9A-Z]{2,12}$'),
  CHECK (type <> 'journal' OR valeur ~ '^[0-9A-Z]{1,6}$'),
  FOREIGN KEY (cabinet_id, modifie_par) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE plan_comptable_cabinet ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON plan_comptable_cabinet
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE DELETE ON plan_comptable_cabinet FROM missionpilot_app;

-- Validation du plan de départ par l'expert-comptable du cabinet.
CREATE TABLE plan_comptable_validation (
  cabinet_id uuid PRIMARY KEY REFERENCES cabinets (id) ON DELETE CASCADE,
  valeurs_validees boolean NOT NULL DEFAULT false,
  modifie_par uuid,
  modifie_le timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (cabinet_id, modifie_par) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE plan_comptable_validation ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON plan_comptable_validation
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE DELETE ON plan_comptable_validation FROM missionpilot_app;
