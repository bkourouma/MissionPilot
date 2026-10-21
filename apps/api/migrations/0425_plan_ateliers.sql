-- Ateliers stratégiques en ligne (PLA-15, PRD complémentaire §11.3) : un atelier est rattaché à un plan
-- stratégique ; cycle brouillon → ouvert → clos ; options à départager (2 à 50), méthodes activées
-- (vote par points, priorisation par classement, matrice impact/effort : au moins une) et participants
-- (membres du cabinet, dirigeants du client invités). Les contributions sont dans 0426 ; les agrégats
-- sortent du moteur (`packages/engines/src/plan-strategique/atelier.ts`) et sont FIGÉS à la clôture.
--
-- - `plan_ateliers` : l'atelier (titre, consigne, méthodes, budget de points, axes de la matrice) ;
--   `mission_id` et `client_id` sont DÉNORMALISÉS (contrôlés par déclencheur) pour la politique du
--   portail ; `resultats` (jsonb) n'est écrit qu'à la clôture, avec les faits chiffrés du moteur.
--   Contenu modifiable en brouillon seulement ; clos = figé ; aucune suppression.
-- - `plan_atelier_options` : options (rang de saisie, libellé, description) ; modifiables en brouillon.
-- - `plan_atelier_participants` : invitations en AJOUT SEUL ; un participant « client » est un
--   dirigeant actif du portail rattaché au client de la mission ; un participant « cabinet » est un
--   utilisateur actif du cabinet (la visibilité de la mission est contrôlée par l'API).
--
-- Portail (politiques RESTRICTIVES) : un dirigeant invité ne lit que les ateliers OUVERTS où il est
-- invité, leurs options et SA ligne de participant ; aucune écriture sur ces trois tables.
--
-- SQLSTATE (second préfixe « MQ », lettre L ; MQL01 à MQL09 réservés à ce chantier, CODING_STANDARDS §2) :
-- MQL01 atelier figé ou transition de cycle interdite ; MQL02 atelier incohérent (plan, mission, client,
-- ouverture sans deux options ni participant) ; MQL03 écriture refusée car l'atelier n'est pas dans le
-- bon état (options hors brouillon, invitation sur un atelier clos, contribution hors « ouvert ») ;
-- MQL04 participant inadmissible ou contribution d'un non-participant ; MQL05 contribution incohérente
-- (méthode non activée, version, budget de points, plafond par option, option d'un autre atelier) ;
-- MQL06 contribution incomplète ou classement non contigu ; MQL07 historique en ajout seul ;
-- MQL08 plafond atteint (100 ateliers par plan, 50 options, 100 participants, 20 versions d'une
-- contribution) ; MQL09 réservé.

CREATE FUNCTION atelier_ajout_seul() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    RAISE EXCEPTION 'Participants et contributions des ateliers : ajout seul.' USING ERRCODE = 'MQL07';
  END $$;

-- ---------------------------------------------------------------------------------------------
-- Ateliers
-- ---------------------------------------------------------------------------------------------

CREATE TABLE plan_ateliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  plan_id uuid NOT NULL,
  mission_id uuid NOT NULL,
  client_id uuid NOT NULL,
  titre text NOT NULL CHECK (length(btrim(titre)) BETWEEN 1 AND 200 AND titre !~ '[[:cntrl:]]'),
  consigne text NOT NULL DEFAULT '' CHECK (length(consigne) <= 4000),
  methode_vote boolean NOT NULL DEFAULT false,
  methode_priorisation boolean NOT NULL DEFAULT false,
  methode_matrice boolean NOT NULL DEFAULT false,
  budget_points smallint NOT NULL DEFAULT 10 CHECK (budget_points BETWEEN 1 AND 100),
  plafond_par_option smallint,
  axe_x_libelle text NOT NULL DEFAULT 'Valeur / impact'
    CHECK (length(btrim(axe_x_libelle)) BETWEEN 1 AND 60 AND axe_x_libelle !~ '[[:cntrl:]]'),
  axe_x_inverse boolean NOT NULL DEFAULT false,
  axe_y_libelle text NOT NULL DEFAULT 'Effort'
    CHECK (length(btrim(axe_y_libelle)) BETWEEN 1 AND 60 AND axe_y_libelle !~ '[[:cntrl:]]'),
  axe_y_inverse boolean NOT NULL DEFAULT true,
  statut text NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon', 'ouvert', 'clos')),
  -- Faits du moteur (SyntheseAtelier), figés à la clôture : jamais une contribution individuelle.
  resultats jsonb CHECK (resultats IS NULL OR (jsonb_typeof(resultats) = 'object'
    AND octet_length(resultats::text) <= 1000000)),
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  modifie_le timestamptz NOT NULL DEFAULT now(),
  ouvert_par uuid,
  ouvert_le timestamptz,
  clos_par uuid,
  clos_le timestamptz,
  UNIQUE (cabinet_id, id),
  CHECK (methode_vote OR methode_priorisation OR methode_matrice),
  CHECK (plafond_par_option IS NULL
    OR (plafond_par_option BETWEEN 1 AND 100 AND plafond_par_option <= budget_points)),
  CHECK ((statut = 'brouillon' AND ouvert_par IS NULL AND ouvert_le IS NULL AND clos_par IS NULL
          AND clos_le IS NULL AND resultats IS NULL)
      OR (statut = 'ouvert' AND ouvert_par IS NOT NULL AND ouvert_le IS NOT NULL AND clos_par IS NULL
          AND clos_le IS NULL AND resultats IS NULL)
      OR (statut = 'clos' AND ouvert_par IS NOT NULL AND ouvert_le IS NOT NULL AND clos_par IS NOT NULL
          AND clos_le IS NOT NULL AND resultats IS NOT NULL)),
  FOREIGN KEY (cabinet_id, plan_id) REFERENCES plans_strategiques (cabinet_id, id),
  FOREIGN KEY (cabinet_id, mission_id) REFERENCES missions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, client_id) REFERENCES clients (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, ouvert_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, clos_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX plan_ateliers_plan_idx ON plan_ateliers (cabinet_id, plan_id, cree_le DESC, id DESC);
CREATE INDEX plan_ateliers_client_idx ON plan_ateliers (client_id, statut);
ALTER TABLE plan_ateliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON plan_ateliers
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
-- Aucune suppression ; les colonnes de cycle se modifient sous le contrôle du déclencheur.
REVOKE DELETE ON plan_ateliers FROM missionpilot_app;

CREATE TRIGGER plan_ateliers_auteur_sans_portail BEFORE INSERT ON plan_ateliers
  FOR EACH ROW EXECUTE FUNCTION refuser_utilisateur_portail('cree_par');

CREATE FUNCTION controler_plan_atelier() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_mission uuid; v_client uuid; v_options integer; v_participants integer;
  BEGIN
    IF TG_OP = 'INSERT' THEN
      SELECT p.mission_id, m.client_id INTO v_mission, v_client
      FROM plans_strategiques p JOIN missions m ON m.id = p.mission_id
      WHERE p.id = NEW.plan_id AND p.cabinet_id = NEW.cabinet_id;
      IF v_mission IS DISTINCT FROM NEW.mission_id OR v_client IS DISTINCT FROM NEW.client_id THEN
        RAISE EXCEPTION 'Mission ou client de l''atelier incohérent avec son plan.' USING ERRCODE = 'MQL02';
      END IF;
      IF NEW.statut <> 'brouillon' THEN
        RAISE EXCEPTION 'Un atelier naît en brouillon.' USING ERRCODE = 'MQL01';
      END IF;
      IF (SELECT count(*) FROM plan_ateliers a WHERE a.plan_id = NEW.plan_id) >= 100 THEN
        RAISE EXCEPTION 'Plafond de 100 ateliers par plan atteint.' USING ERRCODE = 'MQL08';
      END IF;
      RETURN NEW;
    END IF;
    -- UPDATE : identité figée.
    IF (NEW.cabinet_id, NEW.plan_id, NEW.mission_id, NEW.client_id, NEW.cree_par, NEW.cree_le)
       IS DISTINCT FROM (OLD.cabinet_id, OLD.plan_id, OLD.mission_id, OLD.client_id, OLD.cree_par,
                         OLD.cree_le) THEN
      RAISE EXCEPTION 'Identité d''un atelier figée.' USING ERRCODE = 'MQL01';
    END IF;
    IF OLD.statut = 'clos' THEN
      RAISE EXCEPTION 'Atelier clos : définitif.' USING ERRCODE = 'MQL01';
    END IF;
    IF OLD.statut = 'ouvert' AND NEW.statut = 'ouvert' AND NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'Atelier ouvert : le contenu ne se modifie plus.' USING ERRCODE = 'MQL01';
    END IF;
    IF (OLD.statut, NEW.statut) NOT IN (('brouillon', 'brouillon'), ('brouillon', 'ouvert'),
                                         ('ouvert', 'ouvert'), ('ouvert', 'clos')) THEN
      RAISE EXCEPTION 'Transition de statut interdite.' USING ERRCODE = 'MQL01';
    END IF;
    IF NEW.statut <> OLD.statut THEN
      -- Ouverture ou clôture : le contenu ne bouge pas en même temps.
      IF (NEW.titre, NEW.consigne, NEW.methode_vote, NEW.methode_priorisation, NEW.methode_matrice,
          NEW.budget_points, NEW.plafond_par_option, NEW.axe_x_libelle, NEW.axe_x_inverse,
          NEW.axe_y_libelle, NEW.axe_y_inverse)
         IS DISTINCT FROM
         (OLD.titre, OLD.consigne, OLD.methode_vote, OLD.methode_priorisation, OLD.methode_matrice,
          OLD.budget_points, OLD.plafond_par_option, OLD.axe_x_libelle, OLD.axe_x_inverse,
          OLD.axe_y_libelle, OLD.axe_y_inverse) THEN
        RAISE EXCEPTION 'Le contenu ne change pas avec le statut.' USING ERRCODE = 'MQL01';
      END IF;
    END IF;
    IF OLD.statut = 'brouillon' AND NEW.statut = 'ouvert' THEN
      SELECT count(*) INTO v_options FROM plan_atelier_options o WHERE o.atelier_id = NEW.id;
      SELECT count(*) INTO v_participants FROM plan_atelier_participants p WHERE p.atelier_id = NEW.id;
      IF v_options < 2 OR v_participants < 1 THEN
        RAISE EXCEPTION 'Ouverture : au moins deux options et un participant.' USING ERRCODE = 'MQL02';
      END IF;
    END IF;
    IF OLD.statut = 'ouvert' AND NEW.statut = 'clos'
       AND (NEW.ouvert_par, NEW.ouvert_le) IS DISTINCT FROM (OLD.ouvert_par, OLD.ouvert_le) THEN
      RAISE EXCEPTION 'Ouverture figée.' USING ERRCODE = 'MQL01';
    END IF;
    RETURN NEW;
  END $$;

-- Options et participants sont créés après : la fonction ne les lit qu'à l'exécution.
CREATE TRIGGER plan_ateliers_controle BEFORE INSERT OR UPDATE ON plan_ateliers
  FOR EACH ROW EXECUTE FUNCTION controler_plan_atelier();

-- ---------------------------------------------------------------------------------------------
-- Options
-- ---------------------------------------------------------------------------------------------

CREATE TABLE plan_atelier_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  atelier_id uuid NOT NULL,
  rang smallint NOT NULL CHECK (rang BETWEEN 1 AND 50),
  libelle text NOT NULL CHECK (length(btrim(libelle)) BETWEEN 1 AND 200 AND libelle !~ '[[:cntrl:]]'),
  description text CHECK (description IS NULL OR length(description) <= 500),
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, atelier_id, id),
  UNIQUE (atelier_id, rang),
  FOREIGN KEY (cabinet_id, atelier_id) REFERENCES plan_ateliers (cabinet_id, id)
);
ALTER TABLE plan_atelier_options ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON plan_atelier_options
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());

CREATE FUNCTION controler_plan_atelier_option() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_atelier uuid := COALESCE(NEW.atelier_id, OLD.atelier_id); v_statut text;
  BEGIN
    SELECT a.statut INTO v_statut FROM plan_ateliers a WHERE a.id = v_atelier;
    IF v_statut IS DISTINCT FROM 'brouillon' THEN
      RAISE EXCEPTION 'Les options ne se modifient qu''en brouillon.' USING ERRCODE = 'MQL03';
    END IF;
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE' AND (NEW.cabinet_id, NEW.atelier_id) IS DISTINCT FROM (OLD.cabinet_id, OLD.atelier_id) THEN
      RAISE EXCEPTION 'Atelier d''une option figé.' USING ERRCODE = 'MQL01';
    END IF;
    IF TG_OP = 'INSERT' AND (SELECT count(*) FROM plan_atelier_options o WHERE o.atelier_id = NEW.atelier_id) >= 50 THEN
      RAISE EXCEPTION 'Plafond de 50 options par atelier atteint.' USING ERRCODE = 'MQL08';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER plan_atelier_options_controle BEFORE INSERT OR UPDATE OR DELETE ON plan_atelier_options
  FOR EACH ROW EXECUTE FUNCTION controler_plan_atelier_option();

-- ---------------------------------------------------------------------------------------------
-- Participants (ajout seul)
-- ---------------------------------------------------------------------------------------------

CREATE TABLE plan_atelier_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  atelier_id uuid NOT NULL,
  utilisateur_id uuid NOT NULL,
  partie text NOT NULL CHECK (partie IN ('cabinet', 'client')),
  -- Client du dirigeant invité (celui de l'atelier) ; nul pour un membre du cabinet.
  client_id uuid,
  invite_par uuid NOT NULL,
  invite_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, atelier_id, id),
  UNIQUE (atelier_id, utilisateur_id),
  CHECK ((partie = 'client') = (client_id IS NOT NULL)),
  FOREIGN KEY (cabinet_id, atelier_id) REFERENCES plan_ateliers (cabinet_id, id),
  FOREIGN KEY (cabinet_id, utilisateur_id) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, client_id) REFERENCES clients (cabinet_id, id),
  FOREIGN KEY (cabinet_id, invite_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX plan_atelier_participants_utilisateur_idx
  ON plan_atelier_participants (utilisateur_id, atelier_id);
ALTER TABLE plan_atelier_participants ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON plan_atelier_participants
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE UPDATE, DELETE ON plan_atelier_participants FROM missionpilot_app;

CREATE TRIGGER plan_atelier_participants_ajout_seul BEFORE UPDATE OR DELETE ON plan_atelier_participants
  FOR EACH ROW EXECUTE FUNCTION atelier_ajout_seul();
CREATE TRIGGER plan_atelier_participants_invitant_sans_portail BEFORE INSERT ON plan_atelier_participants
  FOR EACH ROW EXECUTE FUNCTION refuser_utilisateur_portail('invite_par');

CREATE FUNCTION controler_plan_atelier_participant() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_statut text; v_client uuid;
  BEGIN
    SELECT a.statut, a.client_id INTO v_statut, v_client FROM plan_ateliers a WHERE a.id = NEW.atelier_id;
    IF v_statut IS NULL OR v_statut = 'clos' THEN
      RAISE EXCEPTION 'On n''invite pas sur un atelier clos.' USING ERRCODE = 'MQL03';
    END IF;
    IF NEW.partie = 'client' THEN
      IF NEW.client_id IS DISTINCT FROM v_client OR NOT EXISTS (
           SELECT 1 FROM utilisateurs_portail up JOIN utilisateurs u ON u.id = up.utilisateur_id
           WHERE up.utilisateur_id = NEW.utilisateur_id AND up.client_id = v_client
             AND up.statut = 'actif' AND u.actif AND 'client_dirigeant' = ANY (u.roles)) THEN
        RAISE EXCEPTION 'Seul un dirigeant actif du client de la mission est invitable.' USING ERRCODE = 'MQL04';
      END IF;
    ELSIF NOT EXISTS (
            SELECT 1 FROM utilisateurs u WHERE u.id = NEW.utilisateur_id AND u.actif
              AND NOT (u.roles && ARRAY['client_dirigeant', 'client_contributeur', 'client_investisseur'])) THEN
      RAISE EXCEPTION 'Seul un membre actif du cabinet est invitable comme membre du cabinet.' USING ERRCODE = 'MQL04';
    END IF;
    IF (SELECT count(*) FROM plan_atelier_participants p WHERE p.atelier_id = NEW.atelier_id) >= 100 THEN
      RAISE EXCEPTION 'Plafond de 100 participants par atelier atteint.' USING ERRCODE = 'MQL08';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER plan_atelier_participants_controle BEFORE INSERT ON plan_atelier_participants
  FOR EACH ROW EXECUTE FUNCTION controler_plan_atelier_participant();

-- ---------------------------------------------------------------------------------------------
-- Portail : lecture de SES ateliers ouverts, de leurs options et de SA ligne de participant.
-- Les sous-requêtes sont elles-mêmes filtrées par les politiques du portail (participants d'abord :
-- sa politique ne dépend d'aucune autre table, sinon la récursion serait infinie).
-- ---------------------------------------------------------------------------------------------

CREATE POLICY portail ON plan_atelier_participants AS RESTRICTIVE FOR SELECT
  USING (app_portail_client_id() IS NULL OR (
    client_id = app_portail_client_id() AND utilisateur_id = app_portail_utilisateur()));

CREATE POLICY portail ON plan_ateliers AS RESTRICTIVE FOR SELECT
  USING (app_portail_client_id() IS NULL OR (
    client_id = app_portail_client_id() AND statut = 'ouvert'
    AND EXISTS (SELECT 1 FROM plan_atelier_participants p
                WHERE p.atelier_id = plan_ateliers.id AND p.utilisateur_id = app_portail_utilisateur())));

CREATE POLICY portail ON plan_atelier_options AS RESTRICTIVE FOR SELECT
  USING (app_portail_client_id() IS NULL OR EXISTS (
    SELECT 1 FROM plan_ateliers a WHERE a.id = plan_atelier_options.atelier_id));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['plan_ateliers', 'plan_atelier_options', 'plan_atelier_participants'] LOOP
    EXECUTE format('CREATE POLICY portail_sans_insert ON %I AS RESTRICTIVE FOR INSERT
                      WITH CHECK (app_portail_client_id() IS NULL)', t);
    EXECUTE format('CREATE POLICY portail_sans_update ON %I AS RESTRICTIVE FOR UPDATE
                      USING (app_portail_client_id() IS NULL)', t);
    EXECUTE format('CREATE POLICY portail_sans_delete ON %I AS RESTRICTIVE FOR DELETE
                      USING (app_portail_client_id() IS NULL)', t);
  END LOOP;
END $$;
