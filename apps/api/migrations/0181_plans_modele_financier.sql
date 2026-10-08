-- Modèle financier du plan stratégique (PLA-06, PLA-07, PLA-09).
--
-- Chaque enregistrement d'hypothèses crée une VERSION en ajout seul : les
-- hypothèses saisies (horizon et devise du plan compris), les écarts des
-- scénarios et le RÉSULTAT calculé par le moteur `@missionpilot/engines`
-- (calculerScenariosPlan : états SYSCOHADA simplifiés, indicateurs, scénarios
-- base/optimiste/pessimiste, alertes), figé et horodaté. Aucun chiffre n'est
-- recalculé ni corrigé ensuite : une nouvelle hypothèse = une nouvelle version.
--
-- Validation d'une version (avant toute exposition au client) : ligne de
-- `plan_modele_validations`, par une autre personne que l'auteur de la
-- version, sauf associé ou directeur de la mission (déclencheur).
--
-- Volume borné : au plus 200 versions par plan (VERSIONS_MODELE_PAR_PLAN_MAX
-- de plans/modele.ts, doublé ici, MPS05) et un résultat figé d'au plus 1 Mio.

CREATE TABLE plan_modele_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  plan_id uuid NOT NULL,
  version integer NOT NULL CHECK (version BETWEEN 1 AND 200),
  hypotheses jsonb NOT NULL CHECK (jsonb_typeof(hypotheses) = 'object'
    AND octet_length(hypotheses::text) <= 200000),
  ecarts jsonb NOT NULL CHECK (jsonb_typeof(ecarts) = 'object'
    AND octet_length(ecarts::text) <= 10000),
  resultat jsonb NOT NULL CHECK (jsonb_typeof(resultat) = 'object'
    AND octet_length(resultat::text) <= 1048576),
  -- Identifiant du moteur qui a produit le résultat.
  moteur text NOT NULL CHECK (length(moteur) BETWEEN 1 AND 60),
  commentaire text CHECK (commentaire IS NULL OR (length(commentaire) <= 1000
    AND commentaire !~ '[[:cntrl:]]')),
  cree_par uuid NOT NULL,
  calcule_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (plan_id, version),
  FOREIGN KEY (cabinet_id, plan_id) REFERENCES plans_strategiques (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX plan_modele_versions_idx ON plan_modele_versions (cabinet_id, plan_id, version DESC);
ALTER TABLE plan_modele_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON plan_modele_versions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON plan_modele_versions AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON plan_modele_versions FROM missionpilot_app;

CREATE TABLE plan_modele_validations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  modele_version_id uuid NOT NULL,
  valide_par uuid NOT NULL,
  valide_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (modele_version_id),
  FOREIGN KEY (cabinet_id, modele_version_id) REFERENCES plan_modele_versions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, valide_par) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE plan_modele_validations ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON plan_modele_validations
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON plan_modele_validations AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON plan_modele_validations FROM missionpilot_app;

CREATE TRIGGER plan_modele_versions_ajout_seul BEFORE UPDATE OR DELETE ON plan_modele_versions
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_plan();
CREATE TRIGGER plan_modele_validations_ajout_seul BEFORE UPDATE OR DELETE ON plan_modele_validations
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_plan();

-- Numérotation continue, plafond de versions et horizon du plan respecté.
CREATE FUNCTION controler_plan_modele_version() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_max integer; v_plan plans_strategiques%ROWTYPE;
  BEGIN
    SELECT * INTO v_plan FROM plans_strategiques WHERE id = NEW.plan_id;
    SELECT max(version) INTO v_max FROM plan_modele_versions WHERE plan_id = NEW.plan_id;
    IF coalesce(v_max, 0) >= 200 THEN
      RAISE EXCEPTION 'Un plan compte au plus 200 versions du modèle financier.'
        USING ERRCODE = 'MPS05';
    END IF;
    IF NEW.version <> coalesce(v_max, 0) + 1 THEN
      RAISE EXCEPTION 'Numéro de version inattendu.' USING ERRCODE = 'MPS02';
    END IF;
    IF (NEW.hypotheses ->> 'horizon')::int IS DISTINCT FROM v_plan.horizon::int
       OR NEW.hypotheses ->> 'devise' IS DISTINCT FROM v_plan.devise THEN
      RAISE EXCEPTION 'Hypothèses hors de l''horizon ou de la devise du plan.' USING ERRCODE = 'MPS02';
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER plan_modele_versions_controle BEFORE INSERT ON plan_modele_versions
  FOR EACH ROW EXECUTE FUNCTION controler_plan_modele_version();

-- Séparation des tâches de la validation d'une version du modèle.
CREATE FUNCTION controler_plan_modele_validation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v plan_modele_versions%ROWTYPE;
  BEGIN
    SELECT * INTO v FROM plan_modele_versions WHERE id = NEW.modele_version_id;
    IF v.cree_par = NEW.valide_par AND NOT plan_valideur_dispense(v.plan_id, NEW.valide_par) THEN
      RAISE EXCEPTION 'L''auteur d''une version du modèle ne la valide pas lui-même.'
        USING ERRCODE = 'MPS03';
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER plan_modele_validations_controle BEFORE INSERT ON plan_modele_validations
  FOR EACH ROW EXECUTE FUNCTION controler_plan_modele_validation();

/*
 * Plan : rattachement, horizon, devise et auteur immuables (le rôle
 * applicatif n'a de toute façon le droit de modifier que le titre et le
 * partage) ; le partage au client exige la version courante de chaque
 * élément validée et, s'il existe, la dernière version du modèle validée.
 */
CREATE FUNCTION controler_plan_strategique() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Un plan stratégique ne se supprime pas.' USING ERRCODE = 'MPS01';
    END IF;
    IF (NEW.cabinet_id, NEW.mission_id, NEW.horizon, NEW.devise, NEW.cree_par, NEW.cree_le)
       IS DISTINCT FROM (OLD.cabinet_id, OLD.mission_id, OLD.horizon, OLD.devise, OLD.cree_par, OLD.cree_le) THEN
      RAISE EXCEPTION 'Rattachement, horizon et devise du plan sont fixés à la création.'
        USING ERRCODE = 'MPS01';
    END IF;
    IF NEW.partage_client AND NOT OLD.partage_client THEN
      IF NOT EXISTS (SELECT 1 FROM plan_elements WHERE plan_id = NEW.id)
         OR EXISTS (
           SELECT 1 FROM (
             SELECT DISTINCT ON (v.element_id) v.statut_contenu
             FROM plan_element_versions v JOIN plan_elements e ON e.id = v.element_id
             WHERE e.plan_id = NEW.id ORDER BY v.element_id, v.version DESC) c
           WHERE c.statut_contenu <> 'valide')
         OR EXISTS (
           SELECT 1 FROM (SELECT id FROM plan_modele_versions WHERE plan_id = NEW.id
                          ORDER BY version DESC LIMIT 1) d
           WHERE NOT EXISTS (SELECT 1 FROM plan_modele_validations x WHERE x.modele_version_id = d.id)) THEN
        RAISE EXCEPTION 'Partage refusé : tout le contenu du plan doit être validé.'
          USING ERRCODE = 'MPS04';
      END IF;
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER plans_strategiques_controle BEFORE UPDATE OR DELETE ON plans_strategiques
  FOR EACH ROW EXECUTE FUNCTION controler_plan_strategique();
