-- Note au comité (DD-13) : nouveau modèle du moteur de rapports (SOC-07), enregistré comme les
-- autres dans `rapports_mission` (ajout seul, 0130).
--
-- `note_comite` : rendu d'une version VALIDÉE d'une note (`dd_notes`, 0507), en variante
-- « executive » ou « detaillee », depuis la MÊME `base_figee` (apps/api/src/rapports/note-comite.ts,
-- aucun calcul) ; niveau « dd » (lecture : « dd.lire »). Source : `dd_note_id`, `version_source`
-- (numéro de la version de la note) et `variante`, contrôlées par le déclencheur : la note est
-- celle d'un dossier de la MÊME mission que le rapport (MPR01), la version est validée (MPR04,
-- nouveau code : seule une version validée de la note se rend en rapport).
--
-- Les contraintes de modèle, de niveau et de source sont RÉÉCRITES en entier (une contrainte CHECK
-- ne s'étend pas) en reprenant, SANS EN RETIRER AUCUNE, les valeurs de 0424 (modèles
-- `etat_avancement`, `notation`, `plan_strategique`, `dossier_bancaire` ; niveaux `base`, `jours`,
-- `finance`, `notation`, `plan`). Un lot qui ajoute ensuite un autre modèle de rapport reprend la
-- réunion des valeurs en vigueur dans l'état le plus récent des migrations (numéro plus grand que
-- celui-ci), SPEC-3b §17. Aucune colonne vers `fichiers` : `fichier_orphelin` est inchangée.

ALTER TABLE rapports_mission
  ADD COLUMN dd_note_id uuid,
  ADD COLUMN variante text CHECK (variante IS NULL OR variante IN ('executive', 'detaillee')),
  ADD CONSTRAINT rapports_mission_dd_note_fk
    FOREIGN KEY (cabinet_id, dd_note_id) REFERENCES dd_notes (cabinet_id, id),
  DROP CONSTRAINT rapports_mission_modele_check,
  ADD CONSTRAINT rapports_mission_modele_check
    CHECK (modele IN ('etat_avancement', 'notation', 'plan_strategique', 'dossier_bancaire',
                      'note_comite')),
  DROP CONSTRAINT rapports_mission_niveau_check,
  ADD CONSTRAINT rapports_mission_niveau_check
    CHECK (niveau IN ('base', 'jours', 'finance', 'notation', 'plan', 'dd')),
  DROP CONSTRAINT rapports_mission_source_check,
  ADD CONSTRAINT rapports_mission_source_check CHECK (
    (modele = 'etat_avancement' AND notation_id IS NULL AND plan_id IS NULL
      AND version_source IS NULL AND niveau IN ('base', 'jours', 'finance')
      AND dd_note_id IS NULL AND variante IS NULL)
    OR (modele = 'notation' AND notation_id IS NOT NULL AND plan_id IS NULL
      AND version_source IS NOT NULL AND niveau = 'notation'
      AND dd_note_id IS NULL AND variante IS NULL)
    OR (modele = 'plan_strategique' AND plan_id IS NOT NULL AND notation_id IS NULL
      AND niveau = 'plan' AND dd_note_id IS NULL AND variante IS NULL)
    OR (modele = 'dossier_bancaire' AND plan_id IS NOT NULL AND notation_id IS NULL
      AND version_source IS NOT NULL AND niveau = 'plan'
      AND dd_note_id IS NULL AND variante IS NULL)
    OR (modele = 'note_comite' AND dd_note_id IS NOT NULL AND version_source IS NOT NULL
      AND variante IS NOT NULL AND notation_id IS NULL AND plan_id IS NULL AND niveau = 'dd'));

-- Liste des rapports d'une note (routes/rapports.ts), plus récent d'abord.
CREATE INDEX rapports_mission_dd_note_idx ON rapports_mission (cabinet_id, dd_note_id, genere_le)
  WHERE dd_note_id IS NOT NULL;

-- Reprend 0424 à l'identique et ajoute (a) la note du rapport appartient à la mission du rapport
-- (MPR01) et (b) seule une version VALIDÉE de la note se rend en rapport (MPR04). Fonction
-- d'invocateur : la RLS s'applique, une source d'un autre cabinet est donc refusée.
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
    IF NEW.dd_note_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM dd_notes n JOIN dd_dossiers d ON d.id = n.dossier_id
      WHERE n.id = NEW.dd_note_id AND d.mission_id = NEW.mission_id
    ) THEN
      RAISE EXCEPTION 'La note du rapport n''appartient pas à sa mission.' USING ERRCODE = 'MPR01';
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
    IF NEW.modele = 'note_comite' AND NOT EXISTS (
      SELECT 1 FROM dd_note_versions v
      JOIN dd_note_validations x ON x.note_version_id = v.id AND x.decision = 'valide'
      WHERE v.note_id = NEW.dd_note_id AND v.version = NEW.version_source
    ) THEN
      RAISE EXCEPTION 'Seule une version validée de la note se rend en rapport.'
        USING ERRCODE = 'MPR04';
    END IF;
    RETURN NEW;
  END $$;
