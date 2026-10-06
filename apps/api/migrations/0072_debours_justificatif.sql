-- Justificatif des débours par téléversement (FIN-05). Remplace la dette du
-- « chemin libre » (constat F5) : la colonne `justificatif` (chemin texte)
-- reste lisible pour les anciens débours, mais l'API n'en accepte plus de
-- nouvelle valeur ; le justificatif est désormais un fichier du stockage
-- (`justificatif_fichier_id`), rattaché à un seul débours.
-- Un débours soumis ou validé a son justificatif figé (déclencheur repris).

ALTER TABLE debours
  ADD COLUMN justificatif_fichier_id uuid,
  ADD CONSTRAINT debours_justificatif_fichier_fk
    FOREIGN KEY (cabinet_id, justificatif_fichier_id) REFERENCES fichiers (cabinet_id, id);
CREATE UNIQUE INDEX debours_justificatif_fichier_uniq ON debours (justificatif_fichier_id)
  WHERE justificatif_fichier_id IS NOT NULL;

CREATE OR REPLACE FUNCTION controler_debours() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      IF OLD.statut NOT IN ('brouillon', 'rejete') THEN
        RAISE EXCEPTION 'Débours soumis ou validé : suppression refusée.' USING ERRCODE = 'MPB02';
      END IF;
      RETURN OLD;
    END IF;
    IF OLD.statut = 'valide' THEN
      RAISE EXCEPTION 'Débours validé : immuable.' USING ERRCODE = 'MPB02';
    END IF;
    IF (NEW.cabinet_id, NEW.mission_id, NEW.collaborateur_id, NEW.auteur_id, NEW.cree_le)
       IS DISTINCT FROM (OLD.cabinet_id, OLD.mission_id, OLD.collaborateur_id, OLD.auteur_id, OLD.cree_le) THEN
      RAISE EXCEPTION 'Identité d''un débours figée.' USING ERRCODE = 'MPB02';
    END IF;
    IF NEW.statut IS DISTINCT FROM OLD.statut AND NOT (
         (OLD.statut IN ('brouillon', 'rejete') AND NEW.statut IN ('soumis', 'brouillon'))
      OR (OLD.statut = 'soumis' AND NEW.statut IN ('valide', 'rejete'))) THEN
      RAISE EXCEPTION 'Transition de statut de débours refusée.' USING ERRCODE = 'MPB02';
    END IF;
    -- Une saisie soumise ne change que par sa décision (justificatif compris).
    IF OLD.statut = 'soumis' AND
       (NEW.date, NEW.categorie, NEW.libelle, NEW.montant, NEW.devise, NEW.refacturable,
        NEW.justificatif, NEW.justificatif_fichier_id)
         IS DISTINCT FROM
       (OLD.date, OLD.categorie, OLD.libelle, OLD.montant, OLD.devise, OLD.refacturable,
        OLD.justificatif, OLD.justificatif_fichier_id) THEN
      RAISE EXCEPTION 'Débours soumis : contenu figé.' USING ERRCODE = 'MPB02';
    END IF;
    RETURN NEW;
  END $$;
