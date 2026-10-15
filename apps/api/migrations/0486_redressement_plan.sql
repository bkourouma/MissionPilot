-- Redressement : plan à deux volets, kanban d'actions et versions de plan (RED-05, RED-07 en partie).
-- SQLSTATE : voir 0480.
--
-- - red_actions            : action du kanban (volet quick win ou restructuration), numérotée par
--   dossier ; seuls statut, rang et contenu (tant qu'elle n'est pas terminée) bougent ; un état
--   « terminee » ou « abandonnee » ne change plus ; rattachement facultatif à un levier du moteur
--   (le catalogue est FERMÉ dans packages/engines : pas de table de leviers) dont l'impact retenu
--   est conservé avec ses paramètres ; lien facultatif vers une tâche « Mes tâches » ;
-- - red_action_evenements  : historique des actions, EN AJOUT SEUL ;
-- - red_plan_versions      : instantané du plan soumis à validation. `contenu` et `empreinte` sont
--   construits par le code depuis les lignes red_actions (jamais reçus d'un client) ; seule
--   transition : brouillon -> valide, sur la DERNIÈRE version, par un associé ou un directeur de
--   mission qui n'en est pas le créateur (sauf associé) : MPZ07, doublé par l'API.

CREATE TABLE red_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  dossier_id uuid NOT NULL,
  -- Numérotée par dossier (déclencheur), à partir de 1.
  numero int NOT NULL,
  titre text NOT NULL CHECK (length(btrim(titre)) BETWEEN 1 AND 200),
  description text CHECK (description IS NULL OR length(description) BETWEEN 1 AND 2000),
  volet text NOT NULL CHECK (volet IN ('quick_win', 'restructuration')),
  domaine text NOT NULL
    CHECK (domaine IN ('tresorerie', 'activite', 'exploitation', 'social', 'financement')),
  echeance date NOT NULL CHECK (echeance BETWEEN '2000-01-01' AND '2100-12-31'),
  statut text NOT NULL DEFAULT 'a_faire'
    CHECK (statut IN ('a_faire', 'en_cours', 'bloquee', 'terminee', 'abandonnee')),
  -- Ordre dans la colonne du kanban.
  rang int NOT NULL DEFAULT 0 CHECK (rang BETWEEN 0 AND 100000),
  responsable_id uuid NOT NULL,
  levier_code text CHECK (levier_code IS NULL OR levier_code ~ '^[a-z0-9_]{1,40}$'),
  levier_parametres jsonb CHECK (levier_parametres IS NULL
    OR (jsonb_typeof(levier_parametres) = 'object' AND octet_length(levier_parametres::text) <= 2000)),
  -- Sortie du moteur (avec la base utilisée) : un instantané, relire l'action ne recalcule pas.
  impact jsonb CHECK (impact IS NULL
    OR (jsonb_typeof(impact) = 'object' AND octet_length(impact::text) <= 4000)),
  motif text CHECK (motif IS NULL OR length(motif) BETWEEN 1 AND 1000),
  termine_le date CHECK (termine_le IS NULL OR termine_le BETWEEN '2000-01-01' AND '2100-12-31'),
  tache_collaboration_id uuid,
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  modifie_par uuid,
  modifie_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, dossier_id, id),
  UNIQUE (cabinet_id, dossier_id, numero),
  CHECK ((levier_code IS NULL) = (levier_parametres IS NULL) AND (levier_code IS NULL) = (impact IS NULL)),
  CHECK ((statut = 'terminee') = (termine_le IS NOT NULL)),
  CHECK (statut NOT IN ('bloquee', 'abandonnee') OR motif IS NOT NULL),
  FOREIGN KEY (cabinet_id, dossier_id) REFERENCES red_dossiers (cabinet_id, id),
  FOREIGN KEY (cabinet_id, responsable_id) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, tache_collaboration_id) REFERENCES taches_collaboration (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, modifie_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX red_actions_kanban_idx
  ON red_actions (cabinet_id, dossier_id, statut, rang, echeance, id);
ALTER TABLE red_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON red_actions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON red_actions AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE DELETE ON red_actions FROM missionpilot_app;
-- Un compte du portail n'est jamais responsable (23503, traduit en 400 par l'API).
CREATE TRIGGER red_actions_responsable_sans_portail
  BEFORE INSERT OR UPDATE OF responsable_id ON red_actions
  FOR EACH ROW EXECUTE FUNCTION refuser_utilisateur_portail('responsable_id');

CREATE FUNCTION red_controler_action() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'INSERT' THEN
      IF NEW.statut <> 'a_faire' THEN
        RAISE EXCEPTION 'Une action naît à faire.' USING ERRCODE = 'MPZ06';
      END IF;
      SELECT coalesce(max(a.numero), 0) + 1 INTO NEW.numero
        FROM red_actions a WHERE a.dossier_id = NEW.dossier_id;
    ELSE
      IF (NEW.cabinet_id, NEW.dossier_id, NEW.numero, NEW.cree_par, NEW.cree_le)
         IS DISTINCT FROM (OLD.cabinet_id, OLD.dossier_id, OLD.numero, OLD.cree_par, OLD.cree_le) THEN
        RAISE EXCEPTION 'Dossier, numéro et création d''une action sont figés.'
          USING ERRCODE = 'MPZ04';
      END IF;
      IF OLD.statut IN ('terminee', 'abandonnee') AND NEW IS DISTINCT FROM OLD THEN
        RAISE EXCEPTION 'Une action terminée ou abandonnée ne change plus.' USING ERRCODE = 'MPZ06';
      END IF;
      IF NEW.statut IS DISTINCT FROM OLD.statut AND NOT (
           (OLD.statut = 'a_faire' AND NEW.statut IN ('en_cours', 'bloquee', 'terminee', 'abandonnee'))
           OR (OLD.statut = 'en_cours' AND NEW.statut IN ('bloquee', 'terminee', 'abandonnee'))
           OR (OLD.statut = 'bloquee' AND NEW.statut IN ('en_cours', 'abandonnee'))) THEN
        RAISE EXCEPTION 'Transition d''action invalide (% vers %).', OLD.statut, NEW.statut
          USING ERRCODE = 'MPZ06';
      END IF;
    END IF;
    NEW.modifie_le := now();
    RETURN NEW;
  END $$;
CREATE TRIGGER red_actions_controle BEFORE INSERT OR UPDATE ON red_actions
  FOR EACH ROW EXECUTE FUNCTION red_controler_action();
CREATE TRIGGER red_actions_01_mission_ouverte BEFORE INSERT OR UPDATE ON red_actions
  FOR EACH ROW EXECUTE FUNCTION red_controler_mission_ouverte();
-- Plafond des actions : 300 actions NON abandonnées par dossier (une action abandonnée libère sa place),
-- et 1 000 actions au total, abandonnées comprises (les lectures sont bornées par ce second plafond).
CREATE FUNCTION red_controler_plafond_actions() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_actives bigint;
    v_total bigint;
  BEGIN
    SELECT count(*) FILTER (WHERE a.statut <> 'abandonnee'), count(*) INTO v_actives, v_total
      FROM red_actions a WHERE a.dossier_id = NEW.dossier_id;
    IF v_actives >= 300 THEN
      RAISE EXCEPTION 'Plafond atteint : au plus 300 actions non abandonnées par dossier.'
        USING ERRCODE = 'MPZ10';
    END IF;
    IF v_total >= 1000 THEN
      RAISE EXCEPTION 'Plafond atteint : au plus 1000 actions par dossier, abandonnées comprises.'
        USING ERRCODE = 'MPZ10';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER red_actions_plafond BEFORE INSERT ON red_actions
  FOR EACH ROW EXECUTE FUNCTION red_controler_plafond_actions();

CREATE TABLE red_action_evenements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  dossier_id uuid NOT NULL,
  action_id uuid NOT NULL,
  type text NOT NULL CHECK (type IN ('creation', 'statut', 'modification', 'commentaire')),
  statut_avant text,
  statut_apres text NOT NULL,
  commentaire text CHECK (commentaire IS NULL OR length(commentaire) BETWEEN 1 AND 1000),
  auteur_id uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, dossier_id) REFERENCES red_dossiers (cabinet_id, id),
  FOREIGN KEY (cabinet_id, dossier_id, action_id) REFERENCES red_actions (cabinet_id, dossier_id, id),
  FOREIGN KEY (cabinet_id, auteur_id) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX red_action_evenements_idx
  ON red_action_evenements (cabinet_id, action_id, cree_le, id);
ALTER TABLE red_action_evenements ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON red_action_evenements
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON red_action_evenements AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON red_action_evenements FROM missionpilot_app;
CREATE TRIGGER red_action_evenements_ajout_seul BEFORE UPDATE OR DELETE ON red_action_evenements
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_redressement();
CREATE TRIGGER red_action_evenements_01_mission_ouverte BEFORE INSERT ON red_action_evenements
  FOR EACH ROW EXECUTE FUNCTION red_controler_mission_ouverte();
CREATE TRIGGER red_action_evenements_plafond BEFORE INSERT ON red_action_evenements
  FOR EACH ROW EXECUTE FUNCTION red_controler_plafond('action_id', '200', 'événements par action');

CREATE TABLE red_plan_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  dossier_id uuid NOT NULL,
  version int NOT NULL CHECK (version >= 1),
  -- Origine des fenêtres de 6 et de 24 mois.
  date_reference date NOT NULL CHECK (date_reference BETWEEN '2000-01-01' AND '2100-12-31'),
  -- Sortie de `serialiserPlanCanonique`, construite par le code depuis red_actions.
  -- 300 actions au plus (non abandonnées) de 200 caractères de titre (jusqu'à 4 octets chacun) : 400 Ko.
  contenu jsonb NOT NULL CHECK (jsonb_typeof(contenu) = 'object' AND octet_length(contenu::text) <= 400000),
  -- SHA-256 de la forme canonique, calculé par l'API.
  empreinte text NOT NULL CHECK (empreinte ~ '^[0-9a-f]{64}$'),
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
CREATE INDEX red_plan_versions_dossier_idx ON red_plan_versions (cabinet_id, dossier_id, version DESC);
ALTER TABLE red_plan_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON red_plan_versions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON red_plan_versions AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
-- Seule la validation (statut, valide_par, valide_le, motif_validation) modifie une ligne.
REVOKE UPDATE, DELETE ON red_plan_versions FROM missionpilot_app;
GRANT UPDATE (statut, valide_par, valide_le, motif_validation) ON red_plan_versions TO missionpilot_app;

CREATE FUNCTION red_controler_plan_version() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_derniere int;
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Une version de plan ne se supprime pas.' USING ERRCODE = 'MPZ01';
    END IF;
    IF TG_OP = 'INSERT' THEN
      IF NEW.statut <> 'brouillon' THEN
        RAISE EXCEPTION 'Une version de plan naît en brouillon.' USING ERRCODE = 'MPZ06';
      END IF;
      RETURN NEW;
    END IF;
    -- UPDATE : la seule transition admise est la validation.
    IF OLD.statut <> 'brouillon' OR NEW.statut <> 'valide' THEN
      RAISE EXCEPTION 'Seule la validation d''un brouillon est admise.' USING ERRCODE = 'MPZ06';
    END IF;
    IF (NEW.cabinet_id, NEW.dossier_id, NEW.version, NEW.date_reference, NEW.contenu, NEW.empreinte,
        NEW.cree_par, NEW.cree_le)
       IS DISTINCT FROM (OLD.cabinet_id, OLD.dossier_id, OLD.version, OLD.date_reference, OLD.contenu,
        OLD.empreinte, OLD.cree_par, OLD.cree_le) THEN
      RAISE EXCEPTION 'Le contenu d''une version de plan est figé.' USING ERRCODE = 'MPZ04';
    END IF;
    SELECT max(v.version) INTO v_derniere FROM red_plan_versions v WHERE v.dossier_id = NEW.dossier_id;
    IF NEW.version <> v_derniere THEN
      RAISE EXCEPTION 'Seule la dernière version du plan se valide.' USING ERRCODE = 'MPZ05';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM utilisateurs u
                   WHERE u.id = NEW.valide_par AND u.actif
                     AND u.roles && ARRAY['associe', 'directeur_mission']) THEN
      RAISE EXCEPTION 'Le plan est validé par un associé ou un directeur de mission actif.'
        USING ERRCODE = 'MPZ07';
    END IF;
    IF NEW.valide_par = NEW.cree_par AND NOT red_valideur_dispense(NEW.valide_par) THEN
      RAISE EXCEPTION 'Le créateur d''une version de plan ne la valide pas lui-même.'
        USING ERRCODE = 'MPZ07';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER red_plan_versions_controle BEFORE INSERT OR UPDATE OR DELETE ON red_plan_versions
  FOR EACH ROW EXECUTE FUNCTION red_controler_plan_version();
CREATE TRIGGER red_plan_versions_01_mission_ouverte BEFORE INSERT OR UPDATE ON red_plan_versions
  FOR EACH ROW EXECUTE FUNCTION red_controler_mission_ouverte();
CREATE TRIGGER red_plan_versions_plafond BEFORE INSERT ON red_plan_versions
  FOR EACH ROW EXECUTE FUNCTION red_controler_plafond('dossier_id', '100', 'versions de plan par dossier');
CREATE TRIGGER red_plan_versions_version BEFORE INSERT ON red_plan_versions
  FOR EACH ROW EXECUTE FUNCTION red_controler_version('dossier_id');
