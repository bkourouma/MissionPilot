-- Redressement : cartographie des causes racines proposée par l'IA (RED-04, lot 2 « 3a-bis »).
-- SQLSTATE : voir 0480 ; ajouts MPZ13 et MPZ14 (lettre Z, un numéro = un sens).
--
-- L'IA propose, le consultant dispose. Une cartographie naît comme proposition (version N du
-- dossier, statut `brouillon`) et son HISTORIQUE de contenu, en ajout seul, en tient le circuit :
-- « brouillon_ia » (la proposition ou son repli déterministe), autant de « modifie » que le
-- consultant retouche, puis « valide ». Le dernier rang donne le statut du contenu. Seule une
-- cartographie `valide` est exploitable dans un livrable. Aucun chiffre ne vient du modèle : la
-- table ne porte que des textes qualitatifs ; les nombres cités par une proposition sont contrôlés
-- par la garde-chiffres de l'API et signalés (`chiffres_non_verifies`, `nombres_non_verifies`).
--
-- Tables (modèle : 0149 `questionnaire_ia_historique`, 0486 `red_plan_versions`) :
-- - red_causes_versions   : une cartographie par version consécutive d'un dossier (MPZ05), contenu
--   jsonb borné construit par le code (jamais reçu tel quel d'un client), demande à l'orchestrateur
--   IA, indicateur `gabarit`. Seuls contenu, statut, validation et trace de modification bougent.
-- - red_causes_historique : rangs `brouillon_ia` / `modifie` / `valide`, EN AJOUT SEUL.
--
-- Garanties tenues en base, même si le code applicatif était contourné :
-- - l'historique est en ajout seul (MPZ13), ses rangs se suivent, rien ne s'ajoute après « valide »
--   ni sur une cartographie déjà validée ;
-- - le contenu d'une cartographie ne change qu'avec un rang « modifie » inscrit dans la MÊME
--   transaction (MPZ13) ; une cartographie validée est figée (MPZ04) ;
-- - une cartographie ne passe à `valide` que si le dernier rang de son historique est « valide »,
--   et que les nombres non vérifiés ont été acquittés (MPZ14) : l'IA propose, l'expert dispose ;
-- - séparation des tâches (MPZ07), doublée par l'API : le valideur n'est ni l'auteur d'un rang ni
--   le créateur de la cartographie, sauf associé actif (`red_valideur_dispense`) ;
-- - écritures refusées si le dossier est clos ou la mission clôturée (MPZ03) ;
-- - plafonds de volume (MPZ10) : 30 cartographies par dossier, 200 rangs par cartographie.
-- Toutes les tables : RLS `isolation`, politique RESTRICTIVE `portail_interdit`, clés étrangères
-- composites, aucun DELETE. Aucune fonction SECURITY DEFINER.

CREATE TABLE red_causes_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  dossier_id uuid NOT NULL,
  version int NOT NULL CHECK (version >= 1),
  -- Cartographie normalisée par le moteur (`normaliserCartographie`) : { version, causes: [...] }.
  -- 12 causes au plus de 1 120 caractères (jusqu'à 4 octets chacun) : moins de 65 Ko.
  contenu jsonb NOT NULL
    CHECK (jsonb_typeof(contenu) = 'object' AND octet_length(contenu::text) <= 65000),
  statut text NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon', 'valide')),
  -- Contenu fabriqué par le repli déterministe (IA indisponible, plafond atteint, sortie inexploitable).
  gabarit boolean NOT NULL DEFAULT false,
  -- Demande à l'orchestrateur IA (ia_demandes) dont la cartographie est issue.
  demande_id uuid NOT NULL,
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  modifie_par uuid,
  modifie_le timestamptz NOT NULL DEFAULT now(),
  valide_par uuid,
  valide_le timestamptz,
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, dossier_id, id),
  UNIQUE (cabinet_id, dossier_id, version),
  CHECK ((statut = 'valide') = (valide_par IS NOT NULL AND valide_le IS NOT NULL)),
  FOREIGN KEY (cabinet_id, dossier_id) REFERENCES red_dossiers (cabinet_id, id),
  FOREIGN KEY (cabinet_id, demande_id) REFERENCES ia_demandes (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, modifie_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, valide_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX red_causes_versions_dossier_idx
  ON red_causes_versions (cabinet_id, dossier_id, version DESC);
ALTER TABLE red_causes_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON red_causes_versions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON red_causes_versions AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
-- Seuls le contenu, le statut et leur trace bougent (le déclencheur ci-dessous règle le reste).
REVOKE UPDATE, DELETE ON red_causes_versions FROM missionpilot_app;
GRANT UPDATE (contenu, statut, modifie_par, modifie_le, valide_par, valide_le)
  ON red_causes_versions TO missionpilot_app;

CREATE TABLE red_causes_historique (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  dossier_id uuid NOT NULL,
  version_id uuid NOT NULL,
  rang int NOT NULL CHECK (rang BETWEEN 1 AND 1000),
  statut_contenu text NOT NULL CHECK (statut_contenu IN ('brouillon_ia', 'modifie', 'valide')),
  auteur_id uuid NOT NULL,
  -- Rang 1 seulement : demande à l'orchestrateur IA et résumé du besoin (jamais un texte libre).
  demande_id uuid,
  brief jsonb CHECK (brief IS NULL
    OR (jsonb_typeof(brief) = 'object' AND octet_length(brief::text) <= 2000)),
  gabarit boolean NOT NULL DEFAULT false,
  chiffres_non_verifies boolean NOT NULL DEFAULT false,
  nombres_non_verifies jsonb NOT NULL DEFAULT '[]'
    CHECK (jsonb_typeof(nombres_non_verifies) = 'array'
           AND jsonb_array_length(nombres_non_verifies) <= 50
           AND octet_length(nombres_non_verifies::text) <= 4000),
  chiffres_acquittes boolean NOT NULL DEFAULT false,
  cree_le timestamptz NOT NULL DEFAULT now(),
  CHECK ((rang = 1) = (statut_contenu = 'brouillon_ia')),
  CHECK ((rang = 1) = (demande_id IS NOT NULL AND brief IS NOT NULL)),
  CHECK (chiffres_non_verifies = (jsonb_array_length(nombres_non_verifies) > 0)),
  CHECK (NOT chiffres_acquittes OR chiffres_non_verifies),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, version_id, rang),
  FOREIGN KEY (cabinet_id, dossier_id) REFERENCES red_dossiers (cabinet_id, id),
  FOREIGN KEY (cabinet_id, dossier_id, version_id)
    REFERENCES red_causes_versions (cabinet_id, dossier_id, id),
  FOREIGN KEY (cabinet_id, auteur_id) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, demande_id) REFERENCES ia_demandes (cabinet_id, id)
);
CREATE INDEX red_causes_historique_version_idx
  ON red_causes_historique (cabinet_id, version_id, rang);
ALTER TABLE red_causes_historique ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON red_causes_historique
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON red_causes_historique AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON red_causes_historique FROM missionpilot_app;

-- Historique : ajout seul, rangs consécutifs, rien après « valide », seulement sur un brouillon.
CREATE FUNCTION red_controler_causes_historique() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_dernier record; v_statut text;
  BEGIN
    IF TG_OP <> 'INSERT' THEN
      RAISE EXCEPTION 'L''historique des causes racines est en ajout seul.' USING ERRCODE = 'MPZ13';
    END IF;
    SELECT rang, statut_contenu INTO v_dernier FROM red_causes_historique
      WHERE version_id = NEW.version_id ORDER BY rang DESC LIMIT 1;
    IF NEW.rang <> coalesce(v_dernier.rang, 0) + 1 THEN
      RAISE EXCEPTION 'Rang d''historique des causes racines non consécutif.' USING ERRCODE = 'MPZ13';
    END IF;
    IF v_dernier.statut_contenu = 'valide' THEN
      RAISE EXCEPTION 'Contenu validé : l''historique des causes racines est clos.'
        USING ERRCODE = 'MPZ13';
    END IF;
    SELECT statut INTO v_statut FROM red_causes_versions WHERE id = NEW.version_id;
    IF v_statut IS DISTINCT FROM 'brouillon' THEN
      RAISE EXCEPTION 'Seule une cartographie en brouillon reçoit un rang d''historique.'
        USING ERRCODE = 'MPZ13';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER red_causes_historique_controle BEFORE INSERT OR UPDATE OR DELETE ON red_causes_historique
  FOR EACH ROW EXECUTE FUNCTION red_controler_causes_historique();
CREATE TRIGGER red_causes_historique_01_mission_ouverte BEFORE INSERT ON red_causes_historique
  FOR EACH ROW EXECUTE FUNCTION red_controler_mission_ouverte();
CREATE TRIGGER red_causes_historique_plafond BEFORE INSERT ON red_causes_historique
  FOR EACH ROW EXECUTE FUNCTION red_controler_plafond('version_id', '200', 'rangs d''historique par cartographie');

-- Cartographie : naissance en brouillon, contenu modifié seulement avec un rang « modifie » de la
-- même transaction, validation conditionnée au dernier rang « valide » (MPZ14) et à la séparation
-- des tâches (MPZ07), cartographie validée figée.
CREATE FUNCTION red_controler_causes_version() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_dernier record;
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Une cartographie de causes racines ne se supprime pas.' USING ERRCODE = 'MPZ01';
    END IF;
    IF TG_OP = 'INSERT' THEN
      IF NEW.statut <> 'brouillon' THEN
        RAISE EXCEPTION 'Une cartographie naît en brouillon.' USING ERRCODE = 'MPZ06';
      END IF;
      RETURN NEW;
    END IF;
    IF (NEW.cabinet_id, NEW.dossier_id, NEW.version, NEW.demande_id, NEW.gabarit, NEW.cree_par, NEW.cree_le)
       IS DISTINCT FROM (OLD.cabinet_id, OLD.dossier_id, OLD.version, OLD.demande_id, OLD.gabarit,
                         OLD.cree_par, OLD.cree_le) THEN
      RAISE EXCEPTION 'Dossier, version, origine et création d''une cartographie sont figés.'
        USING ERRCODE = 'MPZ04';
    END IF;
    IF OLD.statut = 'valide' THEN
      IF NEW IS DISTINCT FROM OLD THEN
        RAISE EXCEPTION 'Une cartographie validée est figée.' USING ERRCODE = 'MPZ04';
      END IF;
      RETURN NEW;
    END IF;
    IF NEW.statut NOT IN ('brouillon', 'valide') THEN
      RAISE EXCEPTION 'Statut de cartographie invalide.' USING ERRCODE = 'MPZ06';
    END IF;
    SELECT h.statut_contenu, h.cree_le, h.auteur_id, h.chiffres_non_verifies, h.chiffres_acquittes
      INTO v_dernier FROM red_causes_historique h
      WHERE h.version_id = OLD.id ORDER BY h.rang DESC LIMIT 1;
    IF NEW.contenu IS DISTINCT FROM OLD.contenu THEN
      IF NEW.statut = 'valide' THEN
        RAISE EXCEPTION 'La validation ne modifie pas le contenu.' USING ERRCODE = 'MPZ04';
      END IF;
      IF NOT FOUND OR v_dernier.statut_contenu <> 'modifie' OR v_dernier.cree_le <> now() THEN
        RAISE EXCEPTION 'Toute modification des causes racines est inscrite à son historique.'
          USING ERRCODE = 'MPZ13';
      END IF;
    END IF;
    IF NEW.statut = 'valide' THEN
      IF NOT FOUND OR v_dernier.statut_contenu <> 'valide' THEN
        RAISE EXCEPTION 'Un contenu proposé par l''IA se valide d''abord par un consultant.'
          USING ERRCODE = 'MPZ14';
      END IF;
      IF v_dernier.chiffres_non_verifies AND NOT v_dernier.chiffres_acquittes THEN
        RAISE EXCEPTION 'Des nombres non vérifiés doivent être acquittés avant la validation.'
          USING ERRCODE = 'MPZ14';
      END IF;
      IF NEW.valide_par IS DISTINCT FROM v_dernier.auteur_id THEN
        RAISE EXCEPTION 'Le valideur est l''auteur du rang « valide » de l''historique.'
          USING ERRCODE = 'MPZ07';
      END IF;
      IF NOT red_valideur_dispense(NEW.valide_par) AND (
           NEW.valide_par = NEW.cree_par
           OR EXISTS (SELECT 1 FROM red_causes_historique h
                      WHERE h.version_id = OLD.id AND h.statut_contenu <> 'valide'
                        AND h.auteur_id = NEW.valide_par)) THEN
        RAISE EXCEPTION 'Le demandeur ou l''auteur d''un rang ne valide pas lui-même la cartographie.'
          USING ERRCODE = 'MPZ07';
      END IF;
    END IF;
    NEW.modifie_le := now();
    RETURN NEW;
  END $$;
CREATE TRIGGER red_causes_versions_controle BEFORE INSERT OR UPDATE OR DELETE ON red_causes_versions
  FOR EACH ROW EXECUTE FUNCTION red_controler_causes_version();
CREATE TRIGGER red_causes_versions_01_mission_ouverte BEFORE INSERT OR UPDATE ON red_causes_versions
  FOR EACH ROW EXECUTE FUNCTION red_controler_mission_ouverte();
CREATE TRIGGER red_causes_versions_plafond BEFORE INSERT ON red_causes_versions
  FOR EACH ROW EXECUTE FUNCTION red_controler_plafond('dossier_id', '30', 'cartographies de causes racines par dossier');
CREATE TRIGGER red_causes_versions_version BEFORE INSERT ON red_causes_versions
  FOR EACH ROW EXECUTE FUNCTION red_controler_version('dossier_id');
