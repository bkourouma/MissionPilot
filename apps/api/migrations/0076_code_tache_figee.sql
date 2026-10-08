-- Lève la collision de SQLSTATE `MPT01` (CODING_STANDARDS §10) : la 0030 l'emploie
-- pour les feuilles de temps figées, la 0075 pour l'identité figée d'une tâche
-- assignée. La tâche passe à `MPC02` (lettre C, collaboration : MPC01 =
-- commentaire figé, 0074). `MPT01` ne désigne plus que les feuilles de temps.
-- La 0075, commitée, n'est pas modifiée : la fonction est redéfinie ici.

CREATE OR REPLACE FUNCTION controler_tache_collaboration() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF (NEW.cabinet_id, NEW.cree_par, NEW.cree_le, NEW.entite_type, NEW.entite_id)
       IS DISTINCT FROM (OLD.cabinet_id, OLD.cree_par, OLD.cree_le, OLD.entite_type, OLD.entite_id) THEN
      RAISE EXCEPTION 'Identité d''une tâche figée.' USING ERRCODE = 'MPC02';
    END IF;
    RETURN NEW;
  END $$;
