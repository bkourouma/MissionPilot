-- Contributions aux ateliers stratégiques (PLA-15) : vote par points, classement, positions dans la
-- matrice. EN AJOUT SEUL : remplacer sa contribution crée une NOUVELLE VERSION (la courante est la plus
-- haute), l'ancienne reste en base pour l'audit. Jamais servies individuellement par l'API (anonymat) :
-- seuls les agrégats du moteur le sont, après la clôture.
--
-- - `plan_atelier_contributions` : en-tête (participant, méthode, version) ; `nombre_lignes` annonce le
--   nombre de lignes, contrôlé à la validation de la transaction (déclencheur différé, MQL06) : une
--   contribution est atomique et ne peut plus être complétée après coup.
-- - `plan_atelier_contribution_lignes` : une ligne par option (points, rang ou position x/y) ;
--   doublon d'option refusé (UNIQUE), option d'un autre atelier refusée (MQL05), budget de points et
--   plafond par option respectés (MQL05), rangs contigus 1..n (MQL06).
--
-- Écriture : atelier OUVERT seulement (MQL03), participant invité de l'atelier, pour lui-même (MQL04),
-- méthode activée (MQL05). Un atelier clos est donc immuable. Plafond de 20 versions par participant
-- et méthode (MQL08). Un verrou consultatif partagé sur l'atelier (API) sérialise avec la clôture.
--
-- Portail : politique `portail` FOR ALL restreinte à SON client, SON utilisateur et à un atelier
-- ouvert où il est invité (modèle 0330, `salle_depots`). SQLSTATE : voir 0425.

CREATE TABLE plan_atelier_contributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  atelier_id uuid NOT NULL,
  participant_id uuid NOT NULL,
  utilisateur_id uuid NOT NULL,
  -- Client du dirigeant (portail) ; nul pour un membre du cabinet.
  client_id uuid,
  methode text NOT NULL CHECK (methode IN ('vote', 'priorisation', 'matrice')),
  version integer NOT NULL CHECK (version BETWEEN 1 AND 20),
  nombre_lignes smallint NOT NULL CHECK (nombre_lignes BETWEEN 1 AND 50),
  depose_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, id, atelier_id, methode),
  UNIQUE (participant_id, methode, version),
  FOREIGN KEY (cabinet_id, atelier_id) REFERENCES plan_ateliers (cabinet_id, id),
  FOREIGN KEY (cabinet_id, atelier_id, participant_id)
    REFERENCES plan_atelier_participants (cabinet_id, atelier_id, id),
  FOREIGN KEY (cabinet_id, utilisateur_id) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, client_id) REFERENCES clients (cabinet_id, id)
);
CREATE INDEX plan_atelier_contributions_atelier_idx
  ON plan_atelier_contributions (cabinet_id, atelier_id, participant_id, methode, version DESC);
ALTER TABLE plan_atelier_contributions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON plan_atelier_contributions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE UPDATE, DELETE ON plan_atelier_contributions FROM missionpilot_app;
CREATE TRIGGER plan_atelier_contributions_ajout_seul BEFORE UPDATE OR DELETE ON plan_atelier_contributions
  FOR EACH ROW EXECUTE FUNCTION atelier_ajout_seul();

CREATE FUNCTION controler_plan_atelier_contribution() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_statut text; v_vote boolean; v_prio boolean; v_matrice boolean; v_client uuid;
    v_p_utilisateur uuid; v_p_client uuid; v_max integer;
  BEGIN
    SELECT a.statut, a.methode_vote, a.methode_priorisation, a.methode_matrice, a.client_id
      INTO v_statut, v_vote, v_prio, v_matrice, v_client
    FROM plan_ateliers a WHERE a.id = NEW.atelier_id;
    IF v_statut IS DISTINCT FROM 'ouvert' THEN
      RAISE EXCEPTION 'Les contributions ne s''écrivent que sur un atelier ouvert.' USING ERRCODE = 'MQL03';
    END IF;
    IF NOT (CASE NEW.methode WHEN 'vote' THEN v_vote WHEN 'priorisation' THEN v_prio ELSE v_matrice END) THEN
      RAISE EXCEPTION 'Méthode non activée pour cet atelier.' USING ERRCODE = 'MQL05';
    END IF;
    SELECT p.utilisateur_id, p.client_id INTO v_p_utilisateur, v_p_client
    FROM plan_atelier_participants p WHERE p.id = NEW.participant_id AND p.atelier_id = NEW.atelier_id;
    IF v_p_utilisateur IS DISTINCT FROM NEW.utilisateur_id
       OR v_p_client IS DISTINCT FROM NEW.client_id THEN
      RAISE EXCEPTION 'Contribution d''un utilisateur qui n''est pas participant de l''atelier.' USING ERRCODE = 'MQL04';
    END IF;
    SELECT max(c.version) INTO v_max FROM plan_atelier_contributions c
    WHERE c.participant_id = NEW.participant_id AND c.methode = NEW.methode;
    IF NEW.version > 20 THEN
      RAISE EXCEPTION 'Plafond de 20 versions d''une contribution atteint.' USING ERRCODE = 'MQL08';
    END IF;
    IF NEW.version <> coalesce(v_max, 0) + 1 THEN
      RAISE EXCEPTION 'Numéro de version inattendu.' USING ERRCODE = 'MQL05';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER plan_atelier_contributions_controle BEFORE INSERT ON plan_atelier_contributions
  FOR EACH ROW EXECUTE FUNCTION controler_plan_atelier_contribution();

CREATE TABLE plan_atelier_contribution_lignes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  contribution_id uuid NOT NULL,
  atelier_id uuid NOT NULL,
  methode text NOT NULL,
  option_id uuid NOT NULL,
  points smallint CHECK (points BETWEEN 0 AND 100),
  rang smallint CHECK (rang BETWEEN 1 AND 50),
  x smallint CHECK (x BETWEEN 1 AND 5),
  y smallint CHECK (y BETWEEN 1 AND 5),
  UNIQUE (cabinet_id, id),
  UNIQUE (contribution_id, option_id),
  UNIQUE (contribution_id, rang),
  CHECK ((methode = 'vote' AND points IS NOT NULL AND rang IS NULL AND x IS NULL AND y IS NULL)
      OR (methode = 'priorisation' AND rang IS NOT NULL AND points IS NULL AND x IS NULL AND y IS NULL)
      OR (methode = 'matrice' AND x IS NOT NULL AND y IS NOT NULL AND points IS NULL AND rang IS NULL)),
  FOREIGN KEY (cabinet_id, contribution_id, atelier_id, methode)
    REFERENCES plan_atelier_contributions (cabinet_id, id, atelier_id, methode),
  FOREIGN KEY (cabinet_id, atelier_id, option_id)
    REFERENCES plan_atelier_options (cabinet_id, atelier_id, id)
);
CREATE INDEX plan_atelier_contribution_lignes_idx
  ON plan_atelier_contribution_lignes (cabinet_id, contribution_id);
ALTER TABLE plan_atelier_contribution_lignes ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON plan_atelier_contribution_lignes
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE UPDATE, DELETE ON plan_atelier_contribution_lignes FROM missionpilot_app;
CREATE TRIGGER plan_atelier_contribution_lignes_ajout_seul
  BEFORE UPDATE OR DELETE ON plan_atelier_contribution_lignes
  FOR EACH ROW EXECUTE FUNCTION atelier_ajout_seul();

CREATE FUNCTION controler_plan_atelier_ligne() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_statut text; v_budget integer; v_plafond integer; v_attendues integer; v_existantes integer;
    v_somme integer;
  BEGIN
    SELECT a.statut, a.budget_points, a.plafond_par_option INTO v_statut, v_budget, v_plafond
    FROM plan_ateliers a WHERE a.id = NEW.atelier_id;
    IF v_statut IS DISTINCT FROM 'ouvert' THEN
      RAISE EXCEPTION 'Les contributions ne s''écrivent que sur un atelier ouvert.' USING ERRCODE = 'MQL03';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM plan_atelier_options o
                   WHERE o.id = NEW.option_id AND o.atelier_id = NEW.atelier_id) THEN
      RAISE EXCEPTION 'Option inconnue de cet atelier.' USING ERRCODE = 'MQL05';
    END IF;
    SELECT c.nombre_lignes INTO v_attendues FROM plan_atelier_contributions c
    WHERE c.id = NEW.contribution_id AND c.atelier_id = NEW.atelier_id AND c.methode = NEW.methode;
    IF v_attendues IS NULL THEN
      RAISE EXCEPTION 'Contribution inconnue.' USING ERRCODE = 'MQL06';
    END IF;
    SELECT count(*), coalesce(sum(l.points), 0) INTO v_existantes, v_somme
    FROM plan_atelier_contribution_lignes l WHERE l.contribution_id = NEW.contribution_id;
    IF v_existantes + 1 > v_attendues THEN
      RAISE EXCEPTION 'Plus de lignes que la contribution n''en annonce.' USING ERRCODE = 'MQL06';
    END IF;
    IF NEW.methode = 'vote' THEN
      IF v_somme + NEW.points > v_budget THEN
        RAISE EXCEPTION 'Budget de points dépassé.' USING ERRCODE = 'MQL05';
      END IF;
      IF v_plafond IS NOT NULL AND NEW.points > v_plafond THEN
        RAISE EXCEPTION 'Plafond de points par option dépassé.' USING ERRCODE = 'MQL05';
      END IF;
    ELSIF NEW.methode = 'priorisation' AND NEW.rang <> v_existantes + 1 THEN
      RAISE EXCEPTION 'Classement : rangs contigus à partir de 1 attendus.' USING ERRCODE = 'MQL06';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER plan_atelier_contribution_lignes_controle BEFORE INSERT ON plan_atelier_contribution_lignes
  FOR EACH ROW EXECUTE FUNCTION controler_plan_atelier_ligne();

-- Contribution complète à la validation de la transaction : autant de lignes que d'annoncées.
CREATE FUNCTION controler_plan_atelier_contribution_complete() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF (SELECT count(*) FROM plan_atelier_contribution_lignes l WHERE l.contribution_id = NEW.id)
       <> NEW.nombre_lignes THEN
      RAISE EXCEPTION 'Contribution incomplète : le nombre de lignes annoncé n''est pas atteint.' USING ERRCODE = 'MQL06';
    END IF;
    RETURN NULL;
  END $$;
CREATE CONSTRAINT TRIGGER plan_atelier_contributions_complete AFTER INSERT ON plan_atelier_contributions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION controler_plan_atelier_contribution_complete();

-- ---------------------------------------------------------------------------------------------
-- Portail : SES contributions à un atelier ouvert où il est invité (tables d'écriture du portail).
-- ---------------------------------------------------------------------------------------------

CREATE POLICY portail ON plan_atelier_contributions AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL OR (
    client_id = app_portail_client_id() AND utilisateur_id = app_portail_utilisateur()
    AND EXISTS (SELECT 1 FROM plan_ateliers a WHERE a.id = plan_atelier_contributions.atelier_id)
    AND EXISTS (SELECT 1 FROM plan_atelier_participants p
                WHERE p.id = plan_atelier_contributions.participant_id)))
  WITH CHECK (app_portail_client_id() IS NULL OR (
    client_id = app_portail_client_id() AND utilisateur_id = app_portail_utilisateur()
    AND EXISTS (SELECT 1 FROM plan_ateliers a WHERE a.id = plan_atelier_contributions.atelier_id)
    AND EXISTS (SELECT 1 FROM plan_atelier_participants p
                WHERE p.id = plan_atelier_contributions.participant_id)));

CREATE POLICY portail ON plan_atelier_contribution_lignes AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL OR EXISTS (
    SELECT 1 FROM plan_atelier_contributions c WHERE c.id = plan_atelier_contribution_lignes.contribution_id))
  WITH CHECK (app_portail_client_id() IS NULL OR EXISTS (
    SELECT 1 FROM plan_atelier_contributions c WHERE c.id = plan_atelier_contribution_lignes.contribution_id));
