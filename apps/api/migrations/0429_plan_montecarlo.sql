-- Simulation de Monte-Carlo du plan financier (PLA-16, PRD complémentaire
-- §11.3) : distribution de la VAN et probabilité de tension de trésorerie,
-- reproductibles (graine fixée).
--
-- `plan_simulations_montecarlo` enregistre chaque simulation lancée sur une
-- VERSION du modèle financier (`plan_modele_versions`, hypothèses figées) :
-- graine, nombre de tirages, lois des hypothèses incertaines, RÉSULTAT du
-- moteur (`simulerMonteCarlo`, packages/engines) et son empreinte. La
-- simulation ne modifie jamais le plan ni la version du modèle (qui reste
-- immuable) : elle s'ajoute dans sa propre table, en ajout seul. Elle se
-- REJOUE (même graine, mêmes paramètres, mêmes hypothèses) sans écrire.
--
-- Volume borné : au plus 100 simulations par plan (MQL12) et 30 par
-- utilisateur sur 10 minutes (MQL14, doublé par l'API, 429) ; résultat
-- d'au plus 200 Kio.
--
-- Table à RLS : politique `isolation` (cabinet) et politique RESTRICTIVE
-- `portail_interdit` (ces états financiers ne vont jamais au portail).
--
-- SQLSTATE (préfixe MQL, plage MQL10 à MQL14) :
--   MQL10  historique en ajout seul (modification ou suppression refusée) ;
--   MQL11  version du modèle d'un autre plan que la simulation ;
--   MQL12  plafond de 100 simulations par plan ;
--   MQL13  graine, tirages ou empreinte différents de ceux du résultat figé ;
--   MQL14  plafond de débit : 30 simulations par utilisateur sur 10 minutes.

CREATE TABLE plan_simulations_montecarlo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  plan_id uuid NOT NULL,
  modele_version_id uuid NOT NULL,
  graine bigint NOT NULL CHECK (graine BETWEEN 0 AND 4294967295),
  tirages integer NOT NULL CHECK (tirages BETWEEN 100 AND 2000),
  -- Lois des hypothèses incertaines : {"hypotheses": [{cible, loi}, ...]} (1 à 5).
  parametres jsonb NOT NULL CHECK (jsonb_typeof(parametres) = 'object'
    AND jsonb_typeof(parametres -> 'hypotheses') = 'array'
    AND jsonb_array_length(parametres -> 'hypotheses') BETWEEN 1 AND 5
    AND octet_length(parametres::text) <= 20000),
  resultat jsonb NOT NULL CHECK (jsonb_typeof(resultat) = 'object'
    AND octet_length(resultat::text) <= 200000),
  -- Somme de contrôle du résultat (FNV-1a 32 bits, 8 caractères hexadécimaux).
  empreinte text NOT NULL CHECK (empreinte ~ '^[0-9a-f]{8}$'),
  -- Identifiant du moteur qui a produit le résultat.
  moteur text NOT NULL CHECK (length(moteur) BETWEEN 1 AND 60),
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, plan_id) REFERENCES plans_strategiques (cabinet_id, id),
  FOREIGN KEY (cabinet_id, modele_version_id) REFERENCES plan_modele_versions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX plan_simulations_montecarlo_plan_idx
  ON plan_simulations_montecarlo (cabinet_id, plan_id, cree_le DESC, id DESC);
CREATE INDEX plan_simulations_montecarlo_debit_idx
  ON plan_simulations_montecarlo (cree_par, cree_le DESC);
ALTER TABLE plan_simulations_montecarlo ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON plan_simulations_montecarlo
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON plan_simulations_montecarlo AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON plan_simulations_montecarlo FROM missionpilot_app;

CREATE FUNCTION refuser_modification_montecarlo() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    RAISE EXCEPTION 'Une simulation de Monte-Carlo ne se modifie ni ne se supprime.'
      USING ERRCODE = 'MQL10';
  END $$;
CREATE TRIGGER plan_simulations_montecarlo_ajout_seul
  BEFORE UPDATE OR DELETE ON plan_simulations_montecarlo
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_montecarlo();

/*
 * Version du modèle du MÊME plan, résultat cohérent avec la graine, les
 * tirages et l'empreinte enregistrés, plafonds par plan et par utilisateur.
 */
CREATE FUNCTION controler_plan_simulation_montecarlo() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM plan_modele_versions v
                   WHERE v.id = NEW.modele_version_id AND v.plan_id = NEW.plan_id) THEN
      RAISE EXCEPTION 'Version du modèle financier d''un autre plan.' USING ERRCODE = 'MQL11';
    END IF;
    IF (SELECT count(*) FROM plan_simulations_montecarlo WHERE plan_id = NEW.plan_id) >= 100 THEN
      RAISE EXCEPTION 'Un plan compte au plus 100 simulations de Monte-Carlo.'
        USING ERRCODE = 'MQL12';
    END IF;
    IF (NEW.resultat ->> 'graine') IS DISTINCT FROM NEW.graine::text
       OR (NEW.resultat ->> 'tirages') IS DISTINCT FROM NEW.tirages::text
       OR (NEW.resultat ->> 'empreinte') IS DISTINCT FROM NEW.empreinte THEN
      RAISE EXCEPTION 'Résultat incohérent avec la graine, les tirages ou l''empreinte.'
        USING ERRCODE = 'MQL13';
    END IF;
    IF (SELECT count(*) FROM plan_simulations_montecarlo
        WHERE cree_par = NEW.cree_par AND cree_le > now() - interval '10 minutes') >= 30 THEN
      RAISE EXCEPTION 'Au plus 30 simulations par utilisateur sur 10 minutes.'
        USING ERRCODE = 'MQL14';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER plan_simulations_montecarlo_controle BEFORE INSERT ON plan_simulations_montecarlo
  FOR EACH ROW EXECUTE FUNCTION controler_plan_simulation_montecarlo();
