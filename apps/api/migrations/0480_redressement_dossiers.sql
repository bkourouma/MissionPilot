-- Redressement, restructuration et mise à niveau (service #5, lot 3a ; RED-01, 02, 05, 06, 07, 10,
-- 11, 12, 14 ; ADR-011, docs/workflows/specs/SPEC-3a-redressement.md).
--
-- PLAGE RÉSERVÉE 0480-0499 (lot RED, vague 4) : 0480-0486 = socle ; 0487-0499 = durcissements
-- d'audit (un numéro par correctif, jamais de modification d'une migration commitée).
--
-- Cette migration pose les fonctions communes `red_*` et le dossier de redressement : UN dossier
-- par mission, lié à la mission et au client de celle-ci. Les quinze tables du lot (0480-0486) ont
-- toutes : RLS `isolation`, politique RESTRICTIVE `portail_interdit` (le client n'accède jamais à
-- son propre dossier de redressement dans ce lot), clés étrangères composites (cabinet_id, ...),
-- aucun DELETE pour le rôle applicatif. Aucune fonction SECURITY DEFINER : tous les déclencheurs
-- sont d'invocateur et lisent sous la RLS du cabinet.
--
-- SQLSTATE du lot (lettre Z, un numéro = un sens ; MPZ21-32 sont réservés au lot due diligence) :
--   MPZ01 historique en ajout seul (UPDATE ou DELETE refusé)
--   MPZ02 rattachement incohérent (mission et client ; seuils d'un score ; échéance d'un autre créancier)
--   MPZ03 mission clôturée ou dossier clos : plus d'écriture
--   MPZ04 champ figé (identité, contenu d'une version publiée ou validée)
--   MPZ05 versions non consécutives, ou publication/validation d'une version qui n'est pas la dernière
--   MPZ06 transition de statut invalide
--   MPZ07 séparation des tâches (plan validé par son créateur ; seuils publiés par leur auteur)
--   MPZ08 réalisé de trésorerie : remplacement incohérent
--   MPZ09 négociation incohérente (accord en vigueur, paiement ou rupture hors accord, échéance)
--   MPZ10 plafond de volume atteint
--   MPZ11 plus de 10 corrections d'un même réalisé de semaine

-- Historique en ajout seul : branchée BEFORE UPDATE OR DELETE sur les tables concernées.
CREATE FUNCTION refuser_modification_redressement() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    RAISE EXCEPTION 'Le redressement est en ajout seul : corriger par un nouvel enregistrement.'
      USING ERRCODE = 'MPZ01';
  END $$;

-- Le dossier de la ligne (NEW.dossier_id) doit appartenir à une mission non clôturée et ne pas
-- être clos. Branchée BEFORE INSERT (et UPDATE des tables modifiables) sur toute table fille.
CREATE FUNCTION red_controler_mission_ouverte() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_dossier uuid := (to_jsonb(NEW) ->> 'dossier_id')::uuid;
    v_statut_dossier text;
    v_statut_mission text;
  BEGIN
    SELECT d.statut, m.statut INTO v_statut_dossier, v_statut_mission
      FROM red_dossiers d JOIN missions m ON m.cabinet_id = d.cabinet_id AND m.id = d.mission_id
      WHERE d.id = v_dossier;
    IF v_statut_mission = 'cloturee' OR v_statut_dossier = 'clos' THEN
      RAISE EXCEPTION 'La mission est clôturée ou le dossier de redressement est clos.'
        USING ERRCODE = 'MPZ03';
    END IF;
    RETURN NEW;
  END $$;

-- Plafond de volume. TG_ARGV = (colonne parente, maximum, libellé).
CREATE FUNCTION red_controler_plafond() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_parent uuid := (to_jsonb(NEW) ->> TG_ARGV[0])::uuid;
    v_maximum int := TG_ARGV[1]::int;
    v_nombre bigint;
  BEGIN
    EXECUTE format('SELECT count(*) FROM %I WHERE %I = $1', TG_TABLE_NAME, TG_ARGV[0])
      INTO v_nombre USING v_parent;
    IF v_nombre >= v_maximum THEN
      RAISE EXCEPTION 'Plafond atteint : au plus % %.', v_maximum, TG_ARGV[2]
        USING ERRCODE = 'MPZ10';
    END IF;
    RETURN NEW;
  END $$;

-- Versions consécutives par parent (colonne TG_ARGV[0]) : NEW.version = max + 1 (modèle 0380).
CREATE FUNCTION red_controler_version() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_parent uuid := (to_jsonb(NEW) ->> TG_ARGV[0])::uuid;
    v_suivante int;
  BEGIN
    EXECUTE format('SELECT coalesce(max(version), 0) + 1 FROM %I WHERE %I = $1',
                   TG_TABLE_NAME, TG_ARGV[0])
      INTO v_suivante USING v_parent;
    IF NEW.version <> v_suivante THEN
      RAISE EXCEPTION 'Les versions se suivent sans trou.' USING ERRCODE = 'MPZ05';
    END IF;
    RETURN NEW;
  END $$;

-- Dispense de la règle « pas l'auteur » : associé ACTIF (modèle plan_valideur_dispense, 0180).
CREATE FUNCTION red_valideur_dispense(p_utilisateur uuid) RETURNS boolean
  LANGUAGE sql STABLE SET search_path = public, pg_temp
  AS $$
    SELECT EXISTS (SELECT 1 FROM utilisateurs u
                   WHERE u.id = p_utilisateur AND u.actif AND 'associe' = ANY (u.roles)) $$;

CREATE TABLE red_dossiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  mission_id uuid NOT NULL,
  client_id uuid NOT NULL,
  intitule text NOT NULL CHECK (length(btrim(intitule)) BETWEEN 1 AND 200),
  secteur text NOT NULL DEFAULT 'general'
    CHECK (secteur IN ('general', 'industrie', 'commerce', 'services', 'btp', 'agriculture')),
  -- Copie de la devise de la mission à la création, figée.
  devise text NOT NULL CHECK (devise IN ('XOF', 'XAF', 'EUR', 'USD')),
  statut text NOT NULL DEFAULT 'ouvert'
    CHECK (statut IN ('ouvert', 'diagnostic', 'plan_valide', 'mise_en_oeuvre', 'clos')),
  motif_cloture text CHECK (motif_cloture IS NULL OR length(motif_cloture) BETWEEN 1 AND 1000),
  clos_le timestamptz,
  clos_par uuid,
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  modifie_par uuid,
  modifie_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  -- Un dossier de redressement par mission.
  UNIQUE (cabinet_id, mission_id),
  CHECK ((statut = 'clos') = (clos_le IS NOT NULL AND clos_par IS NOT NULL
                              AND motif_cloture IS NOT NULL)),
  FOREIGN KEY (cabinet_id, mission_id) REFERENCES missions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, client_id) REFERENCES clients (cabinet_id, id),
  FOREIGN KEY (cabinet_id, clos_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, modifie_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX red_dossiers_liste_idx ON red_dossiers (cabinet_id, cree_le DESC, id DESC);
CREATE INDEX red_dossiers_client_idx ON red_dossiers (cabinet_id, client_id);
ALTER TABLE red_dossiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON red_dossiers
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON red_dossiers AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE DELETE ON red_dossiers FROM missionpilot_app;

-- Dossier vivant mais borné. INSERT : mission et client cohérents, mission non clôturée, statut
-- « ouvert ». UPDATE : identité figée ; mission non clôturée (le dossier d'une mission clôturée
-- est en lecture seule) ; un dossier clos ne reçoit plus rien ; transitions de statut fermées.
CREATE FUNCTION red_controler_dossier() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_client uuid;
    v_devise text;
    v_statut_mission text;
  BEGIN
    SELECT m.client_id, m.devise, m.statut INTO v_client, v_devise, v_statut_mission
      FROM missions m WHERE m.id = NEW.mission_id;
    IF TG_OP = 'INSERT' THEN
      IF v_client IS DISTINCT FROM NEW.client_id OR v_devise IS DISTINCT FROM NEW.devise THEN
        RAISE EXCEPTION 'Le client et la devise du dossier sont ceux de la mission.'
          USING ERRCODE = 'MPZ02';
      END IF;
      IF v_statut_mission = 'cloturee' THEN
        RAISE EXCEPTION 'La mission est clôturée.' USING ERRCODE = 'MPZ03';
      END IF;
      IF NEW.statut <> 'ouvert' THEN
        RAISE EXCEPTION 'Un dossier de redressement naît ouvert.' USING ERRCODE = 'MPZ06';
      END IF;
    ELSE
      IF (NEW.cabinet_id, NEW.mission_id, NEW.client_id, NEW.devise, NEW.cree_par, NEW.cree_le)
         IS DISTINCT FROM (OLD.cabinet_id, OLD.mission_id, OLD.client_id, OLD.devise, OLD.cree_par,
                           OLD.cree_le) THEN
        RAISE EXCEPTION 'Mission, client, devise et création d''un dossier sont figés.'
          USING ERRCODE = 'MPZ04';
      END IF;
      IF v_statut_mission = 'cloturee' THEN
        RAISE EXCEPTION 'La mission est clôturée : le dossier est en lecture seule.'
          USING ERRCODE = 'MPZ03';
      END IF;
      IF OLD.statut = 'clos' THEN
        IF NEW.statut <> 'clos' THEN
          RAISE EXCEPTION 'Un dossier clos ne se rouvre pas.' USING ERRCODE = 'MPZ06';
        END IF;
        RAISE EXCEPTION 'Le dossier de redressement est clos.' USING ERRCODE = 'MPZ03';
      END IF;
      IF NEW.statut IS DISTINCT FROM OLD.statut THEN
        IF NOT (
             (OLD.statut = 'ouvert' AND NEW.statut = 'diagnostic')
             OR (OLD.statut = 'diagnostic' AND NEW.statut = 'plan_valide')
             OR (OLD.statut = 'plan_valide' AND NEW.statut = 'mise_en_oeuvre')
             OR NEW.statut = 'clos') THEN
          RAISE EXCEPTION 'Transition de statut invalide (% vers %).', OLD.statut, NEW.statut
            USING ERRCODE = 'MPZ06';
        END IF;
        IF NEW.statut IN ('plan_valide', 'mise_en_oeuvre') AND NOT EXISTS (
             SELECT 1 FROM red_plan_versions v WHERE v.dossier_id = NEW.id AND v.statut = 'valide') THEN
          RAISE EXCEPTION 'Aucune version de plan validée : le statut % est refusé.', NEW.statut
            USING ERRCODE = 'MPZ06';
        END IF;
      END IF;
    END IF;
    NEW.modifie_le := now();
    RETURN NEW;
  END $$;
CREATE TRIGGER red_dossiers_controle BEFORE INSERT OR UPDATE ON red_dossiers
  FOR EACH ROW EXECUTE FUNCTION red_controler_dossier();
