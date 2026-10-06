-- Durcissement de la planification (audit de sécurité du lot PLN-04 à PLN-10).
-- Les bornes reprennent celles des schémas de packages/shared
-- (schemas/planification.ts) : la base reste la dernière barrière.

-- E1 : dates bornées aux années 2000 à 2100 et durées plafonnées. Une période
-- de l'an 1 à l'an 9999 ferait calculer des millions de jours ouvrés à chaque
-- plan de charge ou « Mon planning » (déni de service).
ALTER TABLE affectations
  ADD CONSTRAINT affectations_dates_bornees
    CHECK (date_debut >= DATE '2000-01-01' AND date_fin <= DATE '2100-12-31'),
  ADD CONSTRAINT affectations_duree_bornee
    CHECK (date_fin - date_debut <= 365);

ALTER TABLE absences
  ADD CONSTRAINT absences_dates_bornees
    CHECK (date_debut >= DATE '2000-01-01' AND date_fin <= DATE '2100-12-31'),
  ADD CONSTRAINT absences_duree_bornee
    CHECK (date_fin - date_debut <= 366);

-- F1 : un titre de notification (et donc le sujet de l'e-mail) tient sur une
-- ligne : aucun saut de ligne ne peut injecter un en-tête (Bcc:, …).
ALTER TABLE notifications
  ADD CONSTRAINT notifications_titre_une_ligne CHECK (titre !~ E'[\\r\\n]');

-- M1 : origine d'un membre d'équipe. « affectation » : entré dans l'équipe
-- uniquement par une affectation nominative ; il en sort quand sa dernière
-- affectation nominative sur la mission disparaît. « manuel » : ajouté par
-- POST /missions/:id/equipe (ou par la démonstration), jamais retiré
-- automatiquement.
ALTER TABLE mission_equipe
  ADD COLUMN source text NOT NULL DEFAULT 'manuel'
    CHECK (source IN ('manuel', 'affectation'));

-- Retrait automatique (suppression d'une affectation, y compris en cascade
-- depuis une tâche, ou changement de collaborateur) : journalisé en
-- `retrait_equipe` avec l'auteur de la transaction s'il est connu
-- (app.utilisateur_id, posé par l'API), via « affectation ».
CREATE FUNCTION retirer_equipe_par_affectation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_utilisateur uuid;
  BEGIN
    IF OLD.collaborateur_id IS NULL THEN
      RETURN NULL;
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.collaborateur_id IS NOT DISTINCT FROM OLD.collaborateur_id
       AND NEW.mission_id = OLD.mission_id THEN
      RETURN NULL;
    END IF;
    SELECT utilisateur_id INTO v_utilisateur FROM collaborateurs WHERE id = OLD.collaborateur_id;
    IF v_utilisateur IS NULL THEN
      RETURN NULL;
    END IF;
    IF EXISTS (SELECT 1 FROM affectations a JOIN collaborateurs c ON c.id = a.collaborateur_id
               WHERE a.mission_id = OLD.mission_id AND c.utilisateur_id = v_utilisateur) THEN
      RETURN NULL;
    END IF;
    DELETE FROM mission_equipe
      WHERE mission_id = OLD.mission_id AND utilisateur_id = v_utilisateur AND source = 'affectation';
    IF FOUND THEN
      INSERT INTO journal_audit (cabinet_id, utilisateur_id, action, entite, entite_id, details)
      VALUES (OLD.cabinet_id, nullif(current_setting('app.utilisateur_id', true), '')::uuid,
              'retrait_equipe', 'mission', OLD.mission_id::text,
              jsonb_build_object('utilisateur_id', v_utilisateur, 'via', 'affectation',
                                 'affectation_id', OLD.id));
    END IF;
    RETURN NULL;
  END $$;

CREATE TRIGGER affectations_retrait_equipe
  AFTER DELETE OR UPDATE OF collaborateur_id, mission_id ON affectations
  FOR EACH ROW EXECUTE FUNCTION retirer_equipe_par_affectation();

-- F2 : la décision d'une absence (decide_par, decide_le, motif_refus) ne
-- s'écrit qu'au passage « demandee » → « validee » | « refusee », puis est
-- figée ; annulee_le ne s'écrit qu'au passage à « annulee ». Le rôle
-- applicatif ne peut plus réécrire l'auteur ou la date d'une décision.
CREATE OR REPLACE FUNCTION refuser_modification_absence() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF (NEW.cabinet_id, NEW.collaborateur_id, NEW.demandeur_id, NEW.type, NEW.date_debut,
        NEW.date_fin, NEW.commentaire, NEW.cree_le)
       IS DISTINCT FROM
       (OLD.cabinet_id, OLD.collaborateur_id, OLD.demandeur_id, OLD.type, OLD.date_debut,
        OLD.date_fin, OLD.commentaire, OLD.cree_le) THEN
      RAISE EXCEPTION 'Une absence enregistrée ne change que de statut.' USING ERRCODE = 'MPF03';
    END IF;
    IF NEW.statut IS DISTINCT FROM OLD.statut AND NOT (
         (OLD.statut = 'demandee' AND NEW.statut IN ('validee', 'refusee', 'annulee'))
      OR (OLD.statut = 'validee' AND NEW.statut = 'annulee')) THEN
      RAISE EXCEPTION 'Transition de statut d''absence refusée.' USING ERRCODE = 'MPF03';
    END IF;
    IF OLD.statut IN ('refusee', 'annulee') THEN
      RAISE EXCEPTION 'Absence refusée ou annulée : plus aucune modification.' USING ERRCODE = 'MPF03';
    END IF;
    IF (NEW.decide_par, NEW.decide_le) IS DISTINCT FROM (OLD.decide_par, OLD.decide_le)
       AND NOT (OLD.statut = 'demandee' AND NEW.statut IN ('validee', 'refusee')) THEN
      RAISE EXCEPTION 'La décision d''une absence est figée.' USING ERRCODE = 'MPF03';
    END IF;
    IF NEW.motif_refus IS DISTINCT FROM OLD.motif_refus
       AND NOT (OLD.statut = 'demandee' AND NEW.statut = 'refusee') THEN
      RAISE EXCEPTION 'Le motif de refus d''une absence est figé.' USING ERRCODE = 'MPF03';
    END IF;
    IF NEW.annulee_le IS DISTINCT FROM OLD.annulee_le
       AND NOT (OLD.statut <> 'annulee' AND NEW.statut = 'annulee') THEN
      RAISE EXCEPTION 'La date d''annulation d''une absence est figée.' USING ERRCODE = 'MPF03';
    END IF;
    RETURN NEW;
  END $$;
