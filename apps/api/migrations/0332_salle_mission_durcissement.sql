-- Salle de mission (CLI-01) : durcissement d'audit. Redéfinit par CREATE OR REPLACE les trois
-- fonctions de contrôle de 0330 (les déclencheurs existants les appellent par leur nom) et ajoute
-- un déclencheur sur `missions`. Numéro après 0330 : les tables citées existent.
--
-- 1. Plafonds des dépôts (déni de service : un client ne remplit pas le quota de stockage du
--    cabinet) : au plus 20 dépôts non rejetés et non retirés par pièce, 500 Mo de dépôts non
--    retirés par demande, 30 dépôts du portail par utilisateur et par fenêtre de 10 minutes.
--    Mêmes valeurs que `SALLE_DEPOTS_PAR_PIECE_MAX`, `SALLE_OCTETS_PAR_DEMANDE_MAX`,
--    `SALLE_DEPOTS_PORTAIL_PAR_FENETRE_MAX` et `SALLE_FENETRE_DEPOTS_PORTAIL_MINUTES`
--    (packages/shared/src/schemas/salle-mission.ts), répétées ici en littéraux. Le débit se compte
--    sur `salle_depots` (le journal d'audit est invisible d'une transaction du portail).
-- 2. Mission clôturée : aucun dépôt, aucun envoi ni aucune création de demande ; une mission ne se
--    clôt pas tant qu'une de ses demandes est « envoyée » (l'API les clôt d'abord, dans la même
--    transaction). Une demande envoyée est donc toujours celle d'une mission ouverte.
-- 3. Séparation des tâches : l'acceptation d'une pièce ne revient pas à celui qui a déposé le
--    fichier retenu, sauf associé ; une acceptation cite le dépôt retenu (versement au dossier).
-- Codes SQLSTATE (lettre L) : MPL06 mission clôturée ; MPL07 plafond de dépôts ; MPL08 débit de
-- dépôts du portail ; MPL09 acceptation par le déposant.

CREATE OR REPLACE FUNCTION controler_salle_depot() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_demande uuid; v_client uuid; v_mission uuid; v_n integer; v_octets numeric;
          v_taille bigint;
  BEGIN
    NEW.depose_le := now();
    SELECT p.demande_id, p.client_id, p.mission_id INTO v_demande, v_client, v_mission
    FROM salle_pieces p WHERE p.id = NEW.piece_id;
    IF NOT FOUND OR v_demande <> NEW.demande_id OR v_client <> NEW.client_id THEN
      RAISE EXCEPTION 'Dépôt incohérent avec sa pièce.' USING ERRCODE = 'MPL04';
    END IF;
    IF EXISTS (SELECT 1 FROM missions m WHERE m.id = v_mission AND m.statut = 'cloturee') THEN
      RAISE EXCEPTION 'La mission est clôturée : plus de dépôt.' USING ERRCODE = 'MPL06';
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
      SELECT count(*) INTO v_n FROM salle_depots x
      WHERE x.depose_par = NEW.depose_par AND x.origine = 'portail'
        AND x.depose_le > now() - make_interval(mins => 10);
      IF v_n >= 30 THEN
        RAISE EXCEPTION 'Trop de dépôts en peu de temps : réessayer plus tard.' USING ERRCODE = 'MPL08';
      END IF;
    ELSIF EXISTS (SELECT 1 FROM utilisateurs u WHERE u.id = NEW.depose_par
                  AND u.roles && ARRAY['client_dirigeant', 'client_contributeur', 'client_investisseur']) THEN
      RAISE EXCEPTION 'Un utilisateur du portail dépose par le portail.' USING ERRCODE = 'MPL03';
    END IF;
    SELECT count(*) INTO v_n FROM salle_depots x
    WHERE x.piece_id = NEW.piece_id
      AND NOT EXISTS (SELECT 1 FROM salle_piece_evenements e
                      WHERE e.depot_id = x.id AND e.statut = 'rejetee')
      AND NOT EXISTS (SELECT 1 FROM fichiers_suppressions s WHERE s.fichier_id = x.fichier_id);
    IF v_n >= 20 THEN
      RAISE EXCEPTION 'Trop de dépôts sur cette pièce (20 au plus, hors rejetés).' USING ERRCODE = 'MPL07';
    END IF;
    SELECT coalesce(sum(f.taille), 0) INTO v_octets
    FROM salle_depots x JOIN fichiers f ON f.id = x.fichier_id
    WHERE x.demande_id = NEW.demande_id
      AND NOT EXISTS (SELECT 1 FROM fichiers_suppressions s WHERE s.fichier_id = f.id);
    SELECT f.taille INTO v_taille FROM fichiers f WHERE f.id = NEW.fichier_id;
    IF v_octets + coalesce(v_taille, 0) > 524288000 THEN
      RAISE EXCEPTION 'Volume de dépôts de cette demande atteint (500 Mo).' USING ERRCODE = 'MPL07';
    END IF;
    RETURN NEW;
  END $$;

CREATE OR REPLACE FUNCTION controler_salle_evenement() RETURNS trigger
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
      IF NEW.statut = 'acceptee' THEN
        IF NEW.depot_id IS NULL THEN
          RAISE EXCEPTION 'Une acceptation cite le dépôt retenu.' USING ERRCODE = 'MPL02';
        END IF;
        IF EXISTS (SELECT 1 FROM salle_depots x WHERE x.id = NEW.depot_id AND x.depose_par = NEW.par)
           AND NOT EXISTS (SELECT 1 FROM utilisateurs u
                           WHERE u.id = NEW.par AND u.roles && ARRAY['associe']::text[]) THEN
          RAISE EXCEPTION 'Séparation des tâches : le déposant n''accepte pas son propre dépôt.'
            USING ERRCODE = 'MPL09';
        END IF;
      END IF;
    END IF;
    RETURN NEW;
  END $$;

CREATE OR REPLACE FUNCTION controler_salle_demande() RETURNS trigger
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
      IF EXISTS (SELECT 1 FROM missions m WHERE m.id = NEW.mission_id AND m.statut = 'cloturee') THEN
        RAISE EXCEPTION 'La mission est clôturée.' USING ERRCODE = 'MPL06';
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
    ELSIF NEW.statut = 'envoyee' THEN
      IF NOT EXISTS (SELECT 1 FROM salle_pieces p WHERE p.demande_id = NEW.id) THEN
        RAISE EXCEPTION 'Une demande sans pièce ne s''envoie pas.' USING ERRCODE = 'MPL05';
      END IF;
      IF EXISTS (SELECT 1 FROM missions m WHERE m.id = NEW.mission_id AND m.statut = 'cloturee') THEN
        RAISE EXCEPTION 'La mission est clôturée.' USING ERRCODE = 'MPL06';
      END IF;
    END IF;
    RETURN NEW;
  END $$;

/*
 * Clôture d'une mission : ses demandes « envoyées » sont closes d'abord (API, même transaction) ;
 * sinon la clôture est refusée. Déclencheur d'appelant (RLS du cabinet).
 */
CREATE FUNCTION controler_cloture_mission_salle() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NEW.statut = 'cloturee' AND OLD.statut IS DISTINCT FROM 'cloturee'
       AND EXISTS (SELECT 1 FROM salle_demandes d WHERE d.mission_id = NEW.id AND d.statut = 'envoyee') THEN
      RAISE EXCEPTION 'Des demandes de la salle de mission sont encore envoyées : les clore d''abord.'
        USING ERRCODE = 'MPL06';
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER missions_cloture_salle BEFORE UPDATE OF statut ON missions
  FOR EACH ROW EXECUTE FUNCTION controler_cloture_mission_salle();
