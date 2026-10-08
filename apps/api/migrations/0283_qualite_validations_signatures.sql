-- Validations par étape de garde (QUA-01, QUA-04) et signature du livrable (QUA-06).
--
-- - `qualite_validations` : une ligne par étape franchie (acteur, date, commentaire), en ajout
--   seul, une seule fois par étape et par suivi. La séparation des tâches (auteur, cumuls,
--   quatre yeux) n'est PAS recodée ici : le code appelle le moteur `evaluerGarde` avant
--   d'insérer. La base garantit seulement la forme : suivi en revue (ou validé pour la
--   signature), jamais sur un livrable signé (MPY05).
-- - `qualite_signatures` : une signature par suivi (signataire, qualité, version, empreinte
--   SHA-256, portée de l'empreinte, mention de contribution IA selon la politique du cabinet),
--   en ajout seul. Le suivi doit être validé et la version signée est celle du suivi (MPY06).

CREATE TABLE qualite_validations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  suivi_id uuid NOT NULL,
  etape text NOT NULL CHECK (etape IN ('validation_auteur', 'validation_consultant',
    'relecture_chef_mission', 'revue_second_expert', 'signature_directeur_mission')),
  acteur_id uuid NOT NULL,
  commentaire text CHECK (commentaire IS NULL OR length(btrim(commentaire)) BETWEEN 1 AND 2000),
  valide_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (suivi_id, etape),
  FOREIGN KEY (cabinet_id, suivi_id) REFERENCES qualite_suivis (cabinet_id, id),
  FOREIGN KEY (cabinet_id, acteur_id) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE qualite_validations ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON qualite_validations
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON qualite_validations AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON qualite_validations FROM missionpilot_app;
CREATE TRIGGER qualite_validations_ajout_seul BEFORE UPDATE OR DELETE ON qualite_validations
  FOR EACH ROW EXECUTE FUNCTION qualite_ajout_seul();

CREATE FUNCTION controler_qualite_validation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    statut_suivi text;
  BEGIN
    SELECT s.statut INTO statut_suivi FROM qualite_suivis s WHERE s.id = NEW.suivi_id;
    IF statut_suivi = 'signe'
       OR (NEW.etape = 'signature_directeur_mission' AND statut_suivi <> 'valide')
       OR (NEW.etape <> 'signature_directeur_mission' AND statut_suivi <> 'en_revue') THEN
      RAISE EXCEPTION 'Étape de garde impossible dans l''état actuel du suivi qualité.'
        USING ERRCODE = 'MPY05';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER qualite_validations_controle BEFORE INSERT ON qualite_validations
  FOR EACH ROW EXECUTE FUNCTION controler_qualite_validation();

CREATE TABLE qualite_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  suivi_id uuid NOT NULL,
  signataire_id uuid NOT NULL,
  -- Qualité sous laquelle la personne signe (ex. « directeur_mission », « associe »).
  qualite text NOT NULL CHECK (qualite ~ '^[a-z_]{1,40}$'),
  version integer NOT NULL CHECK (version >= 1),
  empreinte_sha256 text NOT NULL CHECK (empreinte_sha256 ~ '^[0-9a-f]{64}$'),
  -- « contenu » : empreinte du contenu du livrable ; « dossier_qualite » : à défaut, empreinte
  -- du dossier de revue seul (le type de livrable n'expose pas son contenu au module qualité).
  portee_empreinte text NOT NULL CHECK (portee_empreinte IN ('contenu', 'dossier_qualite')),
  -- Mention de contribution de l'IA imprimée selon la politique du cabinet ; NULL : politique désactivée.
  mention_ia text CHECK (mention_ia IS NULL OR length(btrim(mention_ia)) BETWEEN 1 AND 1000),
  signe_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (suivi_id),
  FOREIGN KEY (cabinet_id, suivi_id) REFERENCES qualite_suivis (cabinet_id, id),
  FOREIGN KEY (cabinet_id, signataire_id) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE qualite_signatures ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON qualite_signatures
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON qualite_signatures AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON qualite_signatures FROM missionpilot_app;
CREATE TRIGGER qualite_signatures_ajout_seul BEFORE UPDATE OR DELETE ON qualite_signatures
  FOR EACH ROW EXECUTE FUNCTION qualite_ajout_seul();

CREATE FUNCTION controler_qualite_signature() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM qualite_suivis s
                   WHERE s.id = NEW.suivi_id AND s.statut = 'valide' AND s.version = NEW.version) THEN
      RAISE EXCEPTION 'Signature impossible : suivi non validé ou version différente.'
        USING ERRCODE = 'MPY06';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER qualite_signatures_controle BEFORE INSERT ON qualite_signatures
  FOR EACH ROW EXECUTE FUNCTION controler_qualite_signature();
