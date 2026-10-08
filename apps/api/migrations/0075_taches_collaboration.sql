-- Tâches assignées (SOC-08) : une demande d'un utilisateur à un collègue
-- ACTIF du même cabinet, avec échéance facultative et, facultativement, une
-- entité liée (mêmes types et mêmes clés étrangères que les commentaires).
-- Distinctes des tâches du découpage de mission (mission_taches).
--
-- Jamais supprimées par le rôle applicatif. Le créateur modifie titre,
-- description, échéance, assigné et statut ; l'assigné ne change que le
-- statut (contrôle applicatif). L'identité, le créateur et l'entité liée sont
-- figés (déclencheur).

CREATE TABLE taches_collaboration (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  titre text NOT NULL CHECK (length(btrim(titre)) >= 1 AND length(titre) <= 200),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 5000),
  assignee_id uuid NOT NULL,
  cree_par uuid NOT NULL,
  echeance date CHECK (echeance IS NULL OR echeance BETWEEN '2000-01-01' AND '2100-12-31'),
  statut text NOT NULL DEFAULT 'a_faire' CHECK (statut IN ('a_faire', 'en_cours', 'fait')),
  fait_le timestamptz,
  entite_type text CHECK (entite_type IN
    ('mission', 'mission_tache', 'facture', 'debours', 'opportunite', 'proposition')),
  entite_id uuid,
  mission_id uuid,
  tache_id uuid,
  facture_id uuid,
  debours_id uuid,
  opportunite_id uuid,
  proposition_id uuid,
  cree_le timestamptz NOT NULL DEFAULT now(),
  modifie_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  CHECK ((statut = 'fait') = (fait_le IS NOT NULL)),
  CHECK (CASE
    WHEN entite_type IS NULL THEN entite_id IS NULL
      AND num_nonnulls(mission_id, tache_id, facture_id, debours_id, opportunite_id, proposition_id) = 0
    WHEN entite_type = 'mission' THEN entite_id = mission_id
      AND num_nonnulls(tache_id, facture_id, debours_id, opportunite_id, proposition_id) = 0
    WHEN entite_type = 'mission_tache' THEN entite_id = tache_id AND mission_id IS NOT NULL
      AND num_nonnulls(facture_id, debours_id, opportunite_id, proposition_id) = 0
    WHEN entite_type = 'facture' THEN entite_id = facture_id AND mission_id IS NOT NULL
      AND num_nonnulls(tache_id, debours_id, opportunite_id, proposition_id) = 0
    WHEN entite_type = 'debours' THEN entite_id = debours_id AND mission_id IS NOT NULL
      AND num_nonnulls(tache_id, facture_id, opportunite_id, proposition_id) = 0
    WHEN entite_type = 'opportunite' THEN entite_id = opportunite_id
      AND num_nonnulls(mission_id, tache_id, facture_id, debours_id, proposition_id) = 0
    ELSE entite_id = proposition_id
      AND num_nonnulls(mission_id, tache_id, facture_id, debours_id, opportunite_id) = 0
  END),
  FOREIGN KEY (cabinet_id, assignee_id) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, mission_id) REFERENCES missions (cabinet_id, id) ON DELETE CASCADE,
  FOREIGN KEY (cabinet_id, mission_id, tache_id)
    REFERENCES mission_taches (cabinet_id, mission_id, id) ON DELETE CASCADE,
  FOREIGN KEY (cabinet_id, facture_id) REFERENCES factures (cabinet_id, id) ON DELETE CASCADE,
  FOREIGN KEY (cabinet_id, mission_id, debours_id)
    REFERENCES debours (cabinet_id, mission_id, id) ON DELETE CASCADE,
  FOREIGN KEY (cabinet_id, opportunite_id) REFERENCES opportunites (cabinet_id, id) ON DELETE CASCADE,
  FOREIGN KEY (cabinet_id, proposition_id) REFERENCES propositions (cabinet_id, id) ON DELETE CASCADE
);
CREATE INDEX taches_collaboration_assignee_idx
  ON taches_collaboration (cabinet_id, assignee_id, statut, echeance);
CREATE INDEX taches_collaboration_createur_idx ON taches_collaboration (cabinet_id, cree_par, cree_le);
ALTER TABLE taches_collaboration ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON taches_collaboration
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE DELETE ON taches_collaboration FROM missionpilot_app;

CREATE FUNCTION controler_tache_collaboration() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF (NEW.cabinet_id, NEW.cree_par, NEW.cree_le, NEW.entite_type, NEW.entite_id)
       IS DISTINCT FROM (OLD.cabinet_id, OLD.cree_par, OLD.cree_le, OLD.entite_type, OLD.entite_id) THEN
      RAISE EXCEPTION 'Identité d''une tâche figée.' USING ERRCODE = 'MPT01';
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER taches_collaboration_controle BEFORE UPDATE ON taches_collaboration
  FOR EACH ROW EXECUTE FUNCTION controler_tache_collaboration();
