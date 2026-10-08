-- Durcissement de la facturation (audit du commit 6f28b95, constats F1 et F2).
--
-- Les déclencheurs de 0043 contrôlent les MISES À JOUR ; ceux-ci ferment les
-- chemins restants, pour un appelant qui écrirait directement en base avec le
-- rôle applicatif :
-- - une facture naît en brouillon, sans numéro ni approbation ni émission ;
-- - une séquence de numérotation naît à zéro (sinon des numéros seraient
--   sautés) ;
-- - une facture émise ne passe « annulée » que par un avoir ÉMIS qui la
--   désigne comme facture d'origine ;
-- - les lignes et les rattachements portent la mission de leur facture.
-- Séparation des tâches (F2) : qui a modifié un brouillon est enregistré
-- (modifie_par) et ne l'approuve pas, sauf associé (contrôle dans l'API).

ALTER TABLE factures
  ADD COLUMN modifie_par uuid[] NOT NULL DEFAULT '{}' CHECK (cardinality(modifie_par) <= 100);

CREATE FUNCTION controler_insertion_facture() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NEW.statut IS DISTINCT FROM 'brouillon' OR NEW.numero IS NOT NULL OR NEW.exercice IS NOT NULL
       OR NEW.sequence IS NOT NULL OR NEW.date_emission IS NOT NULL OR NEW.mentions IS NOT NULL
       OR NEW.role_approbateur IS NOT NULL OR NEW.soumise_par IS NOT NULL
       OR NEW.approuvee_par IS NOT NULL OR NEW.emise_par IS NOT NULL OR NEW.emise_le IS NOT NULL
       OR NEW.annulee_le IS NOT NULL OR NEW.annulee_par_avoir_id IS NOT NULL
       OR NEW.envoyee_le IS NOT NULL OR cardinality(NEW.modifie_par) <> 0 THEN
      RAISE EXCEPTION 'Une facture naît en brouillon, sans numéro.' USING ERRCODE = 'MPB01';
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER factures_insertion BEFORE INSERT ON factures
  FOR EACH ROW EXECUTE FUNCTION controler_insertion_facture();

-- Émise → annulée : seulement par l'avoir émis de CETTE facture.
CREATE FUNCTION controler_annulation_facture() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF NEW.statut = 'annulee' AND OLD.statut IS DISTINCT FROM 'annulee' AND NOT EXISTS (
         SELECT 1 FROM factures a
         WHERE a.id = NEW.annulee_par_avoir_id AND a.cabinet_id = NEW.cabinet_id
           AND a.nature = 'avoir' AND a.statut = 'emise' AND a.facture_origine_id = NEW.id) THEN
      RAISE EXCEPTION 'Facture annulée seulement par son avoir émis.' USING ERRCODE = 'MPB01';
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER factures_annulation BEFORE UPDATE ON factures
  FOR EACH ROW EXECUTE FUNCTION controler_annulation_facture();

-- Séquence : créée à zéro, puis incrémentée de un (0043).
CREATE FUNCTION controler_creation_sequence() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NEW.dernier <> 0 THEN
      RAISE EXCEPTION 'Numérotation des factures : une séquence commence à zéro.'
        USING ERRCODE = 'MPB04';
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER sequences_facturation_creation BEFORE INSERT ON sequences_facturation
  FOR EACH ROW EXECUTE FUNCTION controler_creation_sequence();

-- Lignes et rattachements : même mission que leur facture (clé composite).
ALTER TABLE factures ADD CONSTRAINT factures_cabinet_mission_id_uniq
  UNIQUE (cabinet_id, mission_id, id);
ALTER TABLE facture_lignes ADD CONSTRAINT facture_lignes_mission_facture_fk
  FOREIGN KEY (cabinet_id, mission_id, facture_id) REFERENCES factures (cabinet_id, mission_id, id)
  ON DELETE CASCADE;
ALTER TABLE facturation_liens ADD CONSTRAINT facturation_liens_mission_facture_fk
  FOREIGN KEY (cabinet_id, mission_id, facture_id) REFERENCES factures (cabinet_id, mission_id, id)
  ON DELETE CASCADE;
