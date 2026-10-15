-- Éléments typés d'un dossier de due diligence (DD-03 à DD-06, DD-09, DD-15), leurs versions et les
-- constats de signaux (DD-11), en AJOUT SEUL (modèle du plan stratégique, 0180, et du registre des
-- preuves, 0240).
--
-- - dd_elements          : IDENTITÉ d'un élément (point d'une analyse, étape de la chaîne de valeur,
--   risque, hypothèse, action du plan des 100 jours), jamais modifiée. Les points et les risques
--   portent une `assertion_id` : leur affirmation est une assertion du registre des preuves (le
--   texte n'est PAS ici, il vit dans `assertion_versions.enonce`) ; une assertion = un élément.
-- - dd_element_versions  : contenu, une version = l'état COMPLET de l'élément (l'API recopie les
--   colonnes inchangées) ; `retire` retire l'élément des lectures courantes, une version suivante
--   peut le rétablir. La matrice des colonnes par type est imposée par un seul CHECK.
-- - dd_signal_constats   : journal du constat d'un signal sur un dossier ; l'état courant d'un
--   couple (dossier, signal) est son dernier constat (numero le plus grand).
--
-- SQLSTATE : MPZ22 (rattachement), MPZ23 (versions sans trou), MPZ30 (action du plan des 100
-- jours : responsable hors équipe, initiative ou KPI d'un autre client). Aucun calcul ici.

CREATE TABLE dd_elements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  numero bigint GENERATED ALWAYS AS IDENTITY,
  dossier_id uuid NOT NULL,
  type text NOT NULL
    CHECK (type IN ('point_analyse', 'etape_chaine', 'risque', 'hypothese', 'action_100j')),
  -- « analyse » est un mot réservé de PostgreSQL : la colonne se cite entre guillemets.
  "analyse" text CHECK ("analyse" IS NULL
    OR "analyse" IN ('pestel', 'cinq_forces', 'swot', 'operationnelle')),
  parent_id uuid,
  assertion_id uuid,
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, id, type),
  UNIQUE (cabinet_id, dossier_id, id),
  CHECK ((type = 'point_analyse') = ("analyse" IS NOT NULL)),
  CHECK (type = 'hypothese' OR parent_id IS NULL),
  CHECK ((type IN ('point_analyse', 'risque')) = (assertion_id IS NOT NULL)),
  FOREIGN KEY (cabinet_id, dossier_id) REFERENCES dd_dossiers (cabinet_id, id),
  FOREIGN KEY (cabinet_id, dossier_id, parent_id)
    REFERENCES dd_elements (cabinet_id, dossier_id, id),
  FOREIGN KEY (cabinet_id, assertion_id) REFERENCES assertions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
-- Une assertion, un élément.
CREATE UNIQUE INDEX dd_elements_assertion_uniq ON dd_elements (assertion_id)
  WHERE assertion_id IS NOT NULL;
CREATE INDEX dd_elements_dossier_idx ON dd_elements (cabinet_id, dossier_id, type, numero);
ALTER TABLE dd_elements ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON dd_elements
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON dd_elements AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON dd_elements FROM missionpilot_app;
CREATE TRIGGER dd_elements_ajout_seul BEFORE UPDATE OR DELETE ON dd_elements
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_dd();
CREATE TRIGGER dd_elements_auteur_sans_portail BEFORE INSERT ON dd_elements
  FOR EACH ROW EXECUTE FUNCTION refuser_utilisateur_portail('cree_par');

-- Rattachements (MPZ22) : l'assertion est de la mission du dossier ; le parent est une hypothèse du
-- même dossier et la profondeur de l'arbre ne dépasse pas 4 (remontée de 4 parents au plus).
CREATE FUNCTION controler_dd_element() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_mission uuid;
    v_courant uuid;
    v_profondeur integer := 1;
  BEGIN
    IF NEW.assertion_id IS NOT NULL THEN
      SELECT d.mission_id INTO v_mission FROM dd_dossiers d WHERE d.id = NEW.dossier_id;
      IF NOT EXISTS (
           SELECT 1 FROM assertions a WHERE a.id = NEW.assertion_id AND a.mission_id = v_mission) THEN
        RAISE EXCEPTION 'L''assertion n''appartient pas à la mission du dossier.'
          USING ERRCODE = 'MPZ22';
      END IF;
    END IF;
    IF NEW.parent_id IS NOT NULL THEN
      IF NOT EXISTS (
           SELECT 1 FROM dd_elements p
           WHERE p.id = NEW.parent_id AND p.dossier_id = NEW.dossier_id AND p.type = 'hypothese') THEN
        RAISE EXCEPTION 'Le parent d''une hypothèse est une hypothèse du même dossier.'
          USING ERRCODE = 'MPZ22';
      END IF;
      v_courant := NEW.parent_id;
      WHILE v_courant IS NOT NULL LOOP
        v_profondeur := v_profondeur + 1;
        IF v_profondeur > 4 THEN
          RAISE EXCEPTION 'L''arbre d''hypothèses ne dépasse pas 4 niveaux.' USING ERRCODE = 'MPZ22';
        END IF;
        SELECT p.parent_id INTO v_courant FROM dd_elements p WHERE p.id = v_courant;
      END LOOP;
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER dd_elements_controle BEFORE INSERT ON dd_elements
  FOR EACH ROW EXECUTE FUNCTION controler_dd_element();

CREATE TABLE dd_element_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  numero bigint GENERATED ALWAYS AS IDENTITY,
  element_id uuid NOT NULL,
  type text NOT NULL
    CHECK (type IN ('point_analyse', 'etape_chaine', 'risque', 'hypothese', 'action_100j')),
  version int NOT NULL CHECK (version BETWEEN 1 AND 200),
  libelle text CHECK (libelle IS NULL OR std_libelle_valide(libelle, 200)),
  description text CHECK (description IS NULL OR length(description) BETWEEN 1 AND 4000),
  categorie text CHECK (categorie IS NULL OR length(categorie) BETWEEN 1 AND 60),
  niveau text CHECK (niveau IS NULL OR niveau IN ('faible', 'modere', 'eleve', 'critique')),
  ordre int CHECK (ordre IS NULL OR ordre BETWEEN 1 AND 200),
  part_cout_bp int CHECK (part_cout_bp IS NULL OR part_cout_bp BETWEEN 0 AND 10000),
  part_marge_bp int CHECK (part_marge_bp IS NULL OR part_marge_bp BETWEEN 0 AND 10000),
  acteurs text[] NOT NULL DEFAULT '{}' CHECK (dd_textes_valides(acteurs, 12, 120)),
  contraintes text CHECK (contraintes IS NULL OR length(contraintes) BETWEEN 1 AND 2000),
  critere text CHECK (critere IS NULL OR length(critere) BETWEEN 1 AND 2000),
  etape_id uuid,
  signal_id uuid,
  responsable_id uuid,
  plan_element_id uuid,
  kpi_id uuid,
  jour_debut int CHECK (jour_debut IS NULL OR jour_debut BETWEEN 0 AND 100),
  jour_fin int CHECK (jour_fin IS NULL OR jour_fin BETWEEN 0 AND 100),
  statut_action text CHECK (statut_action IS NULL
    OR statut_action IN ('a_faire', 'en_cours', 'terminee', 'bloquee')),
  retire boolean NOT NULL DEFAULT false,
  motif text CHECK (motif IS NULL OR length(motif) BETWEEN 1 AND 500),
  auteur_id uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (element_id, version),
  UNIQUE (cabinet_id, element_id, version),
  CHECK ((version = 1) = (motif IS NULL)),
  -- Colonnes renseignées (R), facultatives (f) ou interdites (—) selon le type (SPEC-3b §4.4).
  CHECK (CASE type
    WHEN 'point_analyse' THEN categorie IS NOT NULL AND part_cout_bp IS NULL
      AND part_marge_bp IS NULL AND cardinality(acteurs) = 0 AND contraintes IS NULL
      AND critere IS NULL AND etape_id IS NULL AND signal_id IS NULL AND responsable_id IS NULL
      AND plan_element_id IS NULL AND kpi_id IS NULL AND jour_debut IS NULL AND jour_fin IS NULL
      AND statut_action IS NULL
    WHEN 'etape_chaine' THEN libelle IS NOT NULL AND ordre IS NOT NULL AND categorie IS NULL
      AND niveau IS NULL AND critere IS NULL AND etape_id IS NULL AND signal_id IS NULL
      AND responsable_id IS NULL AND plan_element_id IS NULL AND kpi_id IS NULL
      AND jour_debut IS NULL AND jour_fin IS NULL AND statut_action IS NULL
    WHEN 'risque' THEN libelle IS NOT NULL AND categorie IS NOT NULL AND niveau IS NOT NULL
      AND ordre IS NULL AND part_cout_bp IS NULL AND part_marge_bp IS NULL
      AND cardinality(acteurs) = 0 AND contraintes IS NULL AND critere IS NULL
      AND responsable_id IS NULL AND plan_element_id IS NULL AND kpi_id IS NULL
      AND jour_debut IS NULL AND jour_fin IS NULL AND statut_action IS NULL
    WHEN 'hypothese' THEN libelle IS NOT NULL AND categorie IS NULL AND niveau IS NULL
      AND part_cout_bp IS NULL AND part_marge_bp IS NULL AND cardinality(acteurs) = 0
      AND contraintes IS NULL AND etape_id IS NULL AND signal_id IS NULL
      AND responsable_id IS NULL AND plan_element_id IS NULL AND kpi_id IS NULL
      AND jour_debut IS NULL AND jour_fin IS NULL AND statut_action IS NULL
    WHEN 'action_100j' THEN libelle IS NOT NULL AND categorie IS NULL AND niveau IS NULL
      AND ordre IS NULL AND part_cout_bp IS NULL AND part_marge_bp IS NULL
      AND cardinality(acteurs) = 0 AND contraintes IS NULL AND critere IS NULL
      AND etape_id IS NULL AND signal_id IS NULL AND jour_debut IS NOT NULL
      AND jour_fin IS NOT NULL AND jour_debut <= jour_fin AND statut_action IS NOT NULL
    ELSE false
  END),
  FOREIGN KEY (cabinet_id, element_id, type) REFERENCES dd_elements (cabinet_id, id, type),
  FOREIGN KEY (cabinet_id, etape_id) REFERENCES dd_elements (cabinet_id, id),
  FOREIGN KEY (cabinet_id, signal_id) REFERENCES dd_signaux (cabinet_id, id),
  FOREIGN KEY (cabinet_id, responsable_id) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, plan_element_id) REFERENCES plan_elements (cabinet_id, id),
  FOREIGN KEY (cabinet_id, kpi_id) REFERENCES kpi_definitions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, auteur_id) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX dd_element_versions_courante_idx
  ON dd_element_versions (cabinet_id, element_id, version DESC);
ALTER TABLE dd_element_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON dd_element_versions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON dd_element_versions AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON dd_element_versions FROM missionpilot_app;
CREATE TRIGGER dd_element_versions_ajout_seul BEFORE UPDATE OR DELETE ON dd_element_versions
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_dd();
CREATE TRIGGER dd_element_versions_numerotation BEFORE INSERT ON dd_element_versions
  FOR EACH ROW EXECUTE FUNCTION dd_numeroter_version('element_id');
CREATE TRIGGER dd_element_versions_auteur_sans_portail BEFORE INSERT ON dd_element_versions
  FOR EACH ROW EXECUTE FUNCTION refuser_utilisateur_portail('auteur_id');
CREATE TRIGGER dd_element_versions_responsable_sans_portail BEFORE INSERT ON dd_element_versions
  FOR EACH ROW EXECUTE FUNCTION refuser_utilisateur_portail('responsable_id');

-- Rattachements d'une version (MPZ22, MPZ30) : catégorie valide pour son analyse (point) ou famille
-- de risque ; étape de la chaîne du même dossier ; action du plan des 100 jours : responsable
-- membre actif de la mission (s'il change), initiative d'un plan d'une mission du MÊME client,
-- KPI du même client.
CREATE FUNCTION controler_dd_element_version() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_element record;
    v_dossier record;
    v_precedente record;
  BEGIN
    SELECT e.dossier_id, e.analyse INTO v_element FROM dd_elements e WHERE e.id = NEW.element_id;
    SELECT d.mission_id, d.client_id INTO v_dossier FROM dd_dossiers d WHERE d.id = v_element.dossier_id;
    IF NEW.type = 'point_analyse' AND NOT dd_categorie_valide(v_element.analyse, NEW.categorie) THEN
      RAISE EXCEPTION 'Catégorie inconnue pour cette analyse.' USING ERRCODE = 'MPZ22';
    END IF;
    IF NEW.type = 'risque'
       AND NOT (coalesce(NEW.categorie, '')
                = ANY (ARRAY['pays', 'change', 'operationnel', 'reglementaire'])) THEN
      RAISE EXCEPTION 'Famille de risque inconnue.' USING ERRCODE = 'MPZ22';
    END IF;
    IF NEW.etape_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM dd_elements x
         WHERE x.id = NEW.etape_id AND x.dossier_id = v_element.dossier_id
           AND x.type = 'etape_chaine') THEN
      RAISE EXCEPTION 'L''étape désignée n''est pas une étape de la chaîne de valeur du dossier.'
        USING ERRCODE = 'MPZ22';
    END IF;
    IF NEW.type = 'action_100j' THEN
      SELECT v.responsable_id INTO v_precedente FROM dd_element_versions v
        WHERE v.element_id = NEW.element_id ORDER BY v.version DESC LIMIT 1;
      IF NEW.responsable_id IS NOT NULL
         AND NEW.responsable_id IS DISTINCT FROM v_precedente.responsable_id
         AND NOT est_membre_actif_mission(v_dossier.mission_id, NEW.responsable_id) THEN
        RAISE EXCEPTION 'Le responsable d''une action est un membre actif de la mission.'
          USING ERRCODE = 'MPZ30';
      END IF;
      IF NEW.plan_element_id IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM plan_elements pe
             JOIN plans_strategiques p ON p.id = pe.plan_id
             JOIN missions m ON m.id = p.mission_id
           WHERE pe.id = NEW.plan_element_id AND pe.type = 'initiative'
             AND m.client_id = v_dossier.client_id) THEN
        RAISE EXCEPTION 'L''initiative désignée n''appartient pas à un plan du même client.'
          USING ERRCODE = 'MPZ30';
      END IF;
      IF NEW.kpi_id IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM kpi_definitions k
           WHERE k.id = NEW.kpi_id AND k.client_id = v_dossier.client_id) THEN
        RAISE EXCEPTION 'Le KPI désigné n''appartient pas au même client.' USING ERRCODE = 'MPZ30';
      END IF;
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER dd_element_versions_controle BEFORE INSERT ON dd_element_versions
  FOR EACH ROW EXECUTE FUNCTION controler_dd_element_version();

-- Constats des signaux de la bibliothèque sur un dossier (DD-11).
CREATE TABLE dd_signal_constats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  numero bigint GENERATED ALWAYS AS IDENTITY,
  dossier_id uuid NOT NULL,
  signal_id uuid NOT NULL,
  signal_version int NOT NULL CHECK (signal_version BETWEEN 1 AND 200),
  etat text NOT NULL CHECK (etat IN ('constate', 'ecarte', 'a_verifier')),
  commentaire text CHECK (commentaire IS NULL OR length(commentaire) BETWEEN 1 AND 1000),
  risque_element_id uuid,
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  CHECK (etat <> 'ecarte' OR commentaire IS NOT NULL),
  FOREIGN KEY (cabinet_id, dossier_id) REFERENCES dd_dossiers (cabinet_id, id),
  FOREIGN KEY (cabinet_id, signal_id, signal_version)
    REFERENCES dd_signal_versions (cabinet_id, signal_id, version),
  FOREIGN KEY (cabinet_id, risque_element_id) REFERENCES dd_elements (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX dd_signal_constats_couple_idx
  ON dd_signal_constats (cabinet_id, dossier_id, signal_id, numero DESC);
ALTER TABLE dd_signal_constats ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON dd_signal_constats
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON dd_signal_constats AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON dd_signal_constats FROM missionpilot_app;
CREATE TRIGGER dd_signal_constats_ajout_seul BEFORE UPDATE OR DELETE ON dd_signal_constats
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_dd();
CREATE TRIGGER dd_signal_constats_auteur_sans_portail BEFORE INSERT ON dd_signal_constats
  FOR EACH ROW EXECUTE FUNCTION refuser_utilisateur_portail('cree_par');

-- Le risque rattaché au constat est un risque du même dossier (MPZ22).
CREATE FUNCTION controler_dd_signal_constat() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF NEW.risque_element_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM dd_elements e
         WHERE e.id = NEW.risque_element_id AND e.dossier_id = NEW.dossier_id
           AND e.type = 'risque') THEN
      RAISE EXCEPTION 'Le risque lié au constat n''appartient pas au dossier.'
        USING ERRCODE = 'MPZ22';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER dd_signal_constats_controle BEFORE INSERT ON dd_signal_constats
  FOR EACH ROW EXECUTE FUNCTION controler_dd_signal_constat();
