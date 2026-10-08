-- Extraction d'exigences (AO-03, lot AO-A) : acquittement des nombres non vérifiés.
--
-- Une extraction produite par l'IA peut citer des nombres que le garde-chiffres n'a pas pu
-- vérifier (`chiffres_non_verifies`). Comme pour l'offre technique (MPW04), elle ne se VALIDE
-- qu'une fois ces nombres relus et acquittés par un humain. Le contrôle de l'API
-- (`trancherExtraction`, 409 CHIFFRES_A_ACQUITTER) est doublé ici : SQLSTATE MPA07.
--
-- `acquitte_chiffres` s'écrit au moment où l'extraction est tranchée (comme `statut` et
-- `tranche_par`) ; les propositions restent figées (MPA01) et une extraction ne se tranche
-- qu'une fois (MPA05). Fonction redéfinie par CREATE OR REPLACE (0361 n'est pas modifiée).

ALTER TABLE ao_extractions ADD COLUMN acquitte_chiffres boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION controler_extraction_ao() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Une extraction ne se supprime pas.' USING ERRCODE = 'MPA01';
    END IF;
    IF (NEW.cabinet_id, NEW.ao_id, NEW.dossier_id, NEW.methode, NEW.ia_demande_id, NEW.gabarit,
        NEW.chiffres_non_verifies, NEW.tronque, NEW.propositions, NEW.nombre, NEW.cree_par,
        NEW.cree_le)
       IS DISTINCT FROM
       (OLD.cabinet_id, OLD.ao_id, OLD.dossier_id, OLD.methode, OLD.ia_demande_id, OLD.gabarit,
        OLD.chiffres_non_verifies, OLD.tronque, OLD.propositions, OLD.nombre, OLD.cree_par,
        OLD.cree_le) THEN
      RAISE EXCEPTION 'Les propositions d''une extraction sont figées.' USING ERRCODE = 'MPA01';
    END IF;
    IF OLD.statut <> 'brouillon' OR NEW.statut = 'brouillon' THEN
      RAISE EXCEPTION 'Cette extraction est déjà tranchée.' USING ERRCODE = 'MPA05';
    END IF;
    IF NEW.statut = 'validee' AND NEW.chiffres_non_verifies AND NOT NEW.acquitte_chiffres THEN
      RAISE EXCEPTION 'Les nombres non vérifiés de l''extraction doivent être acquittés.'
        USING ERRCODE = 'MPA07';
    END IF;
    RETURN NEW;
  END $$;
