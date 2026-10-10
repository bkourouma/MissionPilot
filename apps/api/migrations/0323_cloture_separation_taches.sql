-- Check-list de clôture : séparation des tâches entre la dérogation et la clôture (AUT-08).
--
-- Celui qui a accordé une dérogation EN VIGUEUR (dernière ligne « accordée » d'un contrôle de la
-- mission, 0322) ne clôt pas la mission, sauf s'il est associé : sans cette règle, un directeur de
-- mission déroge à un item bloquant puis clôt seul. Le contrôle de l'API (`exigerClotureAutorisee`)
-- et ce déclencheur disent la même règle. Le déclencheur est d'appelant (droits du rôle
-- applicatif, RLS du cabinet) ; il ne s'applique qu'au passage à « cloturee » d'une mission qui
-- ne l'était pas.
-- Code SQLSTATE : MPX03 clôture par l'auteur d'une dérogation en vigueur.

CREATE FUNCTION controler_cloture_separation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NEW.statut = 'cloturee' AND OLD.statut IS DISTINCT FROM 'cloturee'
       AND NEW.cloturee_par IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM (
           SELECT DISTINCT ON (d.controle) d.action, d.par FROM cloture_derogations d
           WHERE d.mission_id = NEW.id ORDER BY d.controle, d.le DESC, d.id DESC
         ) l WHERE l.action = 'accordee' AND l.par = NEW.cloturee_par)
       AND NOT EXISTS (SELECT 1 FROM utilisateurs u
                       WHERE u.id = NEW.cloturee_par AND u.roles && ARRAY['associe']::text[]) THEN
      RAISE EXCEPTION 'Séparation des tâches : l''auteur d''une dérogation ne clôt pas la mission.'
        USING ERRCODE = 'MPX03';
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER missions_cloture_separation BEFORE UPDATE OF statut ON missions
  FOR EACH ROW EXECUTE FUNCTION controler_cloture_separation();
