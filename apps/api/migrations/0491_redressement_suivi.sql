-- Redressement : suivi post-mission (RED-09, lot 2).
-- SQLSTATE : voir 0480 (MPZ01, MPZ10) ; MPZ19 et MPZ20 sont posés ici.
--
-- Après la CLÔTURE du dossier, le cabinet suit le client : un plan de suivi (un seul par dossier),
-- ses jalons (par défaut à 6 et 12 mois de la clôture), des relevés des ratios du client par jalon
-- et des événements de jalon (réalisé, reporté avec motif). Tout est EN AJOUT SEUL :
-- - red_suivi_plans      : le plan, créé à partir d'un dossier CLOS ; garde la date de clôture
--   (jour UTC de red_dossiers.clos_le) et la référence de clôture (ratios du dernier état accepté,
--   calculés par le code serveur depuis le moteur de ratios, avec exercice et version de
--   correspondance) ;
-- - red_suivi_jalons     : jalons du plan, écrits dans la transaction du plan (rang consécutif,
--   dates strictement croissantes, jamais avant la clôture) ;
-- - red_suivi_releves    : relevés d'un jalon (ratios saisis, ou instantané des ratios du dernier
--   état accepté), commentaire borné, auteur ;
-- - red_suivi_evenements : jalon réalisé, ou reporté (nouvelle date strictement postérieure et
--   motif obligatoire) ; un jalon réalisé ne reçoit plus d'événement.
-- Aucun statut de jalon ni alerte n'est stocké : l'état des jalons et les alertes internes sont
-- calculés à la lecture par le moteur (suivi.ts), à partir de la date du jour fournie par le serveur.
--
-- EXCEPTION DOCUMENTÉE : ces tables n'utilisent PAS red_controler_mission_ouverte (MPZ03). Elles
-- exigent au contraire que le dossier soit CLOS (MPZ19) et s'écrivent même quand la mission est
-- clôturée : le suivi post-mission commence après la clôture.
-- Garanties : MPZ19 écriture refusée tant que le dossier n'est pas clos ; MPZ20 suivi incohérent
-- (date de clôture différente de celle du dossier, jalon hors ordre ou avant la clôture, ratios
-- inconnus ou non entiers, événement sur un jalon réalisé, report non postérieur, relevé avant la
-- clôture) ; MPZ10 plafonds (12 jalons par plan, 10 relevés et 8 événements par jalon) ; MPZ01
-- ajout seul, et jalons nés dans la transaction de leur plan. Ratios en points de base (10 000 = 1).

-- Le dossier de la ligne (NEW.dossier_id) doit être clos.
CREATE FUNCTION red_suivi_controler_dossier_clos() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_statut text;
  BEGIN
    SELECT d.statut INTO v_statut FROM red_dossiers d
      WHERE d.id = (to_jsonb(NEW) ->> 'dossier_id')::uuid;
    IF v_statut IS DISTINCT FROM 'clos' THEN
      RAISE EXCEPTION 'Le suivi post-mission suit la clôture du dossier.' USING ERRCODE = 'MPZ19';
    END IF;
    RETURN NEW;
  END $$;

-- Vrai si l'objet n'est pas un ensemble valide de ratios suivis : clés de la liste fermée, valeurs
-- entières (points de base) de valeur absolue au plus 10^8.
CREATE FUNCTION red_suivi_ratios_invalides(p jsonb) RETURNS boolean
  LANGUAGE sql IMMUTABLE
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM jsonb_each(p) e
      WHERE e.key NOT IN ('liquidite_generale', 'liquidite_reduite', 'liquidite_immediate',
                          'autonomie_financiere', 'solvabilite_generale', 'endettement',
                          'marge_brute', 'marge_nette', 'couverture_charges_financieres')
         OR CASE WHEN jsonb_typeof(e.value) = 'number' AND e.value::text ~ '^-?[0-9]{1,9}$'
                 THEN abs((e.value::text)::bigint) > 100000000
                 ELSE true END) $$;

CREATE TABLE red_suivi_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  dossier_id uuid NOT NULL,
  -- Jour UTC de la clôture du dossier, base des échéances.
  date_cloture date NOT NULL CHECK (date_cloture BETWEEN '2000-01-01' AND '2100-12-31'),
  -- Référence de clôture : ratios (pb) du dernier état accepté ; vide sans état exploitable.
  reference_ratios jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(reference_ratios) = 'object' AND length(reference_ratios::text) <= 1000),
  reference_exercice int CHECK (reference_exercice IS NULL OR reference_exercice BETWEEN 1990 AND 2100),
  reference_correspondance_version int
    CHECK (reference_correspondance_version IS NULL OR reference_correspondance_version >= 1),
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, dossier_id, id),
  -- Un seul plan de suivi par dossier.
  UNIQUE (cabinet_id, dossier_id),
  FOREIGN KEY (cabinet_id, dossier_id) REFERENCES red_dossiers (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE red_suivi_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON red_suivi_plans
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON red_suivi_plans AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON red_suivi_plans FROM missionpilot_app;
CREATE TRIGGER red_suivi_plans_ajout_seul BEFORE UPDATE OR DELETE ON red_suivi_plans
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_redressement();
CREATE TRIGGER red_suivi_plans_00_dossier_clos BEFORE INSERT ON red_suivi_plans
  FOR EACH ROW EXECUTE FUNCTION red_suivi_controler_dossier_clos();

-- La date de clôture du plan est celle du dossier ; la référence est un ensemble valide de ratios.
CREATE FUNCTION red_suivi_controler_plan() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NEW.date_cloture IS DISTINCT FROM
       (SELECT (d.clos_le AT TIME ZONE 'UTC')::date FROM red_dossiers d WHERE d.id = NEW.dossier_id) THEN
      RAISE EXCEPTION 'La date de clôture du suivi est celle du dossier.' USING ERRCODE = 'MPZ20';
    END IF;
    IF red_suivi_ratios_invalides(NEW.reference_ratios) THEN
      RAISE EXCEPTION 'La référence de clôture porte des ratios invalides.' USING ERRCODE = 'MPZ20';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER red_suivi_plans_controle BEFORE INSERT ON red_suivi_plans
  FOR EACH ROW EXECUTE FUNCTION red_suivi_controler_plan();

CREATE TABLE red_suivi_jalons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  dossier_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  rang smallint NOT NULL CHECK (rang BETWEEN 1 AND 12),
  -- Échéance en mois après la clôture (calculée par le moteur), date prévue initiale.
  mois smallint NOT NULL CHECK (mois BETWEEN 1 AND 60),
  libelle text NOT NULL CHECK (length(libelle) BETWEEN 1 AND 120),
  date_prevue date NOT NULL CHECK (date_prevue BETWEEN '2000-01-01' AND '2100-12-31'),
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, dossier_id, id),
  UNIQUE (cabinet_id, plan_id, rang),
  FOREIGN KEY (cabinet_id, dossier_id) REFERENCES red_dossiers (cabinet_id, id),
  FOREIGN KEY (cabinet_id, dossier_id, plan_id)
    REFERENCES red_suivi_plans (cabinet_id, dossier_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE red_suivi_jalons ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON red_suivi_jalons
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON red_suivi_jalons AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON red_suivi_jalons FROM missionpilot_app;
CREATE TRIGGER red_suivi_jalons_ajout_seul BEFORE UPDATE OR DELETE ON red_suivi_jalons
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_redressement();
CREATE TRIGGER red_suivi_jalons_00_dossier_clos BEFORE INSERT ON red_suivi_jalons
  FOR EACH ROW EXECUTE FUNCTION red_suivi_controler_dossier_clos();
CREATE TRIGGER red_suivi_jalons_plafond BEFORE INSERT ON red_suivi_jalons
  FOR EACH ROW EXECUTE FUNCTION red_controler_plafond('plan_id', '12', 'jalons par plan de suivi');

-- Un jalon naît dans la transaction de son plan ; rang consécutif, date strictement postérieure à
-- celle du jalon précédent et à la clôture.
CREATE FUNCTION red_suivi_controler_jalon() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_cloture date;
    v_rang_precedent smallint;
    v_date_precedente date;
  BEGIN
    SELECT p.date_cloture INTO v_cloture FROM red_suivi_plans p
      WHERE p.id = NEW.plan_id AND p.cree_le = now();
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Les jalons naissent dans la transaction de leur plan de suivi.'
        USING ERRCODE = 'MPZ01';
    END IF;
    SELECT j.rang, j.date_prevue INTO v_rang_precedent, v_date_precedente
      FROM red_suivi_jalons j WHERE j.plan_id = NEW.plan_id ORDER BY j.rang DESC LIMIT 1;
    IF NEW.rang <> coalesce(v_rang_precedent, 0) + 1 THEN
      RAISE EXCEPTION 'Les rangs des jalons se suivent sans trou.' USING ERRCODE = 'MPZ20';
    END IF;
    IF NEW.date_prevue < v_cloture OR (v_date_precedente IS NOT NULL
                                      AND NEW.date_prevue <= v_date_precedente) THEN
      RAISE EXCEPTION 'Les dates des jalons sont croissantes et postérieures à la clôture.'
        USING ERRCODE = 'MPZ20';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER red_suivi_jalons_controle BEFORE INSERT ON red_suivi_jalons
  FOR EACH ROW EXECUTE FUNCTION red_suivi_controler_jalon();

CREATE TABLE red_suivi_releves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  dossier_id uuid NOT NULL,
  jalon_id uuid NOT NULL,
  date_releve date NOT NULL CHECK (date_releve BETWEEN '2000-01-01' AND '2100-12-31'),
  -- saisie : indicateurs saisis par le consultant ; instantane : ratios du dernier état accepté,
  -- calculés par le code serveur (moteur de ratios), avec exercice et version de correspondance.
  source text NOT NULL CHECK (source IN ('saisie', 'instantane')),
  ratios jsonb NOT NULL
    CHECK (jsonb_typeof(ratios) = 'object' AND ratios <> '{}'::jsonb AND length(ratios::text) <= 1000),
  correspondance_version int CHECK (correspondance_version IS NULL OR correspondance_version >= 1),
  exercice int CHECK (exercice IS NULL OR exercice BETWEEN 1990 AND 2100),
  commentaire text CHECK (commentaire IS NULL OR length(commentaire) BETWEEN 1 AND 1000),
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  CHECK (source = 'instantane' OR (correspondance_version IS NULL AND exercice IS NULL)),
  CHECK (source = 'saisie' OR exercice IS NOT NULL),
  FOREIGN KEY (cabinet_id, dossier_id) REFERENCES red_dossiers (cabinet_id, id),
  FOREIGN KEY (cabinet_id, dossier_id, jalon_id)
    REFERENCES red_suivi_jalons (cabinet_id, dossier_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX red_suivi_releves_jalon_idx ON red_suivi_releves (cabinet_id, jalon_id, date_releve, cree_le);
ALTER TABLE red_suivi_releves ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON red_suivi_releves
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON red_suivi_releves AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON red_suivi_releves FROM missionpilot_app;
CREATE TRIGGER red_suivi_releves_ajout_seul BEFORE UPDATE OR DELETE ON red_suivi_releves
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_redressement();
CREATE TRIGGER red_suivi_releves_00_dossier_clos BEFORE INSERT ON red_suivi_releves
  FOR EACH ROW EXECUTE FUNCTION red_suivi_controler_dossier_clos();
CREATE TRIGGER red_suivi_releves_plafond BEFORE INSERT ON red_suivi_releves
  FOR EACH ROW EXECUTE FUNCTION red_controler_plafond('jalon_id', '10', 'relevés par jalon de suivi');

-- Ratios valides, et relevé non antérieur à la clôture.
CREATE FUNCTION red_suivi_controler_releve() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_cloture date;
  BEGIN
    IF red_suivi_ratios_invalides(NEW.ratios) THEN
      RAISE EXCEPTION 'Le relevé porte des ratios invalides.' USING ERRCODE = 'MPZ20';
    END IF;
    SELECT p.date_cloture INTO v_cloture FROM red_suivi_jalons j
      JOIN red_suivi_plans p ON p.id = j.plan_id WHERE j.id = NEW.jalon_id;
    IF NEW.date_releve < v_cloture THEN
      RAISE EXCEPTION 'Un relevé ne précède pas la clôture du dossier.' USING ERRCODE = 'MPZ20';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER red_suivi_releves_controle BEFORE INSERT ON red_suivi_releves
  FOR EACH ROW EXECUTE FUNCTION red_suivi_controler_releve();

CREATE TABLE red_suivi_evenements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  dossier_id uuid NOT NULL,
  jalon_id uuid NOT NULL,
  type text NOT NULL CHECK (type IN ('realise', 'reporte')),
  -- Réalisé : date de réalisation ; reporté : nouvelle date prévue.
  date_effet date NOT NULL CHECK (date_effet BETWEEN '2000-01-01' AND '2100-12-31'),
  motif text CHECK (motif IS NULL OR length(motif) BETWEEN 1 AND 500),
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  CHECK (type <> 'reporte' OR motif IS NOT NULL),
  FOREIGN KEY (cabinet_id, dossier_id) REFERENCES red_dossiers (cabinet_id, id),
  FOREIGN KEY (cabinet_id, dossier_id, jalon_id)
    REFERENCES red_suivi_jalons (cabinet_id, dossier_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX red_suivi_evenements_jalon_idx ON red_suivi_evenements (cabinet_id, jalon_id, cree_le);
ALTER TABLE red_suivi_evenements ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON red_suivi_evenements
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON red_suivi_evenements AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON red_suivi_evenements FROM missionpilot_app;
CREATE TRIGGER red_suivi_evenements_ajout_seul BEFORE UPDATE OR DELETE ON red_suivi_evenements
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_redressement();
CREATE TRIGGER red_suivi_evenements_00_dossier_clos BEFORE INSERT ON red_suivi_evenements
  FOR EACH ROW EXECUTE FUNCTION red_suivi_controler_dossier_clos();
CREATE TRIGGER red_suivi_evenements_plafond BEFORE INSERT ON red_suivi_evenements
  FOR EACH ROW EXECUTE FUNCTION red_controler_plafond('jalon_id', '8', 'événements par jalon de suivi');

-- Un jalon réalisé ne bouge plus ; un report vise une date strictement postérieure à la date prévue
-- courante (dernier report, sinon date initiale) ; une réalisation ne précède pas la clôture.
CREATE FUNCTION red_suivi_controler_evenement() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_prevue date;
    v_cloture date;
    v_dernier_report date;
  BEGIN
    SELECT j.date_prevue, p.date_cloture INTO v_prevue, v_cloture FROM red_suivi_jalons j
      JOIN red_suivi_plans p ON p.id = j.plan_id WHERE j.id = NEW.jalon_id;
    IF EXISTS (SELECT 1 FROM red_suivi_evenements e
               WHERE e.jalon_id = NEW.jalon_id AND e.type = 'realise') THEN
      RAISE EXCEPTION 'Ce jalon est déjà réalisé.' USING ERRCODE = 'MPZ20';
    END IF;
    IF NEW.type = 'reporte' THEN
      SELECT e.date_effet INTO v_dernier_report FROM red_suivi_evenements e
        WHERE e.jalon_id = NEW.jalon_id AND e.type = 'reporte'
        ORDER BY e.cree_le DESC, e.id DESC LIMIT 1;
      IF NEW.date_effet <= coalesce(v_dernier_report, v_prevue) THEN
        RAISE EXCEPTION 'Un report vise une date postérieure à la date prévue courante.'
          USING ERRCODE = 'MPZ20';
      END IF;
    ELSIF NEW.date_effet < v_cloture THEN
      RAISE EXCEPTION 'Un jalon ne se réalise pas avant la clôture du dossier.'
        USING ERRCODE = 'MPZ20';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER red_suivi_evenements_controle BEFORE INSERT ON red_suivi_evenements
  FOR EACH ROW EXECUTE FUNCTION red_suivi_controler_evenement();
