-- Redressement : check-lists métier configurables par le cabinet (RED-03, lot 2). SQLSTATE : voir 0480.
--
-- - red_checklist_modeles : un modèle de check-list du cabinet (code unique par cabinet, intitulé,
--   secteur). EN AJOUT SEUL : l'identité d'un modèle ne change pas ; son contenu vit dans ses versions.
-- - red_checklist_versions : contenu d'un modèle ({ "items": [...] }, forme revalidée par le moteur
--   `validerModeleChecklist` côté API), VERSIONNÉ. Une version est rédigée (brouillon) puis PUBLIÉE par un
--   expert métier ou un associé qui n'en est pas l'auteur (sauf associé : red_valideur_dispense), règle
--   doublée par l'API (MPZ07). Seule transition admise : brouillon -> publiee, sur la DERNIÈRE version du
--   modèle ; le contenu est figé (MPZ04) ; un seul brouillon à la fois par modèle (MPZ06) ; versions
--   consécutives (MPZ05) ; au plus 30 versions par modèle (MPZ10).
-- - red_checklists : une check-list ACTIVÉE dans un dossier, avec un INSTANTANÉ figé du contenu au
--   moment de l'activation (origine = version publiée d'un modèle du cabinet, ou check-list de départ du
--   moteur, marquée « à valider par un expert »). Un instantané de modèle égale la version publiée
--   référencée (MPZ02). Seul l'archivage (active -> archivee) modifie une ligne ; une check-list
--   archivée est FIGÉE : plus de modification ni de réponse (MPZ12). Au plus 30 par dossier (MPZ10).
-- - red_checklist_reponses : une réponse par item, EN AJOUT SEUL (MPZ01) ; la dernière réponse d'un
--   item (plus grand `rang`) est la courante. L'item doit exister dans l'instantané (MPZ02) ; au plus
--   2 000 réponses par check-list (MPZ10) ; plus de réponse si le dossier est clos ou la mission
--   clôturée (red_controler_mission_ouverte, MPZ03).
-- Aucune table ne référence `fichiers`. Aucune fonction SECURITY DEFINER. Une check-list est un constat
-- de saisie : aucun calcul ni qualification juridique en base (les taux sortent du moteur).

CREATE TABLE red_checklist_modeles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  code text NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9_-]{1,39}$'),
  intitule text NOT NULL CHECK (length(btrim(intitule)) BETWEEN 1 AND 200),
  secteur text NOT NULL
    CHECK (secteur IN ('general', 'industrie', 'commerce', 'services', 'btp', 'agriculture')),
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, code),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX red_checklist_modeles_liste_idx ON red_checklist_modeles (cabinet_id, secteur, code);
ALTER TABLE red_checklist_modeles ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON red_checklist_modeles
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON red_checklist_modeles AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON red_checklist_modeles FROM missionpilot_app;
CREATE TRIGGER red_checklist_modeles_ajout_seul BEFORE UPDATE OR DELETE ON red_checklist_modeles
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_redressement();
CREATE TRIGGER red_checklist_modeles_plafond BEFORE INSERT ON red_checklist_modeles
  FOR EACH ROW EXECUTE FUNCTION red_controler_plafond('cabinet_id', '100', 'modèles de check-list par cabinet');

CREATE TABLE red_checklist_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  modele_id uuid NOT NULL,
  version int NOT NULL CHECK (version >= 1),
  -- { "items": [ { id, domaine, libelle, aide } ] } : 1 à 40 items.
  contenu jsonb NOT NULL
    CHECK (jsonb_typeof(contenu) = 'object' AND octet_length(contenu::text) <= 100000
           AND jsonb_typeof(contenu -> 'items') = 'array'
           AND jsonb_array_length(contenu -> 'items') BETWEEN 1 AND 40),
  statut text NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon', 'publiee')),
  motif text CHECK (motif IS NULL OR length(motif) BETWEEN 1 AND 500),
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  publiee_par uuid,
  publiee_le timestamptz,
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, modele_id, version),
  CHECK ((statut = 'publiee') = (publiee_par IS NOT NULL AND publiee_le IS NOT NULL)),
  FOREIGN KEY (cabinet_id, modele_id) REFERENCES red_checklist_modeles (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, publiee_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX red_checklist_versions_modele_idx
  ON red_checklist_versions (cabinet_id, modele_id, version DESC);
ALTER TABLE red_checklist_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON red_checklist_versions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON red_checklist_versions AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
-- Seule la publication (statut, publiee_par, publiee_le) modifie une ligne (modèle 0483).
REVOKE UPDATE, DELETE ON red_checklist_versions FROM missionpilot_app;
GRANT UPDATE (statut, publiee_par, publiee_le) ON red_checklist_versions TO missionpilot_app;

CREATE FUNCTION red_controler_checklist_version() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_derniere int;
    v_nombre bigint;
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Une version de check-list ne se supprime pas.' USING ERRCODE = 'MPZ01';
    END IF;
    SELECT count(*), coalesce(max(v.version), 0) INTO v_nombre, v_derniere
      FROM red_checklist_versions v
      WHERE v.cabinet_id = NEW.cabinet_id AND v.modele_id = NEW.modele_id;
    IF TG_OP = 'INSERT' THEN
      IF NEW.statut <> 'brouillon' THEN
        RAISE EXCEPTION 'Une version de check-list naît en brouillon.' USING ERRCODE = 'MPZ06';
      END IF;
      IF v_nombre >= 30 THEN
        RAISE EXCEPTION 'Plafond atteint : au plus 30 versions par modèle de check-list.'
          USING ERRCODE = 'MPZ10';
      END IF;
      IF NEW.version <> v_derniere + 1 THEN
        RAISE EXCEPTION 'Les versions se suivent sans trou.' USING ERRCODE = 'MPZ05';
      END IF;
      -- Un seul brouillon à la fois par modèle : la publication vise toujours la dernière version.
      IF EXISTS (SELECT 1 FROM red_checklist_versions v
                 WHERE v.cabinet_id = NEW.cabinet_id AND v.modele_id = NEW.modele_id
                   AND v.version = v_derniere AND v.statut = 'brouillon') THEN
        RAISE EXCEPTION 'Un brouillon de check-list est déjà en cours pour ce modèle.'
          USING ERRCODE = 'MPZ06';
      END IF;
      RETURN NEW;
    END IF;
    -- UPDATE : la seule transition admise est la publication.
    IF OLD.statut <> 'brouillon' OR NEW.statut <> 'publiee' THEN
      RAISE EXCEPTION 'Seule la publication d''un brouillon est admise.' USING ERRCODE = 'MPZ06';
    END IF;
    IF (NEW.cabinet_id, NEW.modele_id, NEW.version, NEW.contenu, NEW.motif, NEW.cree_par, NEW.cree_le)
       IS DISTINCT FROM (OLD.cabinet_id, OLD.modele_id, OLD.version, OLD.contenu, OLD.motif,
                         OLD.cree_par, OLD.cree_le) THEN
      RAISE EXCEPTION 'Le contenu d''une version de check-list est figé.' USING ERRCODE = 'MPZ04';
    END IF;
    IF NEW.version <> v_derniere THEN
      RAISE EXCEPTION 'Seule la dernière version du modèle se publie.' USING ERRCODE = 'MPZ05';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM utilisateurs u
                   WHERE u.id = NEW.publiee_par AND u.actif
                     AND u.roles && ARRAY['expert_metier', 'associe']) THEN
      RAISE EXCEPTION 'Les check-lists sont publiées par un expert métier ou un associé actif.'
        USING ERRCODE = 'MPZ07';
    END IF;
    IF NEW.publiee_par = NEW.cree_par AND NOT red_valideur_dispense(NEW.publiee_par) THEN
      RAISE EXCEPTION 'L''auteur d''une check-list ne la publie pas lui-même.' USING ERRCODE = 'MPZ07';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER red_checklist_versions_controle BEFORE INSERT OR UPDATE OR DELETE ON red_checklist_versions
  FOR EACH ROW EXECUTE FUNCTION red_controler_checklist_version();

CREATE TABLE red_checklists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  dossier_id uuid NOT NULL,
  intitule text NOT NULL CHECK (length(btrim(intitule)) BETWEEN 1 AND 200),
  secteur text NOT NULL
    CHECK (secteur IN ('general', 'industrie', 'commerce', 'services', 'btp', 'agriculture')),
  origine text NOT NULL CHECK (origine IN ('depart', 'modele')),
  -- Origine « depart » : code de la check-list de départ du moteur.
  code_depart text CHECK (code_depart IS NULL OR code_depart ~ '^[a-z0-9][a-z0-9_-]{1,39}$'),
  -- Origine « modele » : le modèle et la version PUBLIÉE dont le contenu est recopié.
  modele_id uuid,
  modele_version_id uuid,
  -- Instantané figé du contenu au moment de l'activation.
  contenu jsonb NOT NULL
    CHECK (jsonb_typeof(contenu) = 'object' AND octet_length(contenu::text) <= 100000
           AND jsonb_typeof(contenu -> 'items') = 'array'
           AND jsonb_array_length(contenu -> 'items') BETWEEN 1 AND 40),
  -- Vrai pour le contenu de départ (provisoire) ; faux pour un modèle publié par le cabinet.
  a_valider_par_un_expert boolean NOT NULL,
  statut text NOT NULL DEFAULT 'active' CHECK (statut IN ('active', 'archivee')),
  motif_archivage text CHECK (motif_archivage IS NULL OR length(motif_archivage) BETWEEN 1 AND 500),
  archivee_par uuid,
  archivee_le timestamptz,
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, id, dossier_id),
  CHECK ((origine = 'depart' AND code_depart IS NOT NULL AND modele_id IS NULL
          AND modele_version_id IS NULL AND a_valider_par_un_expert)
         OR (origine = 'modele' AND code_depart IS NULL AND modele_id IS NOT NULL
             AND modele_version_id IS NOT NULL AND NOT a_valider_par_un_expert)),
  CHECK ((statut = 'archivee') = (archivee_par IS NOT NULL AND archivee_le IS NOT NULL)),
  CHECK (statut = 'archivee' OR motif_archivage IS NULL),
  FOREIGN KEY (cabinet_id, dossier_id) REFERENCES red_dossiers (cabinet_id, id),
  FOREIGN KEY (cabinet_id, modele_id) REFERENCES red_checklist_modeles (cabinet_id, id),
  FOREIGN KEY (cabinet_id, modele_version_id) REFERENCES red_checklist_versions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, archivee_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX red_checklists_dossier_idx ON red_checklists (cabinet_id, dossier_id, cree_le DESC, id DESC);
-- Une seule check-list ACTIVE par origine dans un dossier (l'API répond 409 avant ; filet de la base).
CREATE UNIQUE INDEX red_checklists_depart_actif_idx
  ON red_checklists (cabinet_id, dossier_id, code_depart)
  WHERE statut = 'active' AND origine = 'depart';
CREATE UNIQUE INDEX red_checklists_modele_actif_idx
  ON red_checklists (cabinet_id, dossier_id, modele_id)
  WHERE statut = 'active' AND origine = 'modele';
ALTER TABLE red_checklists ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON red_checklists
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON red_checklists AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
-- Seul l'archivage modifie une ligne.
REVOKE UPDATE, DELETE ON red_checklists FROM missionpilot_app;
GRANT UPDATE (statut, motif_archivage, archivee_par, archivee_le) ON red_checklists TO missionpilot_app;

CREATE FUNCTION red_controler_checklist() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_version red_checklist_versions%ROWTYPE;
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Une check-list ne se supprime pas.' USING ERRCODE = 'MPZ01';
    END IF;
    IF TG_OP = 'INSERT' THEN
      IF NEW.statut <> 'active' THEN
        RAISE EXCEPTION 'Une check-list naît active.' USING ERRCODE = 'MPZ06';
      END IF;
      IF NEW.origine = 'modele' THEN
        SELECT * INTO v_version FROM red_checklist_versions v WHERE v.id = NEW.modele_version_id;
        IF NOT FOUND OR v_version.statut <> 'publiee' OR v_version.modele_id <> NEW.modele_id
           OR v_version.contenu IS DISTINCT FROM NEW.contenu THEN
          RAISE EXCEPTION 'La check-list doit recopier une version publiée de son modèle.'
            USING ERRCODE = 'MPZ02';
        END IF;
      END IF;
      RETURN NEW;
    END IF;
    -- UPDATE : une check-list archivée est figée ; la seule transition admise est l'archivage.
    IF OLD.statut = 'archivee' THEN
      RAISE EXCEPTION 'Cette check-list est archivée : elle est figée.' USING ERRCODE = 'MPZ12';
    END IF;
    IF NEW.statut <> 'archivee' THEN
      RAISE EXCEPTION 'Seul l''archivage d''une check-list est admis.' USING ERRCODE = 'MPZ06';
    END IF;
    IF (NEW.cabinet_id, NEW.dossier_id, NEW.intitule, NEW.secteur, NEW.origine, NEW.code_depart,
        NEW.modele_id, NEW.modele_version_id, NEW.contenu, NEW.a_valider_par_un_expert, NEW.cree_par,
        NEW.cree_le)
       IS DISTINCT FROM (OLD.cabinet_id, OLD.dossier_id, OLD.intitule, OLD.secteur, OLD.origine,
        OLD.code_depart, OLD.modele_id, OLD.modele_version_id, OLD.contenu,
        OLD.a_valider_par_un_expert, OLD.cree_par, OLD.cree_le) THEN
      RAISE EXCEPTION 'Le contenu d''une check-list activée est figé.' USING ERRCODE = 'MPZ04';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER red_checklists_01_mission_ouverte BEFORE INSERT OR UPDATE ON red_checklists
  FOR EACH ROW EXECUTE FUNCTION red_controler_mission_ouverte();
CREATE TRIGGER red_checklists_02_plafond BEFORE INSERT ON red_checklists
  FOR EACH ROW EXECUTE FUNCTION red_controler_plafond('dossier_id', '30', 'check-lists par dossier');
CREATE TRIGGER red_checklists_03_controle BEFORE INSERT OR UPDATE OR DELETE ON red_checklists
  FOR EACH ROW EXECUTE FUNCTION red_controler_checklist();

CREATE TABLE red_checklist_reponses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  checklist_id uuid NOT NULL,
  dossier_id uuid NOT NULL,
  item_id text NOT NULL CHECK (length(item_id) BETWEEN 1 AND 40),
  reponse text NOT NULL CHECK (reponse IN ('oui', 'non', 'partiel', 'sans_objet')),
  commentaire text CHECK (commentaire IS NULL OR length(commentaire) BETWEEN 1 AND 500),
  auteur uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  -- Ordre total des réponses : la plus grande valeur d'un item est sa réponse courante.
  rang bigint GENERATED ALWAYS AS IDENTITY,
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, checklist_id, dossier_id)
    REFERENCES red_checklists (cabinet_id, id, dossier_id),
  FOREIGN KEY (cabinet_id, auteur) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX red_checklist_reponses_courante_idx
  ON red_checklist_reponses (cabinet_id, checklist_id, item_id, rang DESC);
ALTER TABLE red_checklist_reponses ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON red_checklist_reponses
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON red_checklist_reponses AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON red_checklist_reponses FROM missionpilot_app;
CREATE TRIGGER red_checklist_reponses_ajout_seul BEFORE UPDATE OR DELETE ON red_checklist_reponses
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_redressement();

-- La check-list doit être active et l'item exister dans son instantané.
CREATE FUNCTION red_controler_checklist_reponse() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_checklist red_checklists%ROWTYPE;
  BEGIN
    SELECT * INTO v_checklist FROM red_checklists c WHERE c.id = NEW.checklist_id;
    IF v_checklist.statut = 'archivee' THEN
      RAISE EXCEPTION 'Cette check-list est archivée : elle ne reçoit plus de réponse.'
        USING ERRCODE = 'MPZ12';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_checklist.contenu -> 'items') e
                   WHERE e ->> 'id' = NEW.item_id) THEN
      RAISE EXCEPTION 'Cet item n''existe pas dans la check-list.' USING ERRCODE = 'MPZ02';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER red_checklist_reponses_01_mission_ouverte BEFORE INSERT ON red_checklist_reponses
  FOR EACH ROW EXECUTE FUNCTION red_controler_mission_ouverte();
CREATE TRIGGER red_checklist_reponses_02_plafond BEFORE INSERT ON red_checklist_reponses
  FOR EACH ROW EXECUTE FUNCTION red_controler_plafond('checklist_id', '2000', 'réponses par check-list');
CREATE TRIGGER red_checklist_reponses_03_controle BEFORE INSERT ON red_checklist_reponses
  FOR EACH ROW EXECUTE FUNCTION red_controler_checklist_reponse();
