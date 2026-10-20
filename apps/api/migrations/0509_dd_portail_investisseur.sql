-- Portail investisseur de la due diligence (service #2, lot 3, après SPEC-3b §16 « Accès d'un
-- investisseur-client à une note validée par le portail ») : consultation EN LECTURE SEULE, par un
-- compte du portail INVITÉ SUR LE DOSSIER, de la note au comité VALIDÉE que le cabinet publie et
-- des rapports de cette note qu'il choisit. Plage du lot : 0500 à 0519 (0509 et 0510 à ce chantier,
-- 0511 aux modèles sectoriels DD-07).
--
-- Fermé par défaut, en trois verrous indépendants, tous relus à CHAQUE requête du portail :
-- 1. option du cabinet (`dd_portail_options`) : DÉSACTIVÉE tant qu'aucune ligne ne l'active (état
--    courant = dernière ligne) ;
-- 2. invitation d'un compte sur un dossier (`dd_portail_invites`) : seul un utilisateur du portail
--    ACTIF, rôle `client_investisseur`, rattaché au client du dossier, est invitable (MQD01) ;
--    état courant = dernier événement du couple (dossier, compte) ;
-- 3. publication non retirée (`dd_portail_publications`, `dd_portail_publication_retraits`).
--
-- Le portail ne lit JAMAIS dd_notes, dd_note_versions (base_figee), dd_dossiers ni
-- rapports_mission, qui restent `portail_interdit` : la publication porte un INSTANTANÉ explicite
-- (titre, recommandation, synthèse, conditions, date de validation) copié par le serveur et
-- revérifié ici (MQD04) ; aucun nom de membre du cabinet, aucun coût ni honoraire (FIN-02), aucun
-- verbatim. Une pièce désigne un rapport `note_comite` de la version publiée (MQD07), sans colonne
-- vers `fichiers` (`fichier_orphelin` inchangée) : son contenu est servi par la route du portail,
-- qui revérifie tout avant une lecture interne filtrée explicitement.
--
-- Règles communes (comme 0500 à 0508) : AJOUT SEUL (REVOKE UPDATE, DELETE et déclencheur
-- `refuser_modification_dd`, MPZ21) ; RLS `isolation` ; clés étrangères composites ; auteurs par
-- `refuser_utilisateur_portail` ; aucune fonction SECURITY DEFINER. Politiques du portail TOUTES
-- RESTRICTIVES, en LECTURE (`portail` FOR SELECT) doublées de `portail_sans_insert`,
-- `portail_sans_update`, `portail_sans_delete` : aucune écriture possible depuis une transaction du
-- portail. Une table citée dans un NOT EXISTS d'une politique du portail (retraits) est LISIBLE
-- dans ce contexte pour les lignes concernées, sinon le filtre s'ouvrirait (échec non sûr) ; le
-- déclencheur garantit que le retrait porte le client de sa publication.
--
-- SQLSTATE (second préfixe « MQ », CODING_STANDARDS §2 ; MQD01 à MQD10 réservés à ce chantier,
-- MQD11 à MQD20 aux modèles sectoriels) :
-- MQD01 compte non admissible à une invitation ; MQD02 invitation incohérente (déjà invité, retrait
-- sans invitation) ; MQD03 version de note non publiable (non validée ou plus la dernière soumise) ;
-- MQD04 instantané incohérent avec la note ; MQD05 publication déjà active pour la note ; MQD06
-- retrait incohérent ; MQD07 pièce non admissible ; MQD08 plafond atteint.

-- ---------------------------------------------------------------------------
-- Option du cabinet (associé seul, `dd.portail.configurer`).
-- ---------------------------------------------------------------------------

CREATE TABLE dd_portail_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  numero bigint GENERATED ALWAYS AS IDENTITY,
  actif boolean NOT NULL,
  modifie_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, modifie_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX dd_portail_options_courante_idx ON dd_portail_options (cabinet_id, numero DESC);
ALTER TABLE dd_portail_options ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON dd_portail_options
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE UPDATE, DELETE ON dd_portail_options FROM missionpilot_app;
CREATE TRIGGER dd_portail_options_ajout_seul BEFORE UPDATE OR DELETE ON dd_portail_options
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_dd();
CREATE TRIGGER dd_portail_options_auteur_sans_portail BEFORE INSERT ON dd_portail_options
  FOR EACH ROW EXECUTE FUNCTION refuser_utilisateur_portail('modifie_par');

-- ---------------------------------------------------------------------------
-- Invitations d'un compte du portail sur un dossier (événements).
-- ---------------------------------------------------------------------------

CREATE TABLE dd_portail_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  numero bigint GENERATED ALWAYS AS IDENTITY,
  dossier_id uuid NOT NULL,
  utilisateur_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('invite', 'retire')),
  auteur_id uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, dossier_id) REFERENCES dd_dossiers (cabinet_id, id),
  -- Un compte du PORTAIL seulement (rattachement à un client figé, 0111).
  FOREIGN KEY (cabinet_id, utilisateur_id) REFERENCES utilisateurs_portail (cabinet_id, utilisateur_id),
  FOREIGN KEY (cabinet_id, auteur_id) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX dd_portail_invites_courante_idx
  ON dd_portail_invites (dossier_id, utilisateur_id, numero DESC);
CREATE INDEX dd_portail_invites_utilisateur_idx ON dd_portail_invites (utilisateur_id, numero);
ALTER TABLE dd_portail_invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON dd_portail_invites
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE UPDATE, DELETE ON dd_portail_invites FROM missionpilot_app;
CREATE TRIGGER dd_portail_invites_ajout_seul BEFORE UPDATE OR DELETE ON dd_portail_invites
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_dd();
CREATE TRIGGER dd_portail_invites_auteur_sans_portail BEFORE INSERT ON dd_portail_invites
  FOR EACH ROW EXECUTE FUNCTION refuser_utilisateur_portail('auteur_id');

-- État courant (fonctions d'appelant : la RLS de l'appelant s'applique à leurs lectures).
CREATE FUNCTION dd_portail_option_active(p_cabinet uuid) RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = public, pg_temp
  AS $$
    SELECT coalesce((SELECT o.actif FROM dd_portail_options o
                     WHERE o.cabinet_id = p_cabinet ORDER BY o.numero DESC LIMIT 1), false)
  $$;

CREATE FUNCTION dd_portail_invitation_active(p_dossier uuid, p_utilisateur uuid) RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = public, pg_temp
  AS $$
    SELECT coalesce((SELECT i.action = 'invite' FROM dd_portail_invites i
                     WHERE i.dossier_id = p_dossier AND i.utilisateur_id = p_utilisateur
                     ORDER BY i.numero DESC LIMIT 1), false)
  $$;

-- MQD01 : compte du portail ACTIF (rattachement et utilisateur), rôle investisseur, client du
-- dossier ; MQD02 : transition (invité → déjà invité ; retrait → pas invité) ; MQD08 : 500
-- événements par dossier au plus (provisoire). Le verrou de la mission (API) sérialise.
CREATE FUNCTION controler_dd_portail_invite() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_active boolean := dd_portail_invitation_active(NEW.dossier_id, NEW.utilisateur_id);
  BEGIN
    IF (SELECT count(*) FROM dd_portail_invites i WHERE i.dossier_id = NEW.dossier_id) >= 500 THEN
      RAISE EXCEPTION 'Plafond des invitations du dossier atteint.' USING ERRCODE = 'MQD08';
    END IF;
    IF NEW.action = 'invite' THEN
      IF NOT EXISTS (
           SELECT 1 FROM utilisateurs_portail up
           JOIN utilisateurs u ON u.id = up.utilisateur_id
           JOIN dd_dossiers d ON d.id = NEW.dossier_id AND d.client_id = up.client_id
           WHERE up.utilisateur_id = NEW.utilisateur_id AND up.statut = 'actif' AND u.actif
             AND 'client_investisseur' = ANY (u.roles)) THEN
        RAISE EXCEPTION 'Seul un investisseur actif du portail, rattaché au client du dossier, est invitable.'
          USING ERRCODE = 'MQD01';
      END IF;
      IF v_active THEN
        RAISE EXCEPTION 'Ce compte est déjà invité sur ce dossier.' USING ERRCODE = 'MQD02';
      END IF;
    ELSIF NOT v_active THEN
      RAISE EXCEPTION 'Ce compte n''est pas invité sur ce dossier.' USING ERRCODE = 'MQD02';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER dd_portail_invites_controle BEFORE INSERT ON dd_portail_invites
  FOR EACH ROW EXECUTE FUNCTION controler_dd_portail_invite();

-- ---------------------------------------------------------------------------
-- Publications : instantané d'une version VALIDÉE de note, copié par le serveur.
-- ---------------------------------------------------------------------------

CREATE TABLE dd_portail_publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  numero bigint GENERATED ALWAYS AS IDENTITY,
  dossier_id uuid NOT NULL,
  client_id uuid NOT NULL,
  note_id uuid NOT NULL,
  note_version_id uuid NOT NULL,
  version int NOT NULL CHECK (version BETWEEN 1 AND 200),
  titre text NOT NULL CHECK (std_libelle_valide(titre, 200)),
  recommandation text NOT NULL CHECK (recommandation IN
    ('favorable', 'favorable_sous_conditions', 'reservee', 'defavorable')),
  synthese text NOT NULL CHECK (length(synthese) BETWEEN 1 AND 4000),
  conditions text[] NOT NULL DEFAULT '{}' CHECK (dd_textes_valides(conditions, 20, 300)),
  valide_le timestamptz NOT NULL,
  publie_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, dossier_id) REFERENCES dd_dossiers (cabinet_id, id),
  FOREIGN KEY (cabinet_id, client_id) REFERENCES clients (cabinet_id, id),
  FOREIGN KEY (cabinet_id, note_id) REFERENCES dd_notes (cabinet_id, id),
  FOREIGN KEY (cabinet_id, note_version_id) REFERENCES dd_note_versions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, publie_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX dd_portail_publications_note_idx ON dd_portail_publications (note_id, numero DESC);
CREATE INDEX dd_portail_publications_dossier_idx
  ON dd_portail_publications (cabinet_id, dossier_id, numero DESC);
CREATE INDEX dd_portail_publications_client_idx
  ON dd_portail_publications (client_id, numero DESC);
ALTER TABLE dd_portail_publications ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON dd_portail_publications
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE UPDATE, DELETE ON dd_portail_publications FROM missionpilot_app;
CREATE TRIGGER dd_portail_publications_ajout_seul BEFORE UPDATE OR DELETE ON dd_portail_publications
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_dd();
CREATE TRIGGER dd_portail_publications_auteur_sans_portail BEFORE INSERT ON dd_portail_publications
  FOR EACH ROW EXECUTE FUNCTION refuser_utilisateur_portail('publie_par');

CREATE TABLE dd_portail_publication_retraits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  numero bigint GENERATED ALWAYS AS IDENTITY,
  publication_id uuid NOT NULL UNIQUE,
  -- Client de la publication (MQD06) : rend le retrait lisible du portail dès que la publication
  -- le serait, condition du NOT EXISTS de la politique des publications.
  client_id uuid NOT NULL,
  retire_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, publication_id) REFERENCES dd_portail_publications (cabinet_id, id),
  FOREIGN KEY (cabinet_id, client_id) REFERENCES clients (cabinet_id, id),
  FOREIGN KEY (cabinet_id, retire_par) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE dd_portail_publication_retraits ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON dd_portail_publication_retraits
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE UPDATE, DELETE ON dd_portail_publication_retraits FROM missionpilot_app;
CREATE TRIGGER dd_portail_publication_retraits_ajout_seul
  BEFORE UPDATE OR DELETE ON dd_portail_publication_retraits
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_dd();
CREATE TRIGGER dd_portail_publication_retraits_auteur_sans_portail
  BEFORE INSERT ON dd_portail_publication_retraits
  FOR EACH ROW EXECUTE FUNCTION refuser_utilisateur_portail('retire_par');

-- MQD04 : l'instantané est EXACTEMENT celui de la version (note, dossier, client, titre,
-- recommandation, synthèse, conditions, date de validation) ; MQD03 : la version est validée et la
-- DERNIÈRE soumise de sa note ; MQD05 : aucune autre publication active de la note ; MQD08 : 50
-- publications par note au plus (provisoire). Garde de COHÉRENCE : l'API copie l'instantané depuis
-- la base ; du SQL arbitraire du même rôle la contournerait (limite connue, comme MPZ29).
CREATE FUNCTION controler_dd_portail_publication() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    v record;
    v_valide_le timestamptz;
  BEGIN
    SELECT x.note_id, x.version, x.etat, x.recommandation, x.synthese, x.conditions,
           n.titre, n.dossier_id, d.client_id
      INTO v
      FROM dd_note_versions x
      JOIN dd_notes n ON n.id = x.note_id
      JOIN dd_dossiers d ON d.id = n.dossier_id
     WHERE x.id = NEW.note_version_id;
    IF v.note_id IS DISTINCT FROM NEW.note_id OR v.version IS DISTINCT FROM NEW.version
       OR v.dossier_id IS DISTINCT FROM NEW.dossier_id OR v.client_id IS DISTINCT FROM NEW.client_id
       OR v.titre IS DISTINCT FROM NEW.titre OR v.recommandation IS DISTINCT FROM NEW.recommandation
       OR v.synthese IS DISTINCT FROM NEW.synthese OR v.conditions IS DISTINCT FROM NEW.conditions THEN
      RAISE EXCEPTION 'L''instantané publié diffère de la version de la note.' USING ERRCODE = 'MQD04';
    END IF;
    SELECT y.valide_le INTO v_valide_le FROM dd_note_validations y
      WHERE y.note_version_id = NEW.note_version_id AND y.decision = 'valide';
    IF v.etat IS DISTINCT FROM 'soumise' OR v_valide_le IS NULL OR EXISTS (
         SELECT 1 FROM dd_note_versions z
         WHERE z.note_id = v.note_id AND z.etat = 'soumise' AND z.version > v.version) THEN
      RAISE EXCEPTION 'Seule la dernière version soumise et validée de la note se publie.'
        USING ERRCODE = 'MQD03';
    END IF;
    IF v_valide_le IS DISTINCT FROM NEW.valide_le THEN
      RAISE EXCEPTION 'L''instantané publié diffère de la version de la note.' USING ERRCODE = 'MQD04';
    END IF;
    IF EXISTS (SELECT 1 FROM dd_portail_publications p
               WHERE p.note_id = NEW.note_id
                 AND NOT EXISTS (SELECT 1 FROM dd_portail_publication_retraits r
                                 WHERE r.publication_id = p.id)) THEN
      RAISE EXCEPTION 'Une publication de cette note est déjà active : retirez-la d''abord.'
        USING ERRCODE = 'MQD05';
    END IF;
    IF (SELECT count(*) FROM dd_portail_publications p WHERE p.note_id = NEW.note_id) >= 50 THEN
      RAISE EXCEPTION 'Plafond des publications de la note atteint.' USING ERRCODE = 'MQD08';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER dd_portail_publications_controle BEFORE INSERT ON dd_portail_publications
  FOR EACH ROW EXECUTE FUNCTION controler_dd_portail_publication();

-- MQD06 : le retrait porte le client de sa publication.
CREATE FUNCTION controler_dd_portail_retrait() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM dd_portail_publications p
                   WHERE p.id = NEW.publication_id AND p.client_id = NEW.client_id) THEN
      RAISE EXCEPTION 'Le retrait doit porter le client de sa publication.' USING ERRCODE = 'MQD06';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER dd_portail_publication_retraits_controle
  BEFORE INSERT ON dd_portail_publication_retraits
  FOR EACH ROW EXECUTE FUNCTION controler_dd_portail_retrait();

-- ---------------------------------------------------------------------------
-- Pièces : rapports `note_comite` de la version publiée, choisis À LA PUBLICATION.
-- ---------------------------------------------------------------------------

CREATE TABLE dd_portail_pieces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  numero bigint GENERATED ALWAYS AS IDENTITY,
  publication_id uuid NOT NULL,
  rapport_id uuid NOT NULL,
  client_id uuid NOT NULL,
  variante text NOT NULL CHECK (variante IN ('executive', 'detaillee')),
  format text NOT NULL CHECK (format IN ('pdf', 'docx')),
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (publication_id, rapport_id),
  FOREIGN KEY (cabinet_id, publication_id) REFERENCES dd_portail_publications (cabinet_id, id),
  FOREIGN KEY (cabinet_id, rapport_id) REFERENCES rapports_mission (cabinet_id, id),
  FOREIGN KEY (cabinet_id, client_id) REFERENCES clients (cabinet_id, id)
);
CREATE INDEX dd_portail_pieces_publication_idx ON dd_portail_pieces (publication_id, numero);
ALTER TABLE dd_portail_pieces ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON dd_portail_pieces
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE UPDATE, DELETE ON dd_portail_pieces FROM missionpilot_app;
CREATE TRIGGER dd_portail_pieces_ajout_seul BEFORE UPDATE OR DELETE ON dd_portail_pieces
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_dd();

-- MQD07 : rapport `note_comite`, validé, de la note ET de la version publiées, mêmes variante et
-- format, client de la publication, et pièce ajoutée DANS LA TRANSACTION qui crée la publication
-- (`now()` est l'heure de début de la transaction) : l'ensemble des pièces est figé avec
-- l'instantané. MQD08 : 10 pièces par publication au plus (provisoire).
CREATE FUNCTION controler_dd_portail_piece() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF NOT EXISTS (
         SELECT 1 FROM dd_portail_publications p
         JOIN rapports_mission r ON r.id = NEW.rapport_id
         WHERE p.id = NEW.publication_id AND p.client_id = NEW.client_id AND p.cree_le = now()
           AND r.modele = 'note_comite' AND r.statut = 'valide' AND r.dd_note_id = p.note_id
           AND r.version_source = p.version AND r.variante = NEW.variante
           AND r.format = NEW.format) THEN
      RAISE EXCEPTION 'Cette pièce n''est pas un rapport de la version publiée de la note.'
        USING ERRCODE = 'MQD07';
    END IF;
    IF (SELECT count(*) FROM dd_portail_pieces x WHERE x.publication_id = NEW.publication_id) >= 10 THEN
      RAISE EXCEPTION 'Plafond des pièces de la publication atteint.' USING ERRCODE = 'MQD08';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER dd_portail_pieces_controle BEFORE INSERT ON dd_portail_pieces
  FOR EACH ROW EXECUTE FUNCTION controler_dd_portail_piece();

-- ---------------------------------------------------------------------------
-- Portail : politiques RESTRICTIVES, en lecture seule. Sans contexte du portail
-- (`app_portail_client_id()` NULL : cabinet, tâches), seule `isolation` s'applique.
-- ---------------------------------------------------------------------------

-- Ses propres invitations seulement, et seulement avec un rattachement ACTIF au client de la
-- transaction (lu sous la politique `portail` de utilisateurs_portail, 0113) : avec le client
-- sentinelle d'un rattachement inactif, rien n'est visible, option comprise.
CREATE POLICY portail ON dd_portail_invites AS RESTRICTIVE FOR SELECT
  USING (app_portail_client_id() IS NULL OR (
    utilisateur_id = app_portail_utilisateur_id()
    AND EXISTS (SELECT 1 FROM utilisateurs_portail up
                WHERE up.utilisateur_id = dd_portail_invites.utilisateur_id
                  AND up.client_id = app_portail_client_id() AND up.statut = 'actif')));

-- L'option du cabinet n'est lisible que d'un compte qui a été invité au moins une fois.
CREATE POLICY portail ON dd_portail_options AS RESTRICTIVE FOR SELECT
  USING (app_portail_client_id() IS NULL OR EXISTS (
    SELECT 1 FROM dd_portail_invites i WHERE i.utilisateur_id = app_portail_utilisateur_id()));

-- Retraits des publications de SON client (voir l'en-tête : condition du NOT EXISTS ci-dessous).
CREATE POLICY portail ON dd_portail_publication_retraits AS RESTRICTIVE FOR SELECT
  USING (app_portail_client_id() IS NULL OR client_id = app_portail_client_id());

-- Publication visible : SON client, option active, invitation active de l'utilisateur sur le
-- dossier, publication non retirée.
CREATE POLICY portail ON dd_portail_publications AS RESTRICTIVE FOR SELECT
  USING (app_portail_client_id() IS NULL OR (
    client_id = app_portail_client_id()
    AND dd_portail_option_active(cabinet_id)
    AND dd_portail_invitation_active(dossier_id, app_portail_utilisateur_id())
    AND NOT EXISTS (SELECT 1 FROM dd_portail_publication_retraits r
                    WHERE r.publication_id = dd_portail_publications.id)));

-- Pièce visible : celle d'une publication visible (la politique des publications s'applique à la
-- sous-requête), du même client.
CREATE POLICY portail ON dd_portail_pieces AS RESTRICTIVE FOR SELECT
  USING (app_portail_client_id() IS NULL OR (
    client_id = app_portail_client_id()
    AND EXISTS (SELECT 1 FROM dd_portail_publications p
                WHERE p.id = dd_portail_pieces.publication_id)));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['dd_portail_options', 'dd_portail_invites', 'dd_portail_publications',
                           'dd_portail_publication_retraits', 'dd_portail_pieces']
  LOOP
    EXECUTE format(
      'CREATE POLICY portail_sans_insert ON %I AS RESTRICTIVE FOR INSERT
         WITH CHECK (app_portail_client_id() IS NULL)', t);
    EXECUTE format(
      'CREATE POLICY portail_sans_update ON %I AS RESTRICTIVE FOR UPDATE
         USING (app_portail_client_id() IS NULL) WITH CHECK (app_portail_client_id() IS NULL)', t);
    EXECUTE format(
      'CREATE POLICY portail_sans_delete ON %I AS RESTRICTIVE FOR DELETE
         USING (app_portail_client_id() IS NULL)', t);
  END LOOP;
END $$;
