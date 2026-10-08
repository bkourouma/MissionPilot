-- Génération assistée de questionnaires par l'IA (SOC-11).
--
-- Un brouillon proposé par l'IA naît comme n'importe quel modèle du cabinet
-- (version 1 en BROUILLON, 0140) ; cette table en tient l'HISTORIQUE de
-- contenu, en ajout seul : « brouillon_ia » (la proposition), puis autant de
-- « modifie » que le consultant retouche la définition, puis « valide ». Le
-- dernier rang donne le statut du contenu (brouillon IA, modifié, validé).
--
-- Garanties tenues en base, même si le code applicatif était contourné :
-- - l'historique est en ajout seul (MPQ06), ses rangs se suivent, rien ne
--   s'ajoute après « valide » ni sur une version déjà validée ;
-- - une version d'origine IA ne passe à « valide » (donc ne s'envoie à un
--   client, 0141) que si le dernier rang est « valide » (MPQ08) : l'IA
--   propose, l'expert dispose ;
-- - la définition d'une version d'origine IA ne change qu'avec un rang
--   « modifie » inscrit dans la même transaction (MPQ06).
-- La séparation des tâches (le valideur n'est ni le demandeur ni l'auteur
-- d'un rang, sauf associé) est contrôlée par questionnaires/generation-ia.ts.

CREATE TABLE questionnaire_ia_historique (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  version_id uuid NOT NULL,
  rang int NOT NULL CHECK (rang BETWEEN 1 AND 1000),
  statut_contenu text NOT NULL CHECK (statut_contenu IN ('brouillon_ia', 'modifie', 'valide')),
  auteur_id uuid NOT NULL,
  -- Rang 1 seulement : demande à l'orchestrateur IA et besoin décrit.
  demande_id uuid,
  brief jsonb CHECK (brief IS NULL OR jsonb_typeof(brief) = 'object'),
  -- Contenu produit par le gabarit déterministe (IA indisponible, sortie inexploitable).
  gabarit boolean NOT NULL DEFAULT false,
  chiffres_non_verifies boolean NOT NULL DEFAULT false,
  nombres_non_verifies jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(nombres_non_verifies) = 'array'),
  chiffres_acquittes boolean NOT NULL DEFAULT false,
  cree_le timestamptz NOT NULL DEFAULT now(),
  CHECK ((rang = 1) = (statut_contenu = 'brouillon_ia')),
  CHECK ((rang = 1) = (demande_id IS NOT NULL AND brief IS NOT NULL)),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, version_id, rang),
  FOREIGN KEY (cabinet_id, version_id) REFERENCES questionnaire_versions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, auteur_id) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, demande_id) REFERENCES ia_demandes (cabinet_id, id)
);
CREATE INDEX questionnaire_ia_historique_version_idx
  ON questionnaire_ia_historique (cabinet_id, version_id, rang);
ALTER TABLE questionnaire_ia_historique ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON questionnaire_ia_historique
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
-- Interne au cabinet : rien de visible ni de modifiable depuis le portail client.
CREATE POLICY portail_interdit ON questionnaire_ia_historique AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON questionnaire_ia_historique FROM missionpilot_app;

CREATE FUNCTION controler_questionnaire_ia_historique() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_dernier record; v_statut text;
  BEGIN
    IF TG_OP <> 'INSERT' THEN
      RAISE EXCEPTION 'L''historique IA d''un questionnaire est en ajout seul.'
        USING ERRCODE = 'MPQ06';
    END IF;
    SELECT rang, statut_contenu INTO v_dernier FROM questionnaire_ia_historique
      WHERE version_id = NEW.version_id ORDER BY rang DESC LIMIT 1;
    IF NEW.rang <> coalesce(v_dernier.rang, 0) + 1 THEN
      RAISE EXCEPTION 'Rang d''historique IA non consécutif.' USING ERRCODE = 'MPQ06';
    END IF;
    IF v_dernier.statut_contenu = 'valide' THEN
      RAISE EXCEPTION 'Contenu validé : l''historique IA est clos.' USING ERRCODE = 'MPQ06';
    END IF;
    SELECT statut INTO v_statut FROM questionnaire_versions WHERE id = NEW.version_id;
    IF v_statut IS DISTINCT FROM 'brouillon' THEN
      RAISE EXCEPTION 'Seule une version en brouillon reçoit un rang d''historique IA.'
        USING ERRCODE = 'MPQ06';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER questionnaire_ia_historique_controle
  BEFORE INSERT OR UPDATE OR DELETE ON questionnaire_ia_historique
  FOR EACH ROW EXECUTE FUNCTION controler_questionnaire_ia_historique();

-- Version d'origine IA : validation conditionnée au dernier rang « valide »,
-- définition modifiée seulement avec un rang « modifie » de la même transaction.
CREATE FUNCTION controler_questionnaire_version_ia() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_dernier record;
  BEGIN
    SELECT statut_contenu, cree_le INTO v_dernier FROM questionnaire_ia_historique
      WHERE version_id = OLD.id ORDER BY rang DESC LIMIT 1;
    IF NOT FOUND THEN
      RETURN NEW;
    END IF;
    IF NEW.statut = 'valide' AND OLD.statut = 'brouillon' AND v_dernier.statut_contenu <> 'valide' THEN
      RAISE EXCEPTION 'Un contenu proposé par l''IA se valide d''abord par un consultant.'
        USING ERRCODE = 'MPQ08';
    END IF;
    IF NEW.definition IS DISTINCT FROM OLD.definition
       AND (v_dernier.statut_contenu = 'valide' OR v_dernier.cree_le <> now()) THEN
      RAISE EXCEPTION 'Toute modification d''un contenu d''origine IA est inscrite à son historique.'
        USING ERRCODE = 'MPQ06';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER questionnaire_versions_origine_ia BEFORE UPDATE ON questionnaire_versions
  FOR EACH ROW EXECUTE FUNCTION controler_questionnaire_version_ia();
