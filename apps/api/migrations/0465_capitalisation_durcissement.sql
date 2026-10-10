-- Capitalisation (lot CAP) — durcissements d'audit : déclarations de niveau bornées (CAP-06) et
-- validation du retour d'expérience réservée à un responsable de la mission (CAP-01).
-- Migration ajoutée APRÈS 0460 à 0464 (jamais de modification d'une migration existante).
--
-- SQLSTATE du domaine (lettre J, suite de 0460) :
--   MPJ06 une déclaration de niveau est déjà EN ATTENTE pour le couple (collaborateur, compétence) ;
--   MPJ07 plafond de 50 déclarations par couple (collaborateur, compétence) ;
--   MPJ08 retour d'expérience validé par une personne qui n'est ni associé, ni chef, ni directeur
--         de la mission, ou qui n'est pas l'utilisateur de la session (`app.utilisateur_id`).
--
-- Déclarations (MPJ06, MPJ07) : l'historique des déclarations est en ajout seul (0463) ; sans
-- borne, une personne pourrait le gonfler sans limite. Une déclaration en attente (sans décision)
-- à la fois ; le total par couple est plafonné. Verrou consultatif par couple : deux déclarations
-- simultanées ne passent pas toutes les deux.
--
-- Validation du retour (MPJ08) : la règle de l'API (route `mission.planifier` ET responsable de la
-- mission : chef, directeur ou associé) est doublée en base. Exception voulue, conforme au PRD :
-- le chef de mission peut valider la version IA qu'il a lui-même demandée (« l'IA propose,
-- l'expert dispose » : le chef est l'expert qui dispose) ; il n'y a donc PAS de séparation des
-- tâches entre l'auteur de la demande et le valideur, seulement l'exigence que le valideur soit
-- un responsable de la mission.

CREATE FUNCTION controler_competence_declaration() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'cap_declaration:' || NEW.collaborateur_id::text || ':' || NEW.competence_id::text, 0));
    IF EXISTS (SELECT 1 FROM competence_declarations d
               WHERE d.collaborateur_id = NEW.collaborateur_id
                 AND d.competence_id = NEW.competence_id
                 AND NOT EXISTS (SELECT 1 FROM competence_decisions x
                                 WHERE x.declaration_id = d.id)) THEN
      RAISE EXCEPTION 'Une déclaration est déjà en attente pour cette compétence.'
        USING ERRCODE = 'MPJ06';
    END IF;
    IF (SELECT count(*) FROM competence_declarations d
        WHERE d.collaborateur_id = NEW.collaborateur_id
          AND d.competence_id = NEW.competence_id) >= 50 THEN
      RAISE EXCEPTION 'Au plus 50 déclarations par compétence et par collaborateur.'
        USING ERRCODE = 'MPJ07';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER competence_declarations_controle BEFORE INSERT ON competence_declarations
  FOR EACH ROW EXECUTE FUNCTION controler_competence_declaration();

-- Identité figée ; seule transition : brouillon → validé, sur une version existante (MPJ02), par
-- un responsable de la mission qui est l'utilisateur de la session (MPJ08). Reprend 0460.
CREATE OR REPLACE FUNCTION controler_retour_experience() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_session text := nullif(current_setting('app.utilisateur_id', true), '');
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Un retour d''expérience ne se supprime pas.' USING ERRCODE = 'MPJ01';
    END IF;
    IF (NEW.id, NEW.cabinet_id, NEW.mission_id, NEW.ouvert_par, NEW.ouvert_le)
       IS DISTINCT FROM (OLD.id, OLD.cabinet_id, OLD.mission_id, OLD.ouvert_par, OLD.ouvert_le)
       OR OLD.statut <> 'brouillon' OR NEW.statut <> 'valide' THEN
      RAISE EXCEPTION 'Validation du retour d''expérience définitive.' USING ERRCODE = 'MPJ02';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM retour_experience_versions v
                   WHERE v.retour_id = NEW.id AND v.version = NEW.version_validee) THEN
      RAISE EXCEPTION 'Version validée inexistante.' USING ERRCODE = 'MPJ02';
    END IF;
    IF NOT EXISTS (
         SELECT 1 FROM utilisateurs u JOIN missions m ON m.id = NEW.mission_id
         WHERE u.id = NEW.valide_par AND u.actif
           AND ('associe' = ANY (u.roles) OR u.id IN (m.chef_id, m.directeur_id))) THEN
      RAISE EXCEPTION 'Le retour d''expérience se valide par un associé, le chef ou le directeur de la mission.'
        USING ERRCODE = 'MPJ08';
    END IF;
    IF v_session IS NOT NULL AND v_session::uuid IS DISTINCT FROM NEW.valide_par THEN
      RAISE EXCEPTION 'Le retour d''expérience se valide au nom de la session seulement.'
        USING ERRCODE = 'MPJ08';
    END IF;
    RETURN NEW;
  END $$;
