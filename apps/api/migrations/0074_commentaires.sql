-- Commentaires contextuels (SOC-08), rattachés à UNE entité d'une liste
-- blanche : mission, tâche de mission, facture, débours, opportunité,
-- proposition. L'entité est désignée par (entite_type, entite_id) et
-- recopiée dans la colonne de clé étrangère de son type (FK composites par
-- cabinet) ; la visibilité de l'entité est contrôlée par l'API à chaque
-- lecture et écriture.
--
-- Texte brut (jamais interprété comme HTML) ; ajout seul : une modification
-- (par l'auteur, dans les 15 minutes) est une révision, une suppression
-- (auteur ou associé) est un marquage. Le rôle applicatif ne modifie ni ne
-- supprime aucune ligne. La disparition de l'entité (débours ou facture en
-- brouillon supprimés, tâche retirée du découpage) emporte ses commentaires
-- par la clé étrangère.

CREATE TABLE commentaires (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  entite_type text NOT NULL CHECK (entite_type IN
    ('mission', 'mission_tache', 'facture', 'debours', 'opportunite', 'proposition')),
  entite_id uuid NOT NULL,
  mission_id uuid,
  tache_id uuid,
  facture_id uuid,
  debours_id uuid,
  opportunite_id uuid,
  proposition_id uuid,
  auteur_id uuid NOT NULL,
  texte text NOT NULL CHECK (length(btrim(texte)) >= 1 AND length(texte) <= 5000),
  mentions uuid[] NOT NULL DEFAULT '{}' CHECK (cardinality(mentions) <= 20),
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  CHECK (CASE entite_type
    WHEN 'mission' THEN entite_id = mission_id
      AND num_nonnulls(tache_id, facture_id, debours_id, opportunite_id, proposition_id) = 0
    WHEN 'mission_tache' THEN entite_id = tache_id AND mission_id IS NOT NULL
      AND num_nonnulls(facture_id, debours_id, opportunite_id, proposition_id) = 0
    WHEN 'facture' THEN entite_id = facture_id AND mission_id IS NOT NULL
      AND num_nonnulls(tache_id, debours_id, opportunite_id, proposition_id) = 0
    WHEN 'debours' THEN entite_id = debours_id AND mission_id IS NOT NULL
      AND num_nonnulls(tache_id, facture_id, opportunite_id, proposition_id) = 0
    WHEN 'opportunite' THEN entite_id = opportunite_id
      AND num_nonnulls(mission_id, tache_id, facture_id, debours_id, proposition_id) = 0
    WHEN 'proposition' THEN entite_id = proposition_id
      AND num_nonnulls(mission_id, tache_id, facture_id, debours_id, opportunite_id) = 0
  END),
  FOREIGN KEY (cabinet_id, auteur_id) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, mission_id) REFERENCES missions (cabinet_id, id) ON DELETE CASCADE,
  FOREIGN KEY (cabinet_id, mission_id, tache_id)
    REFERENCES mission_taches (cabinet_id, mission_id, id) ON DELETE CASCADE,
  FOREIGN KEY (cabinet_id, facture_id) REFERENCES factures (cabinet_id, id) ON DELETE CASCADE,
  FOREIGN KEY (cabinet_id, mission_id, debours_id)
    REFERENCES debours (cabinet_id, mission_id, id) ON DELETE CASCADE,
  FOREIGN KEY (cabinet_id, opportunite_id) REFERENCES opportunites (cabinet_id, id) ON DELETE CASCADE,
  FOREIGN KEY (cabinet_id, proposition_id) REFERENCES propositions (cabinet_id, id) ON DELETE CASCADE
);
CREATE INDEX commentaires_entite_idx ON commentaires (cabinet_id, entite_type, entite_id, cree_le, id);
ALTER TABLE commentaires ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON commentaires
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE UPDATE, DELETE ON commentaires FROM missionpilot_app;

-- Révisions : texte courant = dernière révision (sinon le texte initial).
CREATE TABLE commentaire_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  commentaire_id uuid NOT NULL,
  texte text NOT NULL CHECK (length(btrim(texte)) >= 1 AND length(texte) <= 5000),
  cree_le timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (cabinet_id, commentaire_id) REFERENCES commentaires (cabinet_id, id) ON DELETE CASCADE
);
CREATE INDEX commentaire_revisions_idx ON commentaire_revisions (commentaire_id, cree_le, id);
ALTER TABLE commentaire_revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON commentaire_revisions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE UPDATE, DELETE ON commentaire_revisions FROM missionpilot_app;

CREATE TABLE commentaire_suppressions (
  commentaire_id uuid PRIMARY KEY,
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  supprime_par uuid NOT NULL,
  supprime_le timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (cabinet_id, commentaire_id) REFERENCES commentaires (cabinet_id, id) ON DELETE CASCADE,
  FOREIGN KEY (cabinet_id, supprime_par) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE commentaire_suppressions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON commentaire_suppressions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE UPDATE, DELETE ON commentaire_suppressions FROM missionpilot_app;

-- Fenêtre de modification (15 minutes après la création) et commentaire non
-- supprimé : contrôlés aussi en base (défense en profondeur).
CREATE FUNCTION controler_revision_commentaire() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM commentaires c WHERE c.id = NEW.commentaire_id
                   AND c.cree_le >= now() - interval '15 minutes') THEN
      RAISE EXCEPTION 'Délai de modification dépassé.' USING ERRCODE = 'MPC01';
    END IF;
    IF EXISTS (SELECT 1 FROM commentaire_suppressions s WHERE s.commentaire_id = NEW.commentaire_id) THEN
      RAISE EXCEPTION 'Commentaire supprimé.' USING ERRCODE = 'MPC01';
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER commentaire_revisions_controle BEFORE INSERT ON commentaire_revisions
  FOR EACH ROW EXECUTE FUNCTION controler_revision_commentaire();
