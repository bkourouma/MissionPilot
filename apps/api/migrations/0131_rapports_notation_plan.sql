-- Rapports de notation (NOT-07) et de plan stratégique (PLA-11) : deux
-- nouveaux modèles du moteur de rapports (SOC-07, apps/api/src/rapports),
-- enregistrés comme l'état d'avancement dans `rapports_mission` (ajout seul).
--
-- - `notation` : rendu d'une version PUBLIÉE de la notation (revue d'un expert
--   métier, MPN04) ; niveau « notation » (lecture : « notation.lire »).
-- - `plan_strategique` : rendu du plan, dont SEULS les contenus validés sont
--   reproduits (rapports/plan.ts) ; niveau « plan » (lecture : « plan.lire »).
-- Les niveaux restent calculés et revérifiés à chaque lecture par le code
-- (rapports/niveaux.ts, stockage/fichiers.ts `exigerFichierLisible`), en plus
-- de la mission visible et de « mission.lire ».
--
-- Source du rapport : `notation_id` ou `plan_id`, et `version_source`
-- (numéro de la version de notation, ou de la version du modèle financier
-- retenue ; NULL pour un plan sans modèle). Cohérence imposée par CHECK et par
-- un déclencheur (MPR01, MPR02) : la source existe DANS LE CABINET COURANT
-- (lecture sous RLS) et appartient à la mission du rapport ; une notation
-- n'est rendue que depuis une version publiée.
--
-- Pas de clé étrangère vers `notations` (0146) ni `plans_strategiques` (0180) :
-- ces tables sont créées APRÈS cette migration (ordre des fichiers). Le
-- déclencheur les remplace à l'insertion (seule écriture permise : la table
-- est en ajout seul), et ni les notations ni les plans ne se suppriment
-- (MPN01, MPS01). Le corps PL/pgSQL n'est résolu qu'à l'exécution.

ALTER TABLE rapports_mission
  DROP CONSTRAINT rapports_mission_modele_check,
  ADD CONSTRAINT rapports_mission_modele_check
    CHECK (modele IN ('etat_avancement', 'notation', 'plan_strategique')),
  DROP CONSTRAINT rapports_mission_niveau_check,
  ADD CONSTRAINT rapports_mission_niveau_check
    CHECK (niveau IN ('base', 'jours', 'finance', 'notation', 'plan')),
  ADD COLUMN notation_id uuid,
  ADD COLUMN plan_id uuid,
  ADD COLUMN version_source int
    CHECK (version_source IS NULL OR version_source BETWEEN 1 AND 100000),
  ADD CONSTRAINT rapports_mission_source_check CHECK (
    (modele = 'etat_avancement' AND notation_id IS NULL AND plan_id IS NULL
      AND version_source IS NULL AND niveau IN ('base', 'jours', 'finance'))
    OR (modele = 'notation' AND notation_id IS NOT NULL AND plan_id IS NULL
      AND version_source IS NOT NULL AND niveau = 'notation')
    OR (modele = 'plan_strategique' AND plan_id IS NOT NULL AND notation_id IS NULL
      AND niveau = 'plan'));

-- Listes par notation et par plan (routes/rapports.ts), plus récent d'abord.
CREATE INDEX rapports_mission_notation_idx ON rapports_mission (cabinet_id, notation_id, genere_le)
  WHERE notation_id IS NOT NULL;
CREATE INDEX rapports_mission_plan_idx ON rapports_mission (cabinet_id, plan_id, genere_le)
  WHERE plan_id IS NOT NULL;

-- Fonction d'invocateur : RLS s'applique, seules les lignes du cabinet courant
-- sont lues (une source d'un autre cabinet est donc refusée, MPR01).
CREATE FUNCTION controler_source_rapport() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF NEW.notation_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM notations n WHERE n.id = NEW.notation_id AND n.mission_id = NEW.mission_id
    ) THEN
      RAISE EXCEPTION 'La notation du rapport n''appartient pas à sa mission.' USING ERRCODE = 'MPR01';
    END IF;
    IF NEW.plan_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM plans_strategiques p WHERE p.id = NEW.plan_id AND p.mission_id = NEW.mission_id
    ) THEN
      RAISE EXCEPTION 'Le plan du rapport n''appartient pas à sa mission.' USING ERRCODE = 'MPR01';
    END IF;
    IF NEW.modele = 'notation' AND NOT EXISTS (
      SELECT 1 FROM notation_versions v
      JOIN notation_evenements e ON e.version_id = v.id AND e.action = 'publication'
      WHERE v.notation_id = NEW.notation_id AND v.numero = NEW.version_source
    ) THEN
      RAISE EXCEPTION 'Seule une version publiée de la notation se rend en rapport.'
        USING ERRCODE = 'MPR02';
    END IF;
    IF NEW.modele = 'plan_strategique' AND NEW.version_source IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM plan_modele_versions v
      WHERE v.plan_id = NEW.plan_id AND v.version = NEW.version_source
    ) THEN
      RAISE EXCEPTION 'La version du modèle financier du rapport n''existe pas.'
        USING ERRCODE = 'MPR01';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER rapports_mission_source BEFORE INSERT ON rapports_mission
  FOR EACH ROW EXECUTE FUNCTION controler_source_rapport();
