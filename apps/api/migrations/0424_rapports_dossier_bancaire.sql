-- Dossier bancaire (PLA-17) : nouveau modèle du moteur de rapports (SOC-07),
-- enregistré comme les autres dans `rapports_mission` (ajout seul, 0130).
--
-- `dossier_bancaire` : ratios bancaires, plan de financement et états
-- prévisionnels d'un plan stratégique, calculés UNIQUEMENT depuis une version
-- VALIDÉE du modèle financier existant (rapports/dossier-bancaire.ts) ;
-- niveau « plan » (lecture : « plan.lire »), comme le rapport du plan.
-- Source : `plan_id` et `version_source` (version du modèle, obligatoire),
-- contrôlées par le déclencheur : plan de la mission du rapport (MPR01),
-- version existante ET validée (MPR03, nouveau code).
--
-- Les contraintes de modèle et de source sont RÉÉCRITES en entier (une
-- contrainte CHECK ne s'étend pas) : les trois modèles de 0131 y restent à
-- l'identique. Un lot qui ajoute un autre modèle de rapport doit reprendre
-- cette liste (numéro plus grand).

ALTER TABLE rapports_mission
  DROP CONSTRAINT rapports_mission_modele_check,
  ADD CONSTRAINT rapports_mission_modele_check
    CHECK (modele IN ('etat_avancement', 'notation', 'plan_strategique', 'dossier_bancaire')),
  DROP CONSTRAINT rapports_mission_source_check,
  ADD CONSTRAINT rapports_mission_source_check CHECK (
    (modele = 'etat_avancement' AND notation_id IS NULL AND plan_id IS NULL
      AND version_source IS NULL AND niveau IN ('base', 'jours', 'finance'))
    OR (modele = 'notation' AND notation_id IS NOT NULL AND plan_id IS NULL
      AND version_source IS NOT NULL AND niveau = 'notation')
    OR (modele = 'plan_strategique' AND plan_id IS NOT NULL AND notation_id IS NULL
      AND niveau = 'plan')
    OR (modele = 'dossier_bancaire' AND plan_id IS NOT NULL AND notation_id IS NULL
      AND version_source IS NOT NULL AND niveau = 'plan'));

-- Reprend 0131 à l'identique et ajoute la règle du dossier bancaire.
CREATE OR REPLACE FUNCTION controler_source_rapport() RETURNS trigger
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
    IF NEW.modele = 'dossier_bancaire' AND NOT EXISTS (
      SELECT 1 FROM plan_modele_versions v
      JOIN plan_modele_validations x ON x.modele_version_id = v.id
      WHERE v.plan_id = NEW.plan_id AND v.version = NEW.version_source
    ) THEN
      RAISE EXCEPTION 'Le dossier bancaire exige une version validée du modèle financier.'
        USING ERRCODE = 'MPR03';
    END IF;
    RETURN NEW;
  END $$;
