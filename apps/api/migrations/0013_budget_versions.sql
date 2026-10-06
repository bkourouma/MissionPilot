-- Versions de budget d'une mission (FIN-01, FIN-03, FIN-15).
-- Le budget initial est figé à la signature ; une révision crée une nouvelle
-- version motivée, figée à sa validation. Une version figée et ses lignes sont
-- immuables : le contrôle est fait par le moteur dans l'API ET ici, en base.

CREATE TABLE budget_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  mission_id uuid NOT NULL,
  numero int NOT NULL CHECK (numero >= 1),
  type text NOT NULL CHECK (type IN ('initial', 'revise', 'atterrissage')),
  devise text NOT NULL CHECK (devise IN ('XOF', 'XAF', 'EUR', 'USD')),
  figee boolean NOT NULL DEFAULT false,
  date_figeage date,
  motif text CHECK (motif IS NULL OR length(motif) <= 2000),
  -- Rôle exigé pour valider la révision (FIN-15), calculé à la validation.
  role_approbateur text CHECK (role_approbateur IN ('chef_mission', 'directeur_mission', 'associe')),
  cree_par uuid,
  cree_le timestamptz NOT NULL DEFAULT now(),
  validee_par uuid,
  validee_le timestamptz,
  CHECK (figee = (date_figeage IS NOT NULL)),
  CHECK (type = 'initial' OR (motif IS NOT NULL AND length(btrim(motif)) > 0)),
  CHECK ((type = 'initial') = (numero = 1)),
  UNIQUE (mission_id, numero),
  UNIQUE (cabinet_id, mission_id, id),
  FOREIGN KEY (cabinet_id, mission_id) REFERENCES missions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, validee_par) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE budget_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON budget_versions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());

CREATE TABLE budget_lignes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  mission_id uuid NOT NULL,
  version_id uuid NOT NULL,
  -- Clé stable d'une version à l'autre (comparaison FIN-03), ex. « honoraires:grade:senior ».
  cle text NOT NULL CHECK (length(cle) BETWEEN 1 AND 120),
  libelle text NOT NULL CHECK (length(libelle) BETWEEN 1 AND 200),
  nature text NOT NULL CHECK (nature IN ('honoraires', 'cout_interne', 'debours', 'sous_traitance')),
  grade_code text,
  jours numeric(10, 2) CHECK (jours >= 0),
  prix_journalier bigint CHECK (prix_journalier >= 0),
  montant_forfait bigint CHECK (montant_forfait >= 0),
  refacturable boolean NOT NULL DEFAULT false,
  ordre int NOT NULL DEFAULT 0,
  CHECK ((jours IS NOT NULL AND prix_journalier IS NOT NULL AND montant_forfait IS NULL)
      OR (jours IS NULL AND prix_journalier IS NULL AND montant_forfait IS NOT NULL)),
  CHECK (nature = 'debours' OR NOT refacturable),
  UNIQUE (version_id, cle),
  FOREIGN KEY (cabinet_id, mission_id, version_id)
    REFERENCES budget_versions (cabinet_id, mission_id, id) ON DELETE CASCADE
);
CREATE INDEX budget_lignes_version_idx ON budget_lignes (version_id, ordre);
ALTER TABLE budget_lignes ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON budget_lignes
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());

-- Une version figée ne se modifie ni ne se supprime, ni ne se « défige ».
CREATE FUNCTION refuser_version_budget_figee() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF OLD.figee THEN
      RAISE EXCEPTION 'Version de budget figée : créer une révision motivée.' USING ERRCODE = 'MPF01';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER budget_versions_figees BEFORE UPDATE OR DELETE ON budget_versions
  FOR EACH ROW EXECUTE FUNCTION refuser_version_budget_figee();

-- Les lignes d'une version figée ne s'ajoutent, ne se modifient ni ne se suppriment.
-- SECURITY DEFINER : le contrôle lit la version quelle que soit la visibilité RLS.
CREATE FUNCTION refuser_ligne_budget_figee() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE v_versions uuid[];
  BEGIN
    IF TG_OP = 'INSERT' THEN v_versions := ARRAY[NEW.version_id];
    ELSIF TG_OP = 'DELETE' THEN v_versions := ARRAY[OLD.version_id];
    ELSE v_versions := ARRAY[OLD.version_id, NEW.version_id];
    END IF;
    IF EXISTS (SELECT 1 FROM budget_versions WHERE id = ANY (v_versions) AND figee) THEN
      RAISE EXCEPTION 'Version de budget figée : créer une révision motivée.' USING ERRCODE = 'MPF01';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER budget_lignes_figees BEFORE INSERT OR UPDATE OR DELETE ON budget_lignes
  FOR EACH ROW EXECUTE FUNCTION refuser_ligne_budget_figee();

-- Une seule version initiale et au plus une révision en cours (non figée) par mission.
CREATE UNIQUE INDEX budget_versions_brouillon_uniq ON budget_versions (mission_id) WHERE NOT figee;
