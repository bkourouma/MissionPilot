-- Référentiel de méthodes (lot STD) — correctif d'audit de sécurité : une dérogation ne
-- passe à `approuvee` que si les validations exigées par sa classe de risque figurent,
-- approuvées, dans `derogation_validations` (STD-07, QUA-04). Jusqu'ici la base ne
-- vérifiait que l'immuabilité : un `UPDATE statut = 'approuvee'` direct contournait la garde.
--
-- Étapes exigées (miroir de `GARDES` dans packages/engines/src/qualite/gardes.ts) :
--   R0 aucune (garde automatique, journalisée) ;
--   R1 validation_auteur ;
--   R2 validation_consultant, relecture_chef_mission ;
--   R3 R2 + revue_second_expert, signature_directeur_mission.
-- Refus : SQLSTATE MPM04 (« Décision de dérogation définitive », traduit en 409
-- DEROGATION_DECISION_REFUSEE). Fonction REMPLACÉE : le reste de 0202 est conservé.

CREATE OR REPLACE FUNCTION controler_derogation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_mission uuid;
    v_requises text[];
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Une dérogation ne se supprime pas.' USING ERRCODE = 'MPM03';
    END IF;
    IF TG_OP = 'INSERT' THEN
      SELECT mission_id INTO v_mission FROM mission_methodes WHERE id = NEW.mission_methode_id;
      IF v_mission IS DISTINCT FROM NEW.mission_id OR NEW.statut <> 'demandee' THEN
        RAISE EXCEPTION 'Dérogation incohérente avec la méthode de la mission.' USING ERRCODE = 'MPM02';
      END IF;
      RETURN NEW;
    END IF;
    IF OLD.statut <> 'demandee' OR NEW.statut = 'demandee'
       OR (NEW.cabinet_id, NEW.mission_id, NEW.mission_methode_id, NEW.brique_code, NEW.nature,
           NEW.description, NEW.motif, NEW.classe_risque, NEW.demandeur_id, NEW.cree_le)
          IS DISTINCT FROM
          (OLD.cabinet_id, OLD.mission_id, OLD.mission_methode_id, OLD.brique_code, OLD.nature,
           OLD.description, OLD.motif, OLD.classe_risque, OLD.demandeur_id, OLD.cree_le) THEN
      RAISE EXCEPTION 'Décision de dérogation définitive.' USING ERRCODE = 'MPM04';
    END IF;
    IF NEW.statut = 'approuvee' THEN
      v_requises := CASE NEW.classe_risque
        WHEN 'R0' THEN ARRAY[]::text[]
        WHEN 'R1' THEN ARRAY['validation_auteur']
        WHEN 'R2' THEN ARRAY['validation_consultant', 'relecture_chef_mission']
        ELSE ARRAY['validation_consultant', 'relecture_chef_mission', 'revue_second_expert',
                   'signature_directeur_mission']
      END;
      IF EXISTS (
        SELECT 1 FROM unnest(v_requises) AS e(etape)
         WHERE NOT EXISTS (SELECT 1 FROM derogation_validations v
                            WHERE v.derogation_id = NEW.id AND v.etape = e.etape
                              AND v.decision = 'approuve')
      ) OR EXISTS (
        SELECT 1 FROM derogation_validations v
         WHERE v.derogation_id = NEW.id AND v.decision = 'refuse'
      ) THEN
        RAISE EXCEPTION 'Approbation de dérogation : validations de la garde de classe % requises.', NEW.classe_risque
          USING ERRCODE = 'MPM04';
      END IF;
    END IF;
    RETURN NEW;
  END $$;
