-- Documents de mission reliés au stockage (SOC-05) et statut des contenus
-- (SOC-06). Compatibilité ascendante : `chemin_stockage` reste lisible et
-- accepté ; `fichier_id` (facultatif) désigne un fichier téléversé, rattaché
-- à UNE seule version de document.
--
-- Statut du contenu (mécanique des livrables générés par l'IA, V2 ; aucun
-- appel IA ici) : NULL = document déposé hors circuit IA ; sinon
-- brouillon_ia → modifie (une ou plusieurs fois) → valide (définitif).
-- Le valideur n'est ni l'auteur ni le dernier modificateur, sauf associé.
-- Seule la version courante d'un document change de statut. L'historique des
-- statuts est écrit par déclencheur, en ajout seul.

ALTER TABLE mission_documents
  ADD COLUMN fichier_id uuid,
  ADD COLUMN statut_contenu text CHECK (statut_contenu IN ('brouillon_ia', 'modifie', 'valide')),
  ADD COLUMN contenu_modifie_par uuid,
  ADD COLUMN valide_par uuid,
  ADD COLUMN valide_le timestamptz,
  ADD CONSTRAINT mission_documents_cabinet_id_uniq UNIQUE (cabinet_id, id),
  ADD CONSTRAINT mission_documents_fichier_fk
    FOREIGN KEY (cabinet_id, fichier_id) REFERENCES fichiers (cabinet_id, id),
  ADD CONSTRAINT mission_documents_modifie_par_fk
    FOREIGN KEY (cabinet_id, contenu_modifie_par) REFERENCES utilisateurs (cabinet_id, id),
  ADD CONSTRAINT mission_documents_valide_par_fk
    FOREIGN KEY (cabinet_id, valide_par) REFERENCES utilisateurs (cabinet_id, id),
  ADD CONSTRAINT mission_documents_fichier_ou_chemin
    CHECK (fichier_id IS NULL OR chemin_stockage IS NULL),
  ADD CONSTRAINT mission_documents_validation_complete
    CHECK (CASE WHEN statut_contenu = 'valide' THEN valide_par IS NOT NULL AND valide_le IS NOT NULL
                ELSE valide_par IS NULL AND valide_le IS NULL END),
  ADD CONSTRAINT mission_documents_modification_ia
    CHECK (statut_contenu IS NOT NULL OR contenu_modifie_par IS NULL);
CREATE UNIQUE INDEX mission_documents_fichier_uniq ON mission_documents (fichier_id)
  WHERE fichier_id IS NOT NULL;

-- Seules les colonnes du statut se modifient (déclencheur ci-dessous).
GRANT UPDATE (statut_contenu, contenu_modifie_par, valide_par, valide_le)
  ON mission_documents TO missionpilot_app;

CREATE TABLE mission_document_statuts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  document_id uuid NOT NULL,
  statut text NOT NULL CHECK (statut IN ('brouillon_ia', 'modifie', 'valide')),
  par uuid,
  cree_le timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (cabinet_id, document_id) REFERENCES mission_documents (cabinet_id, id),
  FOREIGN KEY (cabinet_id, par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX mission_document_statuts_idx ON mission_document_statuts (document_id, cree_le, id);
ALTER TABLE mission_document_statuts ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON mission_document_statuts
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE UPDATE, DELETE ON mission_document_statuts FROM missionpilot_app;

CREATE FUNCTION controler_statut_document() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NEW.statut_contenu IS NOT DISTINCT FROM OLD.statut_contenu
       AND NEW.contenu_modifie_par IS NOT DISTINCT FROM OLD.contenu_modifie_par
       AND NEW.valide_par IS NOT DISTINCT FROM OLD.valide_par
       AND NEW.valide_le IS NOT DISTINCT FROM OLD.valide_le THEN
      RETURN NEW;
    END IF;
    IF OLD.statut_contenu IS NULL THEN
      RAISE EXCEPTION 'Document hors circuit de validation.' USING ERRCODE = 'MPD01';
    END IF;
    IF OLD.statut_contenu = 'valide' THEN
      RAISE EXCEPTION 'Contenu validé : définitif.' USING ERRCODE = 'MPD01';
    END IF;
    IF EXISTS (SELECT 1 FROM mission_documents x WHERE x.mission_id = OLD.mission_id
               AND x.type = OLD.type AND x.nom = OLD.nom AND x.version > OLD.version) THEN
      RAISE EXCEPTION 'Seule la version courante change de statut.' USING ERRCODE = 'MPD01';
    END IF;
    IF NEW.statut_contenu = 'modifie' THEN
      IF NEW.contenu_modifie_par IS NULL OR NEW.valide_par IS NOT NULL THEN
        RAISE EXCEPTION 'Modification incomplète.' USING ERRCODE = 'MPD01';
      END IF;
    ELSIF NEW.statut_contenu = 'valide' THEN
      IF NEW.valide_par IS NULL OR NEW.contenu_modifie_par IS DISTINCT FROM OLD.contenu_modifie_par THEN
        RAISE EXCEPTION 'Validation incomplète.' USING ERRCODE = 'MPD01';
      END IF;
      -- Séparation des tâches : ni l'auteur ni le dernier modificateur, sauf associé.
      IF (NEW.valide_par = OLD.auteur_id OR NEW.valide_par = OLD.contenu_modifie_par)
         AND NOT EXISTS (SELECT 1 FROM utilisateurs u WHERE u.id = NEW.valide_par
                         AND 'associe' = ANY (u.roles)) THEN
        RAISE EXCEPTION 'Le valideur ne peut être l''auteur du contenu.' USING ERRCODE = 'MPD01';
      END IF;
    ELSE
      RAISE EXCEPTION 'Transition de statut refusée.' USING ERRCODE = 'MPD01';
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER mission_documents_statut BEFORE UPDATE ON mission_documents
  FOR EACH ROW EXECUTE FUNCTION controler_statut_document();

CREATE FUNCTION historiser_statut_document() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NEW.statut_contenu IS NOT NULL AND (TG_OP = 'INSERT'
       OR NEW.statut_contenu IS DISTINCT FROM OLD.statut_contenu
       OR NEW.contenu_modifie_par IS DISTINCT FROM OLD.contenu_modifie_par) THEN
      INSERT INTO mission_document_statuts (cabinet_id, document_id, statut, par)
      VALUES (NEW.cabinet_id, NEW.id, NEW.statut_contenu, CASE NEW.statut_contenu
        WHEN 'brouillon_ia' THEN NEW.auteur_id
        WHEN 'modifie' THEN NEW.contenu_modifie_par
        ELSE NEW.valide_par END);
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER mission_documents_historique AFTER INSERT OR UPDATE ON mission_documents
  FOR EACH ROW EXECUTE FUNCTION historiser_statut_document();
