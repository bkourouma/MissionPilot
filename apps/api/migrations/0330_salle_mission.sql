-- Salle de mission (CLI-01, PRD complémentaire §13 ; « document reçu », §8.2).
--
-- Liste de demandes documentaires d'une mission : le cabinet prépare une demande (depuis un
-- modèle, rattaché ou non à une méthode, ou pièce par pièce), l'envoie au client avec une
-- échéance, puis suit chaque pièce : demandée → reçue → acceptée, ou rejetée avec motif (puis
-- reçue de nouveau). Le client dépose ses fichiers depuis le portail ; un accusé de réception
-- automatique (classe R0, coupe-circuit N4 du cabinet respecté) est tracé ; les relances
-- graduées avant et après l'échéance sont tracées en ajout seul.
--
-- - salle_modeles : modèles du cabinet (pièces attendues), méthode facultative (standard ou
--   du cabinet, MPL04).
-- - salle_demandes : brouillon (tout se modifie, suppression admise) → envoyée (seules
--   l'échéance et les relances automatiques changent ; pièces ajoutables) → close
--   (définitive). Client = client de la mission (MPL04). Échéance exigée à l'envoi (CHECK).
-- - salle_pieces : pièces attendues ; modifiables et supprimables en brouillon seulement,
--   ajoutables tant que la demande n'est pas close (MPL05).
-- - salle_depots : fichiers déposés, EN AJOUT SEUL (MPL01) ; origine « portail » (utilisateur
--   du portail rattaché, actif, au client de la demande) ou « cabinet » (pièce reçue hors
--   portail, déposée par un membre du cabinet) ; demande envoyée et pièce non acceptée (MPL03).
-- - salle_piece_evenements : historique du statut, EN AJOUT SEUL (MPL01), rangs consécutifs
--   calculés ici ; le statut courant est celui du dernier rang (« demandée » sans événement).
--   Transitions (MPL02) : « reçue » depuis demandée, reçue ou rejetée (dépôt de la pièce, par
--   son déposant, demande envoyée) ; « acceptée » ou « rejetée » (motif obligatoire) depuis
--   reçue seulement, par un utilisateur du cabinet (jamais un rôle client).
-- - salle_accuses : accusé de réception d'un dépôt du portail (classe R0), EN AJOUT SEUL ;
--   « suspendu » si le coupe-circuit N4 du cabinet est actif ou le déposant inactif.
-- - salle_relances : relances (paliers automatiques ou manuelle), EN AJOUT SEUL ; un palier
--   automatique n'est inscrit qu'une fois par demande, échéance et destinataire.
--
-- Portail (politiques RESTRICTIVES, neutres hors portail) : demandes ENVOYÉES ou closes de SON
-- client, leurs pièces, événements, dépôts et accusés en lecture ; écriture limitée à SES dépôts
-- (origine portail) et à l'événement « reçue » qu'il signe ; modèles et relances invisibles.
--
-- SQLSTATE (lettre L, salle de mission) : MPL01 ajout seul ; MPL02 transition de statut d'une
-- pièce refusée ; MPL03 dépôt refusé ; MPL04 incohérence (mission, client, demande, pièce,
-- méthode) ; MPL05 demande ou pièce figée.

CREATE FUNCTION salle_ajout_seul() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    RAISE EXCEPTION 'Historique de la salle de mission en ajout seul.' USING ERRCODE = 'MPL01';
  END $$;

-- ---------------------------------------------------------------------------------------------
-- Modèles de demandes
-- ---------------------------------------------------------------------------------------------

CREATE TABLE salle_modeles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  nom text NOT NULL CHECK (length(btrim(nom)) BETWEEN 1 AND 200),
  description text CHECK (description IS NULL OR length(description) <= 2000),
  methode_id uuid REFERENCES methodes (id),
  -- [{ libelle, description, obligatoire }] validés par l'API (schéma partagé).
  pieces jsonb NOT NULL CHECK (jsonb_typeof(pieces) = 'array'
    AND jsonb_array_length(pieces) BETWEEN 1 AND 100 AND octet_length(pieces::text) <= 300000),
  actif boolean NOT NULL DEFAULT true,
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  modifie_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX salle_modeles_tri_idx ON salle_modeles (cabinet_id, lower(nom), id);
ALTER TABLE salle_modeles ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON salle_modeles
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON salle_modeles AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
-- Archivage (actif = faux) plutôt que suppression.
REVOKE UPDATE, DELETE ON salle_modeles FROM missionpilot_app;
GRANT UPDATE (nom, description, methode_id, pieces, actif, modifie_le) ON salle_modeles
  TO missionpilot_app;

/*
 * Méthode d'un modèle : du standard ou du même cabinet. Droits de l'appelant : pour le rôle
 * applicatif, une méthode d'un autre cabinet est invisible (RLS), donc refusée ; la condition
 * explicite sur le cabinet double cette barrière.
 */
CREATE FUNCTION controler_salle_modele() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'UPDATE' AND (NEW.cabinet_id, NEW.cree_par, NEW.cree_le)
       IS DISTINCT FROM (OLD.cabinet_id, OLD.cree_par, OLD.cree_le) THEN
      RAISE EXCEPTION 'Identité d''un modèle figée.' USING ERRCODE = 'MPL05';
    END IF;
    IF NEW.methode_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM methodes m WHERE m.id = NEW.methode_id
           AND (m.cabinet_id IS NULL OR m.cabinet_id = NEW.cabinet_id)) THEN
      RAISE EXCEPTION 'Méthode inconnue.' USING ERRCODE = 'MPL04';
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER salle_modeles_controle BEFORE INSERT OR UPDATE ON salle_modeles
  FOR EACH ROW EXECUTE FUNCTION controler_salle_modele();

-- ---------------------------------------------------------------------------------------------
-- Demandes documentaires
-- ---------------------------------------------------------------------------------------------

CREATE TABLE salle_demandes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  mission_id uuid NOT NULL,
  client_id uuid NOT NULL,
  modele_id uuid,
  titre text NOT NULL CHECK (length(btrim(titre)) BETWEEN 1 AND 200),
  message text CHECK (message IS NULL OR length(message) <= 4000),
  echeance date CHECK (echeance IS NULL OR echeance BETWEEN DATE '2000-01-01' AND DATE '2100-12-31'),
  statut text NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon', 'envoyee', 'close')),
  relances_auto boolean NOT NULL DEFAULT true,
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  modifie_le timestamptz NOT NULL DEFAULT now(),
  envoyee_par uuid,
  envoyee_le timestamptz,
  close_par uuid,
  close_le timestamptz,
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, mission_id) REFERENCES missions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, client_id) REFERENCES clients (cabinet_id, id),
  FOREIGN KEY (cabinet_id, modele_id) REFERENCES salle_modeles (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, envoyee_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, close_par) REFERENCES utilisateurs (cabinet_id, id),
  CHECK ((statut = 'brouillon') = (envoyee_le IS NULL)),
  CHECK ((envoyee_le IS NULL) = (envoyee_par IS NULL)),
  CHECK (statut = 'brouillon' OR echeance IS NOT NULL),
  CHECK ((statut = 'close') = (close_le IS NOT NULL)),
  CHECK ((close_le IS NULL) = (close_par IS NULL))
);
CREATE INDEX salle_demandes_mission_idx ON salle_demandes (cabinet_id, mission_id, cree_le DESC, id DESC);
CREATE INDEX salle_demandes_client_idx ON salle_demandes (cabinet_id, client_id, envoyee_le DESC, id DESC)
  WHERE statut <> 'brouillon';
ALTER TABLE salle_demandes ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON salle_demandes
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE UPDATE ON salle_demandes FROM missionpilot_app;
GRANT UPDATE (titre, message, echeance, statut, relances_auto, modifie_le, envoyee_par, envoyee_le,
  close_par, close_le) ON salle_demandes TO missionpilot_app;

CREATE FUNCTION controler_salle_demande() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      IF OLD.statut <> 'brouillon' THEN
        RAISE EXCEPTION 'Une demande envoyée ne se supprime pas : la clore.' USING ERRCODE = 'MPL05';
      END IF;
      RETURN OLD;
    END IF;
    IF TG_OP = 'INSERT' THEN
      IF NEW.statut <> 'brouillon' THEN
        RAISE EXCEPTION 'Une demande se crée en brouillon.' USING ERRCODE = 'MPL05';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM missions m
                     WHERE m.id = NEW.mission_id AND m.client_id = NEW.client_id) THEN
        RAISE EXCEPTION 'Client différent de celui de la mission.' USING ERRCODE = 'MPL04';
      END IF;
      RETURN NEW;
    END IF;
    IF (NEW.cabinet_id, NEW.mission_id, NEW.client_id, NEW.modele_id, NEW.cree_par, NEW.cree_le)
       IS DISTINCT FROM (OLD.cabinet_id, OLD.mission_id, OLD.client_id, OLD.modele_id, OLD.cree_par,
                         OLD.cree_le) THEN
      RAISE EXCEPTION 'Identité d''une demande figée.' USING ERRCODE = 'MPL05';
    END IF;
    IF OLD.statut = 'close' THEN
      RAISE EXCEPTION 'Demande close : définitive.' USING ERRCODE = 'MPL05';
    END IF;
    IF OLD.statut = 'envoyee' THEN
      IF NEW.statut = 'brouillon' OR (NEW.titre, NEW.message, NEW.envoyee_par, NEW.envoyee_le)
           IS DISTINCT FROM (OLD.titre, OLD.message, OLD.envoyee_par, OLD.envoyee_le) THEN
        RAISE EXCEPTION 'Demande envoyée : seules l''échéance et les relances changent.'
          USING ERRCODE = 'MPL05';
      END IF;
    ELSIF NEW.statut = 'close' THEN
      RAISE EXCEPTION 'Seule une demande envoyée se clôt.' USING ERRCODE = 'MPL05';
    ELSIF NEW.statut = 'envoyee'
          AND NOT EXISTS (SELECT 1 FROM salle_pieces p WHERE p.demande_id = NEW.id) THEN
      RAISE EXCEPTION 'Une demande sans pièce ne s''envoie pas.' USING ERRCODE = 'MPL05';
    END IF;
    RETURN NEW;
  END $$;

-- ---------------------------------------------------------------------------------------------
-- Pièces attendues
-- ---------------------------------------------------------------------------------------------

CREATE TABLE salle_pieces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  demande_id uuid NOT NULL,
  mission_id uuid NOT NULL,
  client_id uuid NOT NULL,
  libelle text NOT NULL CHECK (length(btrim(libelle)) BETWEEN 1 AND 200),
  description text CHECK (description IS NULL OR length(description) <= 2000),
  obligatoire boolean NOT NULL DEFAULT true,
  ordre integer NOT NULL CHECK (ordre BETWEEN 1 AND 1000),
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, demande_id) REFERENCES salle_demandes (cabinet_id, id),
  FOREIGN KEY (cabinet_id, mission_id) REFERENCES missions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, client_id) REFERENCES clients (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX salle_pieces_demande_idx ON salle_pieces (demande_id, ordre, id);
ALTER TABLE salle_pieces ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON salle_pieces
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE UPDATE ON salle_pieces FROM missionpilot_app;
GRANT UPDATE (libelle, description, obligatoire, ordre) ON salle_pieces TO missionpilot_app;

CREATE FUNCTION controler_salle_piece() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_statut text;
  BEGIN
    IF TG_OP = 'INSERT' THEN
      SELECT d.statut INTO v_statut FROM salle_demandes d
      WHERE d.id = NEW.demande_id AND d.mission_id = NEW.mission_id AND d.client_id = NEW.client_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Pièce incohérente avec sa demande.' USING ERRCODE = 'MPL04';
      END IF;
      IF v_statut = 'close' THEN
        RAISE EXCEPTION 'Demande close : aucune pièce ne s''y ajoute.' USING ERRCODE = 'MPL05';
      END IF;
      RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND (NEW.cabinet_id, NEW.demande_id, NEW.mission_id, NEW.client_id,
                             NEW.cree_par, NEW.cree_le)
       IS DISTINCT FROM (OLD.cabinet_id, OLD.demande_id, OLD.mission_id, OLD.client_id,
                         OLD.cree_par, OLD.cree_le) THEN
      RAISE EXCEPTION 'Identité d''une pièce figée.' USING ERRCODE = 'MPL05';
    END IF;
    SELECT d.statut INTO v_statut FROM salle_demandes d WHERE d.id = OLD.demande_id;
    IF v_statut IS DISTINCT FROM 'brouillon' THEN
      RAISE EXCEPTION 'Demande envoyée : ses pièces sont figées.' USING ERRCODE = 'MPL05';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END $$;

CREATE TRIGGER salle_pieces_controle BEFORE INSERT OR UPDATE OR DELETE ON salle_pieces
  FOR EACH ROW EXECUTE FUNCTION controler_salle_piece();

-- Déclencheur des demandes posé après la création des pièces (il les consulte à l'envoi).
CREATE TRIGGER salle_demandes_controle BEFORE INSERT OR UPDATE OR DELETE ON salle_demandes
  FOR EACH ROW EXECUTE FUNCTION controler_salle_demande();

-- ---------------------------------------------------------------------------------------------
-- Dépôts
-- ---------------------------------------------------------------------------------------------

CREATE TABLE salle_depots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  piece_id uuid NOT NULL,
  demande_id uuid NOT NULL,
  client_id uuid NOT NULL,
  fichier_id uuid NOT NULL,
  origine text NOT NULL CHECK (origine IN ('portail', 'cabinet')),
  depose_par uuid NOT NULL,
  depose_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (fichier_id),
  FOREIGN KEY (cabinet_id, piece_id) REFERENCES salle_pieces (cabinet_id, id),
  FOREIGN KEY (cabinet_id, demande_id) REFERENCES salle_demandes (cabinet_id, id),
  FOREIGN KEY (cabinet_id, client_id) REFERENCES clients (cabinet_id, id),
  FOREIGN KEY (cabinet_id, fichier_id) REFERENCES fichiers (cabinet_id, id),
  FOREIGN KEY (cabinet_id, depose_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX salle_depots_piece_idx ON salle_depots (piece_id, depose_le, id);
ALTER TABLE salle_depots ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON salle_depots
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE UPDATE, DELETE ON salle_depots FROM missionpilot_app;
CREATE TRIGGER salle_depots_ajout_seul BEFORE UPDATE OR DELETE ON salle_depots
  FOR EACH ROW EXECUTE FUNCTION salle_ajout_seul();

-- ---------------------------------------------------------------------------------------------
-- Historique des statuts des pièces
-- ---------------------------------------------------------------------------------------------

CREATE TABLE salle_piece_evenements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  piece_id uuid NOT NULL,
  client_id uuid NOT NULL,
  rang integer NOT NULL CHECK (rang BETWEEN 1 AND 10000),
  statut text NOT NULL CHECK (statut IN ('recue', 'acceptee', 'rejetee')),
  motif text CHECK (motif IS NULL OR length(btrim(motif)) BETWEEN 1 AND 1000),
  depot_id uuid,
  par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (piece_id, rang),
  FOREIGN KEY (cabinet_id, piece_id) REFERENCES salle_pieces (cabinet_id, id),
  FOREIGN KEY (cabinet_id, client_id) REFERENCES clients (cabinet_id, id),
  FOREIGN KEY (cabinet_id, depot_id) REFERENCES salle_depots (cabinet_id, id),
  FOREIGN KEY (cabinet_id, par) REFERENCES utilisateurs (cabinet_id, id),
  CHECK ((statut = 'rejetee') = (motif IS NOT NULL)),
  CHECK (statut <> 'recue' OR depot_id IS NOT NULL)
);
CREATE INDEX salle_piece_evenements_idx ON salle_piece_evenements (piece_id, rang DESC);
ALTER TABLE salle_piece_evenements ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON salle_piece_evenements
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE UPDATE, DELETE ON salle_piece_evenements FROM missionpilot_app;
CREATE TRIGGER salle_piece_evenements_ajout_seul BEFORE UPDATE OR DELETE ON salle_piece_evenements
  FOR EACH ROW EXECUTE FUNCTION salle_ajout_seul();

/** Statut courant d'une pièce (droits de l'appelant : RLS du cabinet et du portail). */
CREATE FUNCTION salle_statut_piece(p_piece uuid) RETURNS text
  LANGUAGE sql STABLE SET search_path = public, pg_temp
  AS $$
    SELECT coalesce((SELECT e.statut FROM salle_piece_evenements e
                     WHERE e.piece_id = p_piece ORDER BY e.rang DESC LIMIT 1), 'demandee') $$;

CREATE FUNCTION controler_salle_depot() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_demande uuid; v_client uuid;
  BEGIN
    NEW.depose_le := now();
    SELECT p.demande_id, p.client_id INTO v_demande, v_client FROM salle_pieces p
    WHERE p.id = NEW.piece_id;
    IF NOT FOUND OR v_demande <> NEW.demande_id OR v_client <> NEW.client_id THEN
      RAISE EXCEPTION 'Dépôt incohérent avec sa pièce.' USING ERRCODE = 'MPL04';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM salle_demandes d WHERE d.id = NEW.demande_id AND d.statut = 'envoyee') THEN
      RAISE EXCEPTION 'Cette demande n''accepte pas de dépôt.' USING ERRCODE = 'MPL03';
    END IF;
    IF salle_statut_piece(NEW.piece_id) = 'acceptee' THEN
      RAISE EXCEPTION 'Pièce déjà acceptée.' USING ERRCODE = 'MPL03';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM fichiers f WHERE f.id = NEW.fichier_id AND f.envoye_par = NEW.depose_par
                   AND NOT EXISTS (SELECT 1 FROM fichiers_suppressions s WHERE s.fichier_id = f.id)) THEN
      RAISE EXCEPTION 'Fichier absent ou d''un autre déposant.' USING ERRCODE = 'MPL03';
    END IF;
    IF NEW.origine = 'portail' THEN
      IF NOT EXISTS (SELECT 1 FROM utilisateurs_portail up
                     WHERE up.utilisateur_id = NEW.depose_par AND up.client_id = NEW.client_id
                       AND up.statut = 'actif') THEN
        RAISE EXCEPTION 'Déposant non rattaché au client.' USING ERRCODE = 'MPL03';
      END IF;
    ELSIF EXISTS (SELECT 1 FROM utilisateurs u WHERE u.id = NEW.depose_par
                  AND u.roles && ARRAY['client_dirigeant', 'client_contributeur', 'client_investisseur']) THEN
      RAISE EXCEPTION 'Un utilisateur du portail dépose par le portail.' USING ERRCODE = 'MPL03';
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER salle_depots_controle BEFORE INSERT ON salle_depots
  FOR EACH ROW EXECUTE FUNCTION controler_salle_depot();

CREATE FUNCTION controler_salle_evenement() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_client uuid; v_demande text; v_courant text; v_rang integer;
  BEGIN
    SELECT p.client_id, d.statut INTO v_client, v_demande
    FROM salle_pieces p JOIN salle_demandes d ON d.id = p.demande_id WHERE p.id = NEW.piece_id;
    IF NOT FOUND OR v_client <> NEW.client_id THEN
      RAISE EXCEPTION 'Événement incohérent avec sa pièce.' USING ERRCODE = 'MPL04';
    END IF;
    SELECT e.statut, e.rang INTO v_courant, v_rang FROM salle_piece_evenements e
    WHERE e.piece_id = NEW.piece_id ORDER BY e.rang DESC LIMIT 1;
    v_courant := coalesce(v_courant, 'demandee');
    NEW.rang := coalesce(v_rang, 0) + 1;
    NEW.cree_le := now();
    IF NEW.depot_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM salle_depots x WHERE x.id = NEW.depot_id AND x.piece_id = NEW.piece_id) THEN
      RAISE EXCEPTION 'Dépôt d''une autre pièce.' USING ERRCODE = 'MPL04';
    END IF;
    IF NEW.statut = 'recue' THEN
      IF v_demande <> 'envoyee' OR v_courant = 'acceptee' THEN
        RAISE EXCEPTION 'Cette pièce n''attend plus de dépôt.' USING ERRCODE = 'MPL02';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM salle_depots x WHERE x.id = NEW.depot_id AND x.depose_par = NEW.par) THEN
        RAISE EXCEPTION 'La réception est signée par le déposant.' USING ERRCODE = 'MPL02';
      END IF;
    ELSE
      IF v_demande = 'brouillon' OR v_courant <> 'recue' THEN
        RAISE EXCEPTION 'Seule une pièce reçue s''accepte ou se rejette.' USING ERRCODE = 'MPL02';
      END IF;
      IF EXISTS (SELECT 1 FROM utilisateurs u WHERE u.id = NEW.par
                 AND u.roles && ARRAY['client_dirigeant', 'client_contributeur', 'client_investisseur']) THEN
        RAISE EXCEPTION 'Décision réservée au cabinet.' USING ERRCODE = 'MPL02';
      END IF;
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER salle_piece_evenements_controle BEFORE INSERT ON salle_piece_evenements
  FOR EACH ROW EXECUTE FUNCTION controler_salle_evenement();

-- ---------------------------------------------------------------------------------------------
-- Accusés de réception (R0) et relances
-- ---------------------------------------------------------------------------------------------

CREATE TABLE salle_accuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  depot_id uuid NOT NULL,
  client_id uuid NOT NULL,
  destinataire_id uuid NOT NULL,
  notification_id uuid,
  statut text NOT NULL CHECK (statut IN ('envoye', 'suspendu')),
  classe_risque text NOT NULL DEFAULT 'R0' CHECK (classe_risque = 'R0'),
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (depot_id),
  FOREIGN KEY (cabinet_id, depot_id) REFERENCES salle_depots (cabinet_id, id),
  FOREIGN KEY (cabinet_id, client_id) REFERENCES clients (cabinet_id, id),
  FOREIGN KEY (cabinet_id, destinataire_id) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, notification_id) REFERENCES notifications (cabinet_id, id),
  CHECK ((statut = 'envoye') = (notification_id IS NOT NULL))
);
ALTER TABLE salle_accuses ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON salle_accuses
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE UPDATE, DELETE ON salle_accuses FROM missionpilot_app;
CREATE TRIGGER salle_accuses_ajout_seul BEFORE UPDATE OR DELETE ON salle_accuses
  FOR EACH ROW EXECUTE FUNCTION salle_ajout_seul();

CREATE TABLE salle_relances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  demande_id uuid NOT NULL,
  client_id uuid NOT NULL,
  palier text NOT NULL CHECK (palier IN ('rappel_j_moins_3', 'relance_j_plus_1', 'relance_j_plus_7',
                                         'manuelle')),
  echeance date NOT NULL,
  destinataire_id uuid NOT NULL,
  notification_id uuid NOT NULL,
  relance_par uuid,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, demande_id) REFERENCES salle_demandes (cabinet_id, id),
  FOREIGN KEY (cabinet_id, client_id) REFERENCES clients (cabinet_id, id),
  FOREIGN KEY (cabinet_id, destinataire_id) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, notification_id) REFERENCES notifications (cabinet_id, id),
  FOREIGN KEY (cabinet_id, relance_par) REFERENCES utilisateurs (cabinet_id, id),
  CHECK ((palier = 'manuelle') = (relance_par IS NOT NULL))
);
CREATE UNIQUE INDEX salle_relances_palier_uniq ON salle_relances (demande_id, palier, echeance, destinataire_id)
  WHERE palier <> 'manuelle';
CREATE INDEX salle_relances_demande_idx ON salle_relances (demande_id, cree_le DESC);
ALTER TABLE salle_relances ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON salle_relances
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON salle_relances AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON salle_relances FROM missionpilot_app;
CREATE TRIGGER salle_relances_ajout_seul BEFORE UPDATE OR DELETE ON salle_relances
  FOR EACH ROW EXECUTE FUNCTION salle_ajout_seul();

-- ---------------------------------------------------------------------------------------------
-- Portail client : lecture de SES demandes envoyées ; écriture de SES seuls dépôts.
-- Les sous-requêtes sont elles-mêmes filtrées par les politiques du portail.
-- ---------------------------------------------------------------------------------------------

CREATE POLICY portail ON salle_demandes AS RESTRICTIVE FOR SELECT
  USING (app_portail_client_id() IS NULL OR (
    client_id = app_portail_client_id() AND statut IN ('envoyee', 'close')));

CREATE POLICY portail ON salle_pieces AS RESTRICTIVE FOR SELECT
  USING (app_portail_client_id() IS NULL OR (
    client_id = app_portail_client_id()
    AND EXISTS (SELECT 1 FROM salle_demandes d WHERE d.id = salle_pieces.demande_id)));

CREATE POLICY portail ON salle_accuses AS RESTRICTIVE FOR SELECT
  USING (app_portail_client_id() IS NULL OR (
    client_id = app_portail_client_id()
    AND EXISTS (SELECT 1 FROM salle_depots x WHERE x.id = salle_accuses.depot_id)));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['salle_demandes', 'salle_pieces', 'salle_accuses'] LOOP
    EXECUTE format('CREATE POLICY portail_sans_insert ON %I AS RESTRICTIVE FOR INSERT
                      WITH CHECK (app_portail_client_id() IS NULL)', t);
    EXECUTE format('CREATE POLICY portail_sans_update ON %I AS RESTRICTIVE FOR UPDATE
                      USING (app_portail_client_id() IS NULL)', t);
    EXECUTE format('CREATE POLICY portail_sans_delete ON %I AS RESTRICTIVE FOR DELETE
                      USING (app_portail_client_id() IS NULL)', t);
  END LOOP;
END $$;

-- Tables d'ÉCRITURE du portail (ajout seul : UPDATE et DELETE révoqués) : lecture des lignes de
-- SON client sur une pièce visible ; insertion seulement de SON dépôt et de l'événement
-- « reçue » qu'il signe.
CREATE POLICY portail ON salle_depots AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL OR (
    client_id = app_portail_client_id()
    AND EXISTS (SELECT 1 FROM salle_pieces p WHERE p.id = salle_depots.piece_id)))
  WITH CHECK (app_portail_client_id() IS NULL OR (
    client_id = app_portail_client_id() AND origine = 'portail'
    AND depose_par = app_portail_utilisateur()
    AND EXISTS (SELECT 1 FROM salle_pieces p WHERE p.id = salle_depots.piece_id)));

CREATE POLICY portail ON salle_piece_evenements AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL OR (
    client_id = app_portail_client_id()
    AND EXISTS (SELECT 1 FROM salle_pieces p WHERE p.id = salle_piece_evenements.piece_id)))
  WITH CHECK (app_portail_client_id() IS NULL OR (
    client_id = app_portail_client_id() AND statut = 'recue'
    AND par = app_portail_utilisateur()
    AND EXISTS (SELECT 1 FROM salle_pieces p WHERE p.id = salle_piece_evenements.piece_id)));
