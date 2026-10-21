-- Redressement : bilan de clôture (RED-08, lot 2 « 3a-bis »). SQLSTATE : voir 0480 ; ajouts MPZ17
-- (bilan validé figé) et MPZ18 (bilan incomplet, validation refusée).
--
-- Un bilan de clôture compare l'état du dossier à l'ouverture et à la fin (ratios, score d'alerte,
-- urgence, trésorerie, plan, créanciers, covenants, check-lists, re-notation). Son CONTENU est
-- construit par le code depuis les moteurs (`packages/engines/src/redressement/cloture.ts`), jamais
-- reçu d'un client, et conserve les CONTRÔLES DE COMPLÉTUDE du moment (`contenu.controles`,
-- `contenu.complet`) : l'IA ne produit aucun chiffre.
--
-- Table (modèle : 0486 `red_plan_versions`) :
-- - red_clotures : versions consécutives d'un bilan par dossier, EN AJOUT SEUL (seule la validation
--   modifie une ligne : statut, valide_par, valide_le, motif_validation). Le bilan s'établit AVANT la
--   clôture du dossier : `red_controler_mission_ouverte` refuse l'écriture dès que le dossier est
--   clos ou la mission clôturée (MPZ03).
--
-- Garanties tenues en base, même si le code applicatif était contourné :
-- - une ligne naît en brouillon (MPZ06), ses contrôles consignés concordent avec `complet` (MPZ18) ;
-- - une ligne ne se supprime pas (MPZ01) ; une ligne validée est figée, toute modification est
--   refusée (MPZ17) ; avant validation, seul le passage brouillon -> valide est admis (MPZ06) et le
--   contenu ne bouge pas (MPZ04) ;
-- - versions consécutives (MPZ05) et seule la DERNIÈRE version se valide (MPZ05) ;
-- - la validation exige des contrôles de complétude consignés VRAIS : aucun contrôle bloquant non
--   satisfait (MPZ18) ;
-- - séparation des tâches (MPZ07), doublée par l'API : le valideur est un associé ou un directeur de
--   mission actif, et n'est pas le créateur sauf associé actif (`red_valideur_dispense`). La réserve
--   au directeur DE LA MISSION est une règle d'API (comme pour le plan : VALIDATION_PLAN_RESERVEE_AU_DIRECTEUR) ;
-- - plafond de volume (MPZ10) : 30 versions par dossier.
-- RLS `isolation`, politique RESTRICTIVE `portail_interdit`, clés étrangères composites, aucun
-- DELETE, aucune fonction SECURITY DEFINER. Aucune colonne vers `fichiers`.
--
-- Le modèle de rapport « cloture_redressement » (colonne `rapports_mission.red_cloture_id`) est
-- posé par la migration 0551 : il redéfinit des contraintes de `rapports_mission` qui dépendent de
-- 0508 (note au comité), laquelle s'applique après 0490.

CREATE TABLE red_clotures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  dossier_id uuid NOT NULL,
  version int NOT NULL CHECK (version >= 1),
  -- Date de référence des calculs (jour UTC de la construction).
  date_reference date NOT NULL CHECK (date_reference BETWEEN '2000-01-01' AND '2100-12-31'),
  -- Sortie de `construireBilanCloture` (snake_case) : sections et variations, `controles`, `complet`.
  contenu jsonb NOT NULL
    CHECK (jsonb_typeof(contenu) = 'object' AND octet_length(contenu::text) <= 100000),
  -- SHA-256 de la forme canonique du contenu, calculé par l'API.
  empreinte text NOT NULL CHECK (empreinte ~ '^[0-9a-f]{64}$'),
  -- Copie de `contenu.complet` : aucun contrôle bloquant non satisfait.
  complet boolean NOT NULL,
  statut text NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon', 'valide')),
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  valide_par uuid,
  valide_le timestamptz,
  motif_validation text CHECK (motif_validation IS NULL OR length(motif_validation) BETWEEN 1 AND 2000),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, dossier_id, version),
  CHECK ((statut = 'valide') = (valide_par IS NOT NULL AND valide_le IS NOT NULL)),
  FOREIGN KEY (cabinet_id, dossier_id) REFERENCES red_dossiers (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, valide_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX red_clotures_dossier_idx ON red_clotures (cabinet_id, dossier_id, version DESC);
ALTER TABLE red_clotures ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON red_clotures
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON red_clotures AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
-- Seule la validation (statut, valide_par, valide_le, motif_validation) modifie une ligne.
REVOKE UPDATE, DELETE ON red_clotures FROM missionpilot_app;
GRANT UPDATE (statut, valide_par, valide_le, motif_validation) ON red_clotures TO missionpilot_app;

-- Les contrôles consignés dans le contenu : un tableau non vide d'objets {code, bloquant, satisfait}
-- et un booléen `complet`. « Complet » = aucun contrôle bloquant non satisfait.
CREATE FUNCTION red_cloture_controles_vrais(p_contenu jsonb) RETURNS boolean
  LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp
  AS $$
    SELECT CASE WHEN jsonb_typeof(p_contenu -> 'controles') = 'array' THEN
      jsonb_array_length(p_contenu -> 'controles') > 0
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_contenu -> 'controles') c
        WHERE jsonb_typeof(c) <> 'object'
           OR (coalesce(c ->> 'bloquant', 'true') = 'true'
               AND coalesce(c ->> 'satisfait', 'false') <> 'true'))
      ELSE false END $$;

CREATE FUNCTION red_controler_cloture() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_derniere int;
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Un bilan de clôture ne se supprime pas.' USING ERRCODE = 'MPZ01';
    END IF;
    IF TG_OP = 'INSERT' THEN
      IF NEW.statut <> 'brouillon' THEN
        RAISE EXCEPTION 'Un bilan de clôture naît en brouillon.' USING ERRCODE = 'MPZ06';
      END IF;
      -- Les contrôles consignés et la colonne `complet` concordent.
      IF jsonb_typeof(NEW.contenu -> 'complet') IS DISTINCT FROM 'boolean'
         OR (NEW.contenu ->> 'complet')::boolean <> NEW.complet
         OR NEW.complet <> red_cloture_controles_vrais(NEW.contenu) THEN
        RAISE EXCEPTION 'Les contrôles de complétude consignés ne concordent pas avec le bilan.'
          USING ERRCODE = 'MPZ18';
      END IF;
      RETURN NEW;
    END IF;
    -- UPDATE : un bilan validé est figé.
    IF OLD.statut = 'valide' THEN
      RAISE EXCEPTION 'Le bilan de clôture validé est figé.' USING ERRCODE = 'MPZ17';
    END IF;
    -- La seule transition admise est la validation d'un brouillon.
    IF NEW.statut <> 'valide' THEN
      RAISE EXCEPTION 'Seule la validation d''un brouillon est admise.' USING ERRCODE = 'MPZ06';
    END IF;
    IF (NEW.cabinet_id, NEW.dossier_id, NEW.version, NEW.date_reference, NEW.contenu, NEW.empreinte,
        NEW.complet, NEW.cree_par, NEW.cree_le)
       IS DISTINCT FROM (OLD.cabinet_id, OLD.dossier_id, OLD.version, OLD.date_reference, OLD.contenu,
        OLD.empreinte, OLD.complet, OLD.cree_par, OLD.cree_le) THEN
      RAISE EXCEPTION 'Le contenu d''un bilan de clôture est figé.' USING ERRCODE = 'MPZ04';
    END IF;
    SELECT max(c.version) INTO v_derniere FROM red_clotures c WHERE c.dossier_id = NEW.dossier_id;
    IF NEW.version <> v_derniere THEN
      RAISE EXCEPTION 'Seule la dernière version du bilan de clôture se valide.' USING ERRCODE = 'MPZ05';
    END IF;
    IF NOT NEW.complet OR NOT red_cloture_controles_vrais(NEW.contenu) THEN
      RAISE EXCEPTION 'Le bilan de clôture est incomplet : un contrôle bloquant n''est pas satisfait.'
        USING ERRCODE = 'MPZ18';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM utilisateurs u
                   WHERE u.id = NEW.valide_par AND u.actif
                     AND u.roles && ARRAY['associe', 'directeur_mission']) THEN
      RAISE EXCEPTION 'Le bilan est validé par un associé ou un directeur de mission actif.'
        USING ERRCODE = 'MPZ07';
    END IF;
    IF NEW.valide_par = NEW.cree_par AND NOT red_valideur_dispense(NEW.valide_par) THEN
      RAISE EXCEPTION 'Le créateur d''un bilan de clôture ne le valide pas lui-même.'
        USING ERRCODE = 'MPZ07';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER red_clotures_controle BEFORE INSERT OR UPDATE OR DELETE ON red_clotures
  FOR EACH ROW EXECUTE FUNCTION red_controler_cloture();
-- Le bilan s'établit avant la clôture : écriture refusée dès que le dossier est clos ou la mission clôturée.
CREATE TRIGGER red_clotures_01_mission_ouverte BEFORE INSERT OR UPDATE ON red_clotures
  FOR EACH ROW EXECUTE FUNCTION red_controler_mission_ouverte();
CREATE TRIGGER red_clotures_plafond BEFORE INSERT ON red_clotures
  FOR EACH ROW EXECUTE FUNCTION red_controler_plafond('dossier_id', '30', 'bilans de clôture par dossier');
CREATE TRIGGER red_clotures_version BEFORE INSERT ON red_clotures
  FOR EACH ROW EXECUTE FUNCTION red_controler_version('dossier_id');
