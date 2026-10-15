-- Due diligence (service #2, DD-01 à DD-15, vague 4, lot 3b, ADR-012) : socle du module, dossiers
-- et cadrage versionné (DD-01). Plage réservée du lot : 0500 à 0519.
--
-- Principes communs aux vingt tables `dd_*` (0500 à 0507), tous éprouvés par test/dd-base.test.ts :
-- - AJOUT SEUL, même pour le propriétaire : REVOKE UPDATE, DELETE au rôle applicatif ET
--   déclencheur `refuser_modification_dd` (MPZ21). Une correction est une nouvelle version (motif
--   obligatoire dès la version 2), un lien retiré est un événement, un retrait d'élément est une
--   version `retire = true` ; l'état courant se dérive (version la plus grande, dernier événement).
-- - RLS : politique `isolation` (cabinet) et politique RESTRICTIVE `portail_interdit` (le portail
--   client n'y accède jamais). Clés étrangères COMPOSITES (cabinet_id, x_id) vers toute table du
--   cabinet. Aucune colonne ne référence `fichiers` : les sources passent par le registre des
--   preuves (0240 à 0243), `fichier_orphelin` est inchangée.
-- - Aucun calcul ici (les chiffres sortent de packages/engines) : les contrôles SQL sont
--   structurels ou de cohérence. Aucune fonction SECURITY DEFINER, aucun job, aucune IA.
-- - Les auteurs (cree_par, auteur_id, proposee_par, valide_par…) passent par
--   `refuser_utilisateur_portail` (0113) : un compte du portail n'écrit jamais.
--
-- SQLSTATE du lot (lettre Z partagée avec le redressement, numéros 21 à 32 ; décision de la
-- spécification, à confirmer par le Pilote) :
-- MPZ21 (ajout seul), MPZ22 (rattachement incohérent), MPZ23 (versions sans trou), MPZ24 (verdict
-- sans source), MPZ25 (séparation des tâches, verdict), MPZ26 (idem, note), MPZ27 (validation
-- d'une version périmée), MPZ28 (séparation des tâches, exclusion), MPZ29 (note soumise
-- incohérente), MPZ30 (action du plan des 100 jours), MPZ31 (paramètre de dimensionnement sans
-- source), MPZ32 (verdict déjà en attente) ; MPR04 : 0508.

CREATE FUNCTION refuser_modification_dd() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    RAISE EXCEPTION 'Due diligence en ajout seul : corriger par une nouvelle version ou un événement.'
      USING ERRCODE = 'MPZ21';
  END $$;

-- Associé actif : seul rôle dispensé de la séparation des tâches du lot. Fonction d'appelant (pas
-- SECURITY DEFINER) : elle lit sous la RLS du cabinet.
CREATE FUNCTION est_associe_dd(p_utilisateur uuid) RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = public, pg_temp
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM utilisateurs u
      WHERE u.id = p_utilisateur AND u.actif AND 'associe' = ANY (u.roles))
  $$;

-- Catégories d'une analyse (vocabulaire fermé, packages/shared ; test d'égalité dd-vocabulaire).
CREATE FUNCTION dd_categorie_valide(p_analyse text, p_categorie text) RETURNS boolean
  LANGUAGE sql IMMUTABLE
  SET search_path = public, pg_temp
  AS $$
    SELECT CASE p_analyse
      WHEN 'pestel' THEN p_categorie = ANY (ARRAY['politique', 'economique', 'social',
        'technologique', 'environnemental', 'juridique'])
      WHEN 'cinq_forces' THEN p_categorie = ANY (ARRAY['rivalite', 'nouveaux_entrants',
        'substituts', 'pouvoir_clients', 'pouvoir_fournisseurs'])
      WHEN 'swot' THEN p_categorie = ANY (ARRAY['forces', 'faiblesses', 'opportunites', 'menaces'])
      WHEN 'operationnelle' THEN p_categorie = ANY (ARRAY['processus', 'approvisionnement',
        'goulots'])
      ELSE false
    END
  $$;

-- Tableau de textes borné : au plus `p_max` éléments, chacun de 1 à `p_longueur` caractères.
CREATE FUNCTION dd_textes_valides(p_textes text[], p_max integer, p_longueur integer) RETURNS boolean
  LANGUAGE sql IMMUTABLE
  SET search_path = public, pg_temp
  AS $$
    SELECT cardinality(p_textes) <= p_max
      AND NOT EXISTS (SELECT 1 FROM unnest(p_textes) t
                      WHERE length(btrim(t)) = 0 OR length(t) > p_longueur)
  $$;

-- Numérotation sans trou (MPZ23) de toute table de versions : TG_ARGV[0] est la colonne de
-- l'identité parente (constante du déclencheur, jamais une valeur reçue). Le verrou de la mission
-- sérialise les écritures ; l'unicité (parent, version) est le filet.
CREATE FUNCTION dd_numeroter_version() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_parent uuid := (to_jsonb(NEW) ->> TG_ARGV[0])::uuid;
    v_attendue integer;
  BEGIN
    EXECUTE format('SELECT coalesce(max(version), 0) + 1 FROM %I WHERE %I = $1',
                   TG_TABLE_NAME, TG_ARGV[0])
      INTO v_attendue USING v_parent;
    IF NEW.version IS DISTINCT FROM v_attendue THEN
      RAISE EXCEPTION 'Les versions se suivent sans trou : rechargez puis recommencez.'
        USING ERRCODE = 'MPZ23';
    END IF;
    RETURN NEW;
  END $$;

-- ---------------------------------------------------------------------------
-- Dossier : identité d'une opération d'investissement étudiée (pas le dossier client du lot DOS).
-- ---------------------------------------------------------------------------

CREATE TABLE dd_dossiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  numero bigint GENERATED ALWAYS AS IDENTITY,
  mission_id uuid NOT NULL,
  client_id uuid NOT NULL,
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, mission_id) REFERENCES missions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, client_id) REFERENCES clients (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX dd_dossiers_mission_idx ON dd_dossiers (cabinet_id, mission_id, numero DESC);
ALTER TABLE dd_dossiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON dd_dossiers
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON dd_dossiers AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON dd_dossiers FROM missionpilot_app;
CREATE TRIGGER dd_dossiers_ajout_seul BEFORE UPDATE OR DELETE ON dd_dossiers
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_dd();
CREATE TRIGGER dd_dossiers_auteur_sans_portail BEFORE INSERT ON dd_dossiers
  FOR EACH ROW EXECUTE FUNCTION refuser_utilisateur_portail('cree_par');

-- Le client d'un dossier est celui de sa mission (modèle `controler_preuve`, 0240).
CREATE FUNCTION controler_dd_dossier() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF NOT EXISTS (
         SELECT 1 FROM missions m WHERE m.id = NEW.mission_id AND m.client_id = NEW.client_id) THEN
      RAISE EXCEPTION 'Le dossier doit porter sur le client de sa mission.' USING ERRCODE = 'MPZ22';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER dd_dossiers_controle BEFORE INSERT ON dd_dossiers
  FOR EACH ROW EXECUTE FUNCTION controler_dd_dossier();

-- ---------------------------------------------------------------------------
-- Cadrage (DD-01), versionné. Les codes de secteur, de filière et de pays sont validés par l'API
-- contre `taxonomie_entrees` (lignes du standard, `cabinet_id` NULL : pas de clé étrangère).
-- ---------------------------------------------------------------------------

CREATE TABLE dd_cadrage_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  numero bigint GENERATED ALWAYS AS IDENTITY,
  dossier_id uuid NOT NULL,
  version int NOT NULL CHECK (version BETWEEN 1 AND 200),
  titre text NOT NULL CHECK (std_libelle_valide(titre, 200)),
  secteur_code text NOT NULL CHECK (std_code_valide(secteur_code)),
  filiere_code text CHECK (filiere_code IS NULL OR std_code_valide(filiere_code)),
  pays_code text NOT NULL CHECK (std_code_valide(pays_code)),
  cible_nom text CHECK (cible_nom IS NULL OR std_libelle_valide(cible_nom, 200)),
  type_operation text NOT NULL CHECK (type_operation IN ('acquisition', 'entree_marche', 'partenariat')),
  devise text NOT NULL CHECK (devise IN ('XOF', 'XAF', 'EUR', 'USD')),
  date_operation date CHECK (date_operation IS NULL
    OR date_operation BETWEEN '2000-01-01' AND '2100-12-31'),
  question_investissement text CHECK (question_investissement IS NULL
    OR length(question_investissement) BETWEEN 1 AND 2000),
  perimetre text CHECK (perimetre IS NULL OR length(perimetre) BETWEEN 1 AND 4000),
  motif text CHECK (motif IS NULL OR length(motif) BETWEEN 1 AND 500),
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (dossier_id, version),
  UNIQUE (cabinet_id, dossier_id, version),
  CHECK ((version = 1) = (motif IS NULL)),
  -- Provisoire (SPEC-3b §4.2) : une acquisition exige une cible nommée.
  CHECK (type_operation <> 'acquisition' OR cible_nom IS NOT NULL),
  FOREIGN KEY (cabinet_id, dossier_id) REFERENCES dd_dossiers (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX dd_cadrage_versions_courante_idx
  ON dd_cadrage_versions (cabinet_id, dossier_id, version DESC);
ALTER TABLE dd_cadrage_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON dd_cadrage_versions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON dd_cadrage_versions AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON dd_cadrage_versions FROM missionpilot_app;
CREATE TRIGGER dd_cadrage_versions_ajout_seul BEFORE UPDATE OR DELETE ON dd_cadrage_versions
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_dd();
CREATE TRIGGER dd_cadrage_versions_numerotation BEFORE INSERT ON dd_cadrage_versions
  FOR EACH ROW EXECUTE FUNCTION dd_numeroter_version('dossier_id');
CREATE TRIGGER dd_cadrage_versions_auteur_sans_portail BEFORE INSERT ON dd_cadrage_versions
  FOR EACH ROW EXECUTE FUNCTION refuser_utilisateur_portail('cree_par');
