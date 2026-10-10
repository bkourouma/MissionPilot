-- Banque d'items standard étalonnée (NOT-09, PRD complémentaire §11.1 et §4.5) et sélections
-- du questionnaire adaptatif CONTRÔLÉ.
--
-- - Un item évalue une pratique d'une dimension sur une échelle à ancrages comportementaux, avec
--   une formulation par public. Il est versionné : une version se rédige en brouillon, puis est
--   validée par un expert métier ACTIF qui n'en est ni l'auteur ni le dernier modificateur
--   (MPN04, comme une grille : 0145) ; validée, elle est figée (MPN08) et toute correction passe
--   par une nouvelle version. Le contenu est contrôlé par le moteur (`exigerItemValide`).
-- - Une sélection (questionnaire adaptatif d'une mission) cite des versions d'items VALIDÉES et,
--   pour chacune, une formulation EXISTANTE de l'item : jamais d'item non validé ni de
--   reformulation libre (MPN09). Sélections et lignes en ajout seul (MPN09).

CREATE TABLE notation_banque_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  code text NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9_.-]{0,79}$'),
  version int NOT NULL CHECK (version BETWEEN 1 AND 100000),
  dimension text NOT NULL CHECK (dimension ~ '^[a-z0-9][a-z0-9_.-]{0,79}$'),
  pratique text NOT NULL CHECK (pratique ~ '^[a-z0-9][a-z0-9_.-]{0,79}$'),
  contenu jsonb NOT NULL
    CHECK (jsonb_typeof(contenu) = 'object' AND octet_length(contenu::text) <= 100000),
  statut text NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon', 'valide')),
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  modifie_par uuid NOT NULL,
  modifie_le timestamptz NOT NULL DEFAULT now(),
  valide_par uuid,
  valide_le timestamptz,
  CHECK ((statut = 'valide') = (valide_par IS NOT NULL)),
  CHECK ((valide_par IS NULL) = (valide_le IS NULL)),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, code, version),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, modifie_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, valide_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE UNIQUE INDEX notation_banque_items_brouillon_uniq ON notation_banque_items (cabinet_id, code)
  WHERE statut = 'brouillon';
CREATE INDEX notation_banque_items_tri_idx ON notation_banque_items (cabinet_id, code, version DESC);
ALTER TABLE notation_banque_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON notation_banque_items
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON notation_banque_items AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE DELETE ON notation_banque_items FROM missionpilot_app;

-- Création : brouillon, version suivante du code, dimension et pratique égales au contenu.
CREATE FUNCTION controler_notation_banque_item_creation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NEW.statut <> 'brouillon' OR NEW.valide_par IS NOT NULL THEN
      RAISE EXCEPTION 'Un item de banque se crée en brouillon.' USING ERRCODE = 'MPN08';
    END IF;
    IF NEW.version <> coalesce((SELECT max(i.version) FROM notation_banque_items i
                                WHERE i.cabinet_id = NEW.cabinet_id AND i.code = NEW.code), 0) + 1 THEN
      RAISE EXCEPTION 'Numéro de version d''item inattendu.' USING ERRCODE = 'MPN08';
    END IF;
    IF NEW.contenu ->> 'code' IS DISTINCT FROM NEW.code
       OR NEW.contenu ->> 'dimension' IS DISTINCT FROM NEW.dimension
       OR NEW.contenu ->> 'pratique' IS DISTINCT FROM NEW.pratique THEN
      RAISE EXCEPTION 'Code, dimension et pratique de l''item diffèrent de son contenu.'
        USING ERRCODE = 'MPN08';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER notation_banque_items_creation BEFORE INSERT ON notation_banque_items
  FOR EACH ROW EXECUTE FUNCTION controler_notation_banque_item_creation();

-- Modification : brouillon seulement ; identité figée ; validation par un expert métier actif
-- qui n'est ni l'auteur ni le dernier modificateur, contenu inchangé.
CREATE FUNCTION controler_notation_banque_item() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Un item de banque ne se supprime pas.' USING ERRCODE = 'MPN08';
    END IF;
    IF OLD.statut = 'valide' THEN
      RAISE EXCEPTION 'Un item validé est figé : créer une nouvelle version.' USING ERRCODE = 'MPN08';
    END IF;
    IF (NEW.cabinet_id, NEW.code, NEW.version, NEW.dimension, NEW.pratique, NEW.cree_par, NEW.cree_le)
       IS DISTINCT FROM (OLD.cabinet_id, OLD.code, OLD.version, OLD.dimension, OLD.pratique,
        OLD.cree_par, OLD.cree_le)
       OR NEW.contenu ->> 'code' IS DISTINCT FROM NEW.code
       OR NEW.contenu ->> 'dimension' IS DISTINCT FROM NEW.dimension
       OR NEW.contenu ->> 'pratique' IS DISTINCT FROM NEW.pratique THEN
      RAISE EXCEPTION 'L''identité d''un item de banque est figée.' USING ERRCODE = 'MPN08';
    END IF;
    IF NEW.statut = 'valide' THEN
      IF NEW.contenu IS DISTINCT FROM OLD.contenu THEN
        RAISE EXCEPTION 'Le contenu d''un item ne change pas à sa validation.' USING ERRCODE = 'MPN08';
      END IF;
      IF NEW.valide_par IN (OLD.cree_par, OLD.modifie_par) THEN
        RAISE EXCEPTION 'L''auteur ou le dernier modificateur d''un item ne le valide pas.'
          USING ERRCODE = 'MPN04';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM utilisateurs u WHERE u.id = NEW.valide_par AND u.actif
                     AND 'expert_metier' = ANY (u.roles)) THEN
        RAISE EXCEPTION 'Seul un expert métier valide un item de banque.' USING ERRCODE = 'MPN04';
      END IF;
    END IF;
    NEW.modifie_le := now();
    RETURN NEW;
  END $$;
CREATE TRIGGER notation_banque_items_controle BEFORE UPDATE OR DELETE ON notation_banque_items
  FOR EACH ROW EXECUTE FUNCTION controler_notation_banque_item();

CREATE TABLE notation_selections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  mission_id uuid NOT NULL,
  public text NOT NULL CHECK (public IN ('tous', 'dirigeant', 'manager', 'equipe', 'externe')),
  origine text NOT NULL CHECK (origine IN ('moteur', 'proposition')),
  regles jsonb NOT NULL CHECK (jsonb_typeof(regles) = 'object' AND octet_length(regles::text) <= 20000),
  definition jsonb NOT NULL
    CHECK (jsonb_typeof(definition) = 'object' AND octet_length(definition::text) <= 500000),
  duree_secondes int NOT NULL CHECK (duree_secondes BETWEEN 0 AND 86400),
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, mission_id) REFERENCES missions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX notation_selections_mission_idx ON notation_selections (cabinet_id, mission_id, cree_le DESC, id DESC);
ALTER TABLE notation_selections ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON notation_selections
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON notation_selections AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON notation_selections FROM missionpilot_app;

CREATE TABLE notation_selection_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  selection_id uuid NOT NULL,
  rang int NOT NULL CHECK (rang BETWEEN 1 AND 1000),
  item_id uuid NOT NULL,
  public_formulation text NOT NULL
    CHECK (public_formulation IN ('tous', 'dirigeant', 'manager', 'equipe', 'externe')),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, selection_id, rang),
  UNIQUE (cabinet_id, selection_id, item_id),
  FOREIGN KEY (cabinet_id, selection_id) REFERENCES notation_selections (cabinet_id, id),
  FOREIGN KEY (cabinet_id, item_id) REFERENCES notation_banque_items (cabinet_id, id)
);
ALTER TABLE notation_selection_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON notation_selection_items
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON notation_selection_items AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON notation_selection_items FROM missionpilot_app;

CREATE FUNCTION refuser_modification_selection_notation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    RAISE EXCEPTION 'Une sélection d''items est en ajout seul.' USING ERRCODE = 'MPN09';
  END $$;
CREATE TRIGGER notation_selections_ajout_seul BEFORE UPDATE OR DELETE ON notation_selections
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_selection_notation();
CREATE TRIGGER notation_selection_items_ajout_seul BEFORE UPDATE OR DELETE ON notation_selection_items
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_selection_notation();

-- Ligne de sélection : item VALIDÉ, formulation existante de l'item (jamais de reformulation
-- libre), une seule version d'un même code par sélection.
CREATE FUNCTION controler_notation_selection_item() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_item notation_banque_items%ROWTYPE;
  BEGIN
    SELECT * INTO v_item FROM notation_banque_items WHERE id = NEW.item_id;
    IF NOT FOUND OR v_item.statut <> 'valide' THEN
      RAISE EXCEPTION 'Seul un item validé de la banque entre dans une sélection.' USING ERRCODE = 'MPN09';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(
                     CASE WHEN jsonb_typeof(v_item.contenu -> 'formulations') = 'array'
                          THEN v_item.contenu -> 'formulations' ELSE '[]'::jsonb END) f
                   WHERE f ->> 'public' = NEW.public_formulation) THEN
      RAISE EXCEPTION 'La formulation retenue n''est pas une formulation validée de l''item.'
        USING ERRCODE = 'MPN09';
    END IF;
    IF EXISTS (SELECT 1 FROM notation_selection_items s JOIN notation_banque_items i ON i.id = s.item_id
               WHERE s.selection_id = NEW.selection_id AND i.code = v_item.code) THEN
      RAISE EXCEPTION 'Un item ne figure qu''une fois dans une sélection.' USING ERRCODE = 'MPN09';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER notation_selection_items_controle BEFORE INSERT ON notation_selection_items
  FOR EACH ROW EXECUTE FUNCTION controler_notation_selection_item();
