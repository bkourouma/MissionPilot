-- REDÉFINITION DE `rapports_mission` À SIGNALER (table partagée du moteur de rapports, SOC-07) :
-- cette migration réécrit les contraintes `rapports_mission_modele_check`, `_niveau_check` et
-- `_source_check` et la fonction `controler_source_rapport()`. À relire à chaque fusion avec un
-- autre lot qui ajoute un modèle de rapport.
--
-- NUMÉRO : 0551 (attribué par le superviseur) et non 0491-0499. Une contrainte CHECK ne s'étend pas : elle se réécrit en entier à
-- partir de l'état le plus récent (SPEC-3b §17, 0508). Or 0508 (note au comité, colonnes
-- `dd_note_id` et `variante`) s'applique APRÈS toute migration 0487-0499 : une réécriture numérotée
-- avant elle serait écrasée par 0508 et citerait des colonnes qui n'existent pas encore. La table
-- `red_clotures` (0490) précède celle-ci ; aucune autre migration ne modifie `rapports_mission`
-- entre 0508 et 0548 (0548 ne touche que `fichiers` et lit `rapports_mission`).
--
-- Rapport de clôture du redressement (RED-08) : nouveau modèle `cloture_redressement`, enregistré
-- comme les autres dans `rapports_mission` (ajout seul, 0130). Rendu d'un bilan de clôture VALIDÉ
-- (`red_clotures`, 0490) et des causes racines validées (rapports/ cloture-rapport côté API), sans
-- aucun calcul ; niveau « red » (lecture : « redressement.lire »), confidentiel. Source :
-- `red_cloture_id` et `version_source` (numéro de la version du bilan), contrôlées par le
-- déclencheur : le bilan est celui d'un dossier de la MÊME mission que le rapport et il est VALIDÉ,
-- à la version citée (MPR05, nouveau code : source de rapport incohérente).
--
-- Les contraintes de modèle, de niveau et de source reprennent, SANS EN RETIRER AUCUNE, les valeurs
-- en vigueur après 0508 : modèles `etat_avancement`, `notation`, `plan_strategique`,
-- `dossier_bancaire`, `note_comite` ; niveaux `base`, `jours`, `finance`, `notation`, `plan`, `dd`.
-- Aucune colonne vers `fichiers` : `fichier_orphelin` est inchangée.

ALTER TABLE rapports_mission
  ADD COLUMN red_cloture_id uuid,
  ADD CONSTRAINT rapports_mission_red_cloture_fk
    FOREIGN KEY (cabinet_id, red_cloture_id) REFERENCES red_clotures (cabinet_id, id),
  DROP CONSTRAINT rapports_mission_modele_check,
  ADD CONSTRAINT rapports_mission_modele_check
    CHECK (modele IN ('etat_avancement', 'notation', 'plan_strategique', 'dossier_bancaire',
                      'note_comite', 'cloture_redressement')),
  DROP CONSTRAINT rapports_mission_niveau_check,
  ADD CONSTRAINT rapports_mission_niveau_check
    CHECK (niveau IN ('base', 'jours', 'finance', 'notation', 'plan', 'dd', 'red')),
  DROP CONSTRAINT rapports_mission_source_check,
  ADD CONSTRAINT rapports_mission_source_check CHECK (
    (modele = 'etat_avancement' AND notation_id IS NULL AND plan_id IS NULL
      AND version_source IS NULL AND niveau IN ('base', 'jours', 'finance')
      AND dd_note_id IS NULL AND variante IS NULL AND red_cloture_id IS NULL)
    OR (modele = 'notation' AND notation_id IS NOT NULL AND plan_id IS NULL
      AND version_source IS NOT NULL AND niveau = 'notation'
      AND dd_note_id IS NULL AND variante IS NULL AND red_cloture_id IS NULL)
    OR (modele = 'plan_strategique' AND plan_id IS NOT NULL AND notation_id IS NULL
      AND niveau = 'plan' AND dd_note_id IS NULL AND variante IS NULL AND red_cloture_id IS NULL)
    OR (modele = 'dossier_bancaire' AND plan_id IS NOT NULL AND notation_id IS NULL
      AND version_source IS NOT NULL AND niveau = 'plan'
      AND dd_note_id IS NULL AND variante IS NULL AND red_cloture_id IS NULL)
    OR (modele = 'note_comite' AND dd_note_id IS NOT NULL AND version_source IS NOT NULL
      AND variante IS NOT NULL AND notation_id IS NULL AND plan_id IS NULL AND niveau = 'dd'
      AND red_cloture_id IS NULL)
    OR (modele = 'cloture_redressement' AND red_cloture_id IS NOT NULL
      AND version_source IS NOT NULL AND notation_id IS NULL AND plan_id IS NULL
      AND dd_note_id IS NULL AND variante IS NULL AND niveau = 'red'));

-- Liste des rapports d'un bilan (routes/redressement-cloture.ts), plus récent d'abord.
CREATE INDEX rapports_mission_red_cloture_idx ON rapports_mission (cabinet_id, red_cloture_id, genere_le)
  WHERE red_cloture_id IS NOT NULL;

-- Reprend 0508 à l'identique et ajoute la règle du rapport de clôture : le bilan appartient à la
-- mission du rapport, il est VALIDÉ et sa version est celle citée (MPR05). Fonction d'invocateur :
-- la RLS s'applique, une source d'un autre cabinet est donc refusée.
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
    IF NEW.modele = 'cloture_redressement' AND NOT EXISTS (
      SELECT 1 FROM red_clotures c JOIN red_dossiers d ON d.id = c.dossier_id
      WHERE c.id = NEW.red_cloture_id AND d.mission_id = NEW.mission_id
        AND c.statut = 'valide' AND c.version = NEW.version_source
    ) THEN
      RAISE EXCEPTION 'Le rapport de clôture exige un bilan validé de la même mission.'
        USING ERRCODE = 'MPR05';
    END IF;
    RETURN NEW;
  END $$;
