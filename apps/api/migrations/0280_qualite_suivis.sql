-- Qualité et responsabilité professionnelle (lot QUA, vague 1 : QUA-01, QUA-04).
--
-- Suivi qualité d'un LIVRABLE générique (rapport, notation, plan, questionnaire, état…) :
-- la classe de risque R0 à R3 (moteur `packages/engines/src/qualite`), la version du contenu en
-- revue et un statut qui ne va que vers l'avant : brouillon → en revue → validé → signé.
--
-- Le livrable est désigné par (type, identifiant) SANS clé étrangère : la table du livrable
-- dépend du type (le module concerné y branche ses objets) ; l'API vérifie l'existence et
-- l'appartenance à la mission à l'ouverture. Un suivi est lié à UNE version du contenu : un
-- nouveau contenu ouvre un nouveau suivi (version suivante), jamais une réouverture.
--
-- Garanties tenues en base, même si le code est contourné (MPY02) :
-- - la classe se RELÈVE, ne s'abaisse jamais, et jamais sous la classe minimale du type de
--   livrable (`classe_minimale`, fixée à l'ouverture) ;
-- - le statut ne recule pas ; un suivi signé est figé ;
-- - rien d'autre que classe, statut et date de modification ne change ; aucune suppression.
-- Lettre de domaine des codes SQLSTATE : `Y` (MPY01 à MPY07).
--
-- Les historiques du lot (événements, validations, signatures, vérifications, vus, définitions,
-- acceptations, satisfactions) sont en AJOUT SEUL (MPY01). Tables internes : invisibles du
-- portail (`portail_interdit`).

CREATE FUNCTION rang_classe_risque(p text) RETURNS integer
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT CASE p WHEN 'R0' THEN 0 WHEN 'R1' THEN 1 WHEN 'R2' THEN 2 WHEN 'R3' THEN 3 END $$;

-- Ajout seul, même pour le propriétaire (historiques du lot qualité).
CREATE FUNCTION qualite_ajout_seul() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    RAISE EXCEPTION 'Historique qualité en ajout seul : ajouter une nouvelle ligne.'
      USING ERRCODE = 'MPY01';
  END $$;

CREATE TABLE qualite_suivis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  mission_id uuid NOT NULL,
  type_livrable text NOT NULL CHECK (type_livrable IN
    ('rapport', 'notation', 'plan', 'questionnaire', 'etat', 'autre')),
  livrable_id uuid NOT NULL,
  libelle text NOT NULL CHECK (length(btrim(libelle)) BETWEEN 1 AND 200 AND libelle !~ '[[:cntrl:]]'),
  version integer NOT NULL DEFAULT 1 CHECK (version BETWEEN 1 AND 100000),
  classe_minimale text NOT NULL CHECK (classe_minimale IN ('R0', 'R1', 'R2', 'R3')),
  classe text NOT NULL CHECK (classe IN ('R0', 'R1', 'R2', 'R3')),
  statut text NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon', 'en_revue', 'valide', 'signe')),
  -- Auteur humain du contenu ; NULL : produit par un agent (ou auteur inconnu du module).
  auteur_id uuid,
  -- Définition de terminé appliquée (version au moment de l'ouverture) ; NULL : aucune pour ce type.
  definition_id uuid,
  ouvert_par uuid NOT NULL,
  ouvert_le timestamptz NOT NULL DEFAULT now(),
  modifie_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, mission_id, id),
  CONSTRAINT qualite_suivis_version_unique UNIQUE (cabinet_id, type_livrable, livrable_id, version),
  CHECK (rang_classe_risque(classe) >= rang_classe_risque(classe_minimale)),
  FOREIGN KEY (cabinet_id, mission_id) REFERENCES missions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, auteur_id) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, ouvert_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX qualite_suivis_mission_idx ON qualite_suivis (cabinet_id, mission_id, ouvert_le DESC, id);
CREATE INDEX qualite_suivis_statut_idx ON qualite_suivis (cabinet_id, statut, ouvert_le DESC, id);
ALTER TABLE qualite_suivis ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON qualite_suivis
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON qualite_suivis AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON qualite_suivis FROM missionpilot_app;
GRANT UPDATE (classe, statut, modifie_le) ON qualite_suivis TO missionpilot_app;

CREATE FUNCTION controler_qualite_suivi() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    rang_ancien integer;
    rang_nouveau integer;
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Un suivi qualité ne se supprime pas.' USING ERRCODE = 'MPY02';
    END IF;
    IF NEW.cabinet_id IS DISTINCT FROM OLD.cabinet_id OR NEW.mission_id IS DISTINCT FROM OLD.mission_id
       OR NEW.type_livrable IS DISTINCT FROM OLD.type_livrable
       OR NEW.livrable_id IS DISTINCT FROM OLD.livrable_id OR NEW.libelle IS DISTINCT FROM OLD.libelle
       OR NEW.version IS DISTINCT FROM OLD.version
       OR NEW.classe_minimale IS DISTINCT FROM OLD.classe_minimale
       OR NEW.auteur_id IS DISTINCT FROM OLD.auteur_id
       OR NEW.definition_id IS DISTINCT FROM OLD.definition_id
       OR NEW.ouvert_par IS DISTINCT FROM OLD.ouvert_par OR NEW.ouvert_le IS DISTINCT FROM OLD.ouvert_le THEN
      RAISE EXCEPTION 'Seuls la classe et le statut d''un suivi qualité évoluent.' USING ERRCODE = 'MPY02';
    END IF;
    IF OLD.statut = 'signe' THEN
      RAISE EXCEPTION 'Un livrable signé est figé.' USING ERRCODE = 'MPY02';
    END IF;
    IF rang_classe_risque(NEW.classe) < rang_classe_risque(OLD.classe) THEN
      RAISE EXCEPTION 'La classe de risque se relève, elle ne s''abaisse jamais.' USING ERRCODE = 'MPY02';
    END IF;
    IF NEW.classe <> OLD.classe AND OLD.statut NOT IN ('brouillon', 'en_revue') THEN
      RAISE EXCEPTION 'La classe ne change plus une fois le livrable validé.' USING ERRCODE = 'MPY02';
    END IF;
    rang_ancien := CASE OLD.statut WHEN 'brouillon' THEN 0 WHEN 'en_revue' THEN 1 WHEN 'valide' THEN 2 ELSE 3 END;
    rang_nouveau := CASE NEW.statut WHEN 'brouillon' THEN 0 WHEN 'en_revue' THEN 1 WHEN 'valide' THEN 2 ELSE 3 END;
    IF rang_nouveau < rang_ancien THEN
      RAISE EXCEPTION 'Le statut d''un suivi qualité ne recule pas.' USING ERRCODE = 'MPY02';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER qualite_suivis_controle BEFORE UPDATE OR DELETE ON qualite_suivis
  FOR EACH ROW EXECUTE FUNCTION controler_qualite_suivi();

-- Historique du suivi (ouverture, relèvement de classe, passages de statut) : ajout seul.
CREATE TABLE qualite_evenements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  suivi_id uuid NOT NULL,
  rang integer NOT NULL CHECK (rang >= 1),
  action text NOT NULL CHECK (action IN
    ('ouverture', 'relevement_classe', 'passage_en_revue', 'validation_complete', 'signature')),
  details jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(details) = 'object'),
  par uuid NOT NULL,
  le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (suivi_id, rang),
  FOREIGN KEY (cabinet_id, suivi_id) REFERENCES qualite_suivis (cabinet_id, id),
  FOREIGN KEY (cabinet_id, par) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE qualite_evenements ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON qualite_evenements
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON qualite_evenements AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON qualite_evenements FROM missionpilot_app;
CREATE TRIGGER qualite_evenements_ajout_seul BEFORE UPDATE OR DELETE ON qualite_evenements
  FOR EACH ROW EXECUTE FUNCTION qualite_ajout_seul();
