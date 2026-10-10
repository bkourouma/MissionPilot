-- Offre technique (AO-06, lot AO-B) : séparation des tâches à la validation (MPW05).
--
-- Règle du dépôt (SECURITY.md §5, contenu IA) : le valideur n'est ni le demandeur ni l'auteur
-- d'AUCUNE version, sauf associé. Pour une offre : ni le créateur de l'offre, ni l'auteur d'une
-- version (brouillon ou modification), ni le demandeur de la génération IA d'une version.
-- Le contrôle de l'API (`validerOffreTechnique`, 403 APPROBATION_REQUISE) est doublé ici.
--
-- Fonction redéfinie par CREATE OR REPLACE (0382 n'est pas modifiée) ; le déclencheur
-- `ao_offre_technique_validations_controle` reste attaché. Modèle : `plan_valideur_dispense`
-- et MPS03 (0180).

CREATE OR REPLACE FUNCTION controler_validation_offre_ao() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v ao_offre_technique_versions%ROWTYPE;
  BEGIN
    SELECT * INTO v FROM ao_offre_technique_versions WHERE id = NEW.version_id;
    IF v.offre_id IS DISTINCT FROM NEW.offre_id OR v.version <> (
         SELECT max(x.version) FROM ao_offre_technique_versions x WHERE x.offre_id = NEW.offre_id) THEN
      RAISE EXCEPTION 'Seule la dernière version d''une offre se valide.' USING ERRCODE = 'MPW03';
    END IF;
    IF v.chiffres_non_verifies AND NOT NEW.acquitte_chiffres THEN
      RAISE EXCEPTION 'Les nombres non vérifiés du brouillon IA doivent être acquittés.'
        USING ERRCODE = 'MPW04';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM utilisateurs u
                   WHERE u.id = NEW.valide_par AND 'associe' = ANY (u.roles))
       AND (EXISTS (SELECT 1 FROM ao_offres_techniques o
                    WHERE o.id = NEW.offre_id AND o.cree_par = NEW.valide_par)
            OR EXISTS (SELECT 1 FROM ao_offre_technique_versions x
                       WHERE x.offre_id = NEW.offre_id AND x.cree_par = NEW.valide_par)
            OR EXISTS (SELECT 1 FROM ao_offre_technique_versions x
                       JOIN ia_demandes d ON d.id = x.demande_ia_id
                       WHERE x.offre_id = NEW.offre_id AND d.demandeur_id = NEW.valide_par)) THEN
      RAISE EXCEPTION 'Le demandeur ou l''auteur d''une version d''une offre ne la valide pas lui-même.'
        USING ERRCODE = 'MPW05';
    END IF;
    RETURN NEW;
  END $$;
