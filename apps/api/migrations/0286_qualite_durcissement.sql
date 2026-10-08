-- Durcissement du lot qualité (audit de sécurité du lot QUA, 2026-10-08).
--
-- Les migrations 0280 à 0285 sont commitées : les colonnes s'AJOUTENT, les fonctions de contrôle
-- sont REMPLACÉES (CREATE OR REPLACE), les nouveaux contrôles sont de nouveaux déclencheurs.
--
-- Suivis (0280) :
-- - `empreinte_revue` : SHA-256 du contenu RELU, posé au passage en revue (une seule fois, puis
--   figé, MPY02). L'API recalcule l'empreinte avant chaque étape de garde et avant la signature et
--   refuse un livrable modifié depuis (409 LIVRABLE_MODIFIE_APRES_REVUE).
-- - L'auteur désigné d'un livrable opaque (`etat`, `autre`) est un membre actif de la mission
--   (MPY11) ; pour les autres types, l'API impose l'auteur lu dans le module.
-- Revue guidée (0282) :
-- - `source_type` d'un élément : source RÉSOLUE par le serveur (`moteur` : calcul d'un moteur,
--   `preuve` : preuve du registre de la mission). Seul le service interne la pose ; un chiffre
--   n'est « tracé » que si sa source est résolue.
-- - Événement `elements_apres_validation` : un élément obligatoire déposé après une étape de garde
--   (l'étape est à reconfirmer par son auteur, qui parcourt le nouvel élément).
-- Validations et signature (0283) : une classe R2 ou R3 exige au moins un élément obligatoire à
-- parcourir (MPY08).
-- Vérifications (0281) : l'auteur du livrable n'atteste pas un item de sa propre définition (MPY10).
-- Acceptation (0284) :
-- - une fois une décision prise (hors « en attente »), le niveau de risque retenu ne descend plus
--   sous celui de la dernière évaluation (MPY09) ;
-- - une relation entre clients ne se supprime plus : son retrait est un ÉVÉNEMENT en ajout seul
--   (`qualite_relations_retraits`) ; l'unicité ne porte que sur les relations actives (MPY07).
-- Satisfaction (0285) : `origine` de la note (`saisie_par_equipe` : saisie par le cabinet pour le
-- compte du client ; `client` : réservé à une saisie directe par le client), tracée sans changer
-- le calcul du NPS.

-- ---------------------------------------------------------------------------
-- Suivis
-- ---------------------------------------------------------------------------

ALTER TABLE qualite_suivis
  ADD COLUMN empreinte_revue text CHECK (empreinte_revue IS NULL OR empreinte_revue ~ '^[0-9a-f]{64}$');
GRANT UPDATE (empreinte_revue) ON qualite_suivis TO missionpilot_app;

CREATE OR REPLACE FUNCTION controler_qualite_suivi() RETURNS trigger
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
    IF OLD.empreinte_revue IS NOT NULL AND NEW.empreinte_revue IS DISTINCT FROM OLD.empreinte_revue THEN
      RAISE EXCEPTION 'L''empreinte du contenu relu est figée.' USING ERRCODE = 'MPY02';
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

CREATE FUNCTION controler_qualite_suivi_auteur() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NEW.auteur_id IS NOT NULL AND NEW.type_livrable IN ('etat', 'autre')
       AND NOT est_membre_actif_mission(NEW.mission_id, NEW.auteur_id) THEN
      RAISE EXCEPTION 'L''auteur désigné d''un livrable est un membre actif de la mission.'
        USING ERRCODE = 'MPY11';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER qualite_suivis_auteur BEFORE INSERT ON qualite_suivis
  FOR EACH ROW EXECUTE FUNCTION controler_qualite_suivi_auteur();

ALTER TABLE qualite_evenements DROP CONSTRAINT qualite_evenements_action_check;
ALTER TABLE qualite_evenements ADD CONSTRAINT qualite_evenements_action_check CHECK (action IN
  ('ouverture', 'relevement_classe', 'passage_en_revue', 'validation_complete', 'signature',
   'elements_apres_validation'));

-- ---------------------------------------------------------------------------
-- Revue guidée, validations, signature, vérifications
-- ---------------------------------------------------------------------------

ALTER TABLE qualite_revue_elements
  ADD COLUMN source_type text
    CHECK (source_type IS NULL OR (source_type IN ('moteur', 'preuve') AND source IS NOT NULL));

CREATE OR REPLACE FUNCTION controler_qualite_validation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_suivi record;
  BEGIN
    SELECT s.statut, s.classe INTO v_suivi FROM qualite_suivis s WHERE s.id = NEW.suivi_id;
    IF v_suivi.statut = 'signe'
       OR (NEW.etape = 'signature_directeur_mission' AND v_suivi.statut <> 'valide')
       OR (NEW.etape <> 'signature_directeur_mission' AND v_suivi.statut <> 'en_revue') THEN
      RAISE EXCEPTION 'Étape de garde impossible dans l''état actuel du suivi qualité.'
        USING ERRCODE = 'MPY05';
    END IF;
    IF v_suivi.classe IN ('R2', 'R3') AND NOT EXISTS (
         SELECT 1 FROM qualite_revue_elements e WHERE e.suivi_id = NEW.suivi_id AND e.obligatoire) THEN
      RAISE EXCEPTION 'Un livrable R2 ou R3 se valide sur un parcours de revue non vide.'
        USING ERRCODE = 'MPY08';
    END IF;
    RETURN NEW;
  END $$;

CREATE OR REPLACE FUNCTION controler_qualite_signature() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM qualite_suivis s
                   WHERE s.id = NEW.suivi_id AND s.statut = 'valide' AND s.version = NEW.version) THEN
      RAISE EXCEPTION 'Signature impossible : suivi non validé ou version différente.'
        USING ERRCODE = 'MPY06';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM qualite_revue_elements e
                   WHERE e.suivi_id = NEW.suivi_id AND e.obligatoire) THEN
      RAISE EXCEPTION 'Un livrable se signe sur un parcours de revue non vide.'
        USING ERRCODE = 'MPY08';
    END IF;
    RETURN NEW;
  END $$;

CREATE FUNCTION controler_qualite_attestation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NEW.statut = 'atteste' AND EXISTS (
         SELECT 1 FROM qualite_suivis s WHERE s.id = NEW.suivi_id AND s.auteur_id = NEW.par) THEN
      RAISE EXCEPTION 'L''auteur du livrable n''atteste pas sa propre définition de terminé.'
        USING ERRCODE = 'MPY10';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER qualite_verifications_attestation BEFORE INSERT ON qualite_verifications
  FOR EACH ROW EXECUTE FUNCTION controler_qualite_attestation();

-- ---------------------------------------------------------------------------
-- Acceptation de mission
-- ---------------------------------------------------------------------------

CREATE FUNCTION controler_qualite_acceptation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_dernier text;
    v_rangs constant text[] := ARRAY['faible', 'moyen', 'eleve'];
  BEGIN
    IF EXISTS (SELECT 1 FROM qualite_acceptations a
               WHERE a.mission_id = NEW.mission_id AND a.decision <> 'en_attente') THEN
      SELECT a.niveau_risque INTO v_dernier FROM qualite_acceptations a
        WHERE a.mission_id = NEW.mission_id ORDER BY a.rang DESC LIMIT 1;
      IF array_position(v_rangs, NEW.niveau_risque) < array_position(v_rangs, v_dernier) THEN
        RAISE EXCEPTION 'Après une décision, le niveau de risque retenu ne s''abaisse plus.'
          USING ERRCODE = 'MPY09';
      END IF;
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER qualite_acceptations_controle BEFORE INSERT ON qualite_acceptations
  FOR EACH ROW EXECUTE FUNCTION controler_qualite_acceptation();

-- Relations entre clients : plus de suppression ; un retrait est un événement en ajout seul.
REVOKE DELETE ON qualite_relations_clients FROM missionpilot_app;
CREATE TRIGGER qualite_relations_clients_ajout_seul BEFORE UPDATE OR DELETE ON qualite_relations_clients
  FOR EACH ROW EXECUTE FUNCTION qualite_ajout_seul();

CREATE TABLE qualite_relations_retraits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  relation_id uuid NOT NULL,
  retire_par uuid NOT NULL,
  retire_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (relation_id),
  FOREIGN KEY (cabinet_id, relation_id) REFERENCES qualite_relations_clients (cabinet_id, id),
  FOREIGN KEY (cabinet_id, retire_par) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE qualite_relations_retraits ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON qualite_relations_retraits
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON qualite_relations_retraits AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON qualite_relations_retraits FROM missionpilot_app;
CREATE TRIGGER qualite_relations_retraits_ajout_seul BEFORE UPDATE OR DELETE ON qualite_relations_retraits
  FOR EACH ROW EXECUTE FUNCTION qualite_ajout_seul();

-- Unicité sur les relations ACTIVES (une relation retirée se déclare de nouveau), dans les deux
-- sens ; verrou consultatif sur la paire pour sérialiser deux déclarations concurrentes.
ALTER TABLE qualite_relations_clients DROP CONSTRAINT qualite_relations_unique;
CREATE INDEX qualite_relations_clients_paire_idx
  ON qualite_relations_clients (cabinet_id, client_id, client_lie_id, nature);

CREATE OR REPLACE FUNCTION controler_qualite_relation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'qualite_relation:' || least(NEW.client_id::text, NEW.client_lie_id::text) || ':'
        || greatest(NEW.client_id::text, NEW.client_lie_id::text) || ':' || NEW.nature, 0));
    IF EXISTS (SELECT 1 FROM qualite_relations_clients r
               WHERE r.nature = NEW.nature
                 AND ((r.client_id = NEW.client_id AND r.client_lie_id = NEW.client_lie_id)
                      OR (r.client_id = NEW.client_lie_id AND r.client_lie_id = NEW.client_id))
                 AND NOT EXISTS (SELECT 1 FROM qualite_relations_retraits x WHERE x.relation_id = r.id)) THEN
      RAISE EXCEPTION 'Cette relation est déjà déclarée.' USING ERRCODE = 'MPY07';
    END IF;
    RETURN NEW;
  END $$;

-- ---------------------------------------------------------------------------
-- Satisfaction
-- ---------------------------------------------------------------------------

ALTER TABLE qualite_satisfactions
  ADD COLUMN origine text NOT NULL DEFAULT 'saisie_par_equipe'
    CHECK (origine IN ('saisie_par_equipe', 'client'));
