-- Banque de CV des appels d'offres (AO-04, PRD complémentaire §9, lot AO-B).
--
-- - ao_cv           : IDENTITÉ d'un CV (expert interne rattaché à un collaborateur, ou externe),
--                     jamais modifiée.
-- - ao_cv_versions  : contenu structuré et DATÉ (expériences, diplômes, langues, secteurs), en
--                     AJOUT SEUL ; une correction est une nouvelle version, motif obligatoire dès
--                     la version 2 ; la version courante est la plus grande. Le contenu est validé
--                     par le schéma partagé `cvContenuSchema` ; titre, secteurs et langues sont
--                     recopiés en colonnes pour la recherche.
-- - ao_cv_gabarits  : gabarits de mise en forme par bailleur, en DONNÉES : standard MissionPilot
--                     (cabinet_id nul, lecture seule pour les cabinets) et gabarits du cabinet.
--
-- Aucun calcul ici : années d'expérience et contrôle des exigences sortent du moteur pur
-- packages/engines/src/banque-cv. Les appels d'offres (lot AO-A) ne sont pas référencés ici.
-- SQLSTATE du lot (lettre W) : MPW01 (ajout seul, champ figé), MPW02 (versions consécutives),
-- MPW03 (cohérence d'un rattachement ou d'une validation), MPW04 (validation d'un brouillon IA
-- sans acquittement des nombres non vérifiés). Le portail client n'y accède jamais.

CREATE FUNCTION refuser_modification_banque_ao() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    RAISE EXCEPTION 'Banques et offres des appels d''offres en ajout seul : créer une nouvelle version.'
      USING ERRCODE = 'MPW01';
  END $$;

-- Versions consécutives (MPW02) ; TG_ARGV[0] : colonne de l'entité parente.
CREATE FUNCTION controler_version_banque_ao() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_parent uuid := (to_jsonb(NEW) ->> TG_ARGV[0])::uuid;
    v_suivante int;
  BEGIN
    EXECUTE format('SELECT coalesce(max(version), 0) + 1 FROM %I WHERE %I = $1',
                   TG_TABLE_NAME, TG_ARGV[0])
      INTO v_suivante USING v_parent;
    IF NEW.version <> v_suivante THEN
      RAISE EXCEPTION 'Les versions se suivent sans trou.' USING ERRCODE = 'MPW02';
    END IF;
    RETURN NEW;
  END $$;

CREATE TABLE ao_cv (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  numero bigint GENERATED ALWAYS AS IDENTITY,
  collaborateur_id uuid,
  nom text NOT NULL CHECK (length(btrim(nom)) BETWEEN 1 AND 160),
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, collaborateur_id) REFERENCES collaborateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
-- Un seul CV par collaborateur ; les experts externes n'ont pas de collaborateur.
CREATE UNIQUE INDEX ao_cv_collaborateur_uniq ON ao_cv (cabinet_id, collaborateur_id)
  WHERE collaborateur_id IS NOT NULL;
CREATE INDEX ao_cv_tri_idx ON ao_cv (cabinet_id, lower(nom), id);
ALTER TABLE ao_cv ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON ao_cv
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON ao_cv AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON ao_cv FROM missionpilot_app;
CREATE TRIGGER ao_cv_ajout_seul BEFORE UPDATE OR DELETE ON ao_cv
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_banque_ao();

CREATE TABLE ao_cv_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  cv_id uuid NOT NULL,
  version int NOT NULL CHECK (version BETWEEN 1 AND 10000),
  contenu jsonb NOT NULL
    CHECK (jsonb_typeof(contenu) = 'object' AND octet_length(contenu::text) <= 400000),
  titre text NOT NULL CHECK (length(btrim(titre)) BETWEEN 1 AND 200),
  secteurs text[] NOT NULL DEFAULT '{}' CHECK (cardinality(secteurs) <= 20),
  langues text[] NOT NULL DEFAULT '{}' CHECK (cardinality(langues) <= 10),
  motif text CHECK (motif IS NULL OR length(btrim(motif)) BETWEEN 1 AND 500),
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (cv_id, version),
  CHECK ((version = 1) = (motif IS NULL)),
  FOREIGN KEY (cabinet_id, cv_id) REFERENCES ao_cv (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX ao_cv_versions_courante_idx ON ao_cv_versions (cabinet_id, cv_id, version DESC);
ALTER TABLE ao_cv_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON ao_cv_versions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON ao_cv_versions AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON ao_cv_versions FROM missionpilot_app;
CREATE TRIGGER ao_cv_versions_ajout_seul BEFORE UPDATE OR DELETE ON ao_cv_versions
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_banque_ao();
CREATE TRIGGER ao_cv_versions_consecutives BEFORE INSERT ON ao_cv_versions
  FOR EACH ROW EXECUTE FUNCTION controler_version_banque_ao('cv_id');

CREATE TABLE ao_cv_gabarits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL : gabarit standard MissionPilot, en lecture seule pour tous les cabinets.
  cabinet_id uuid REFERENCES cabinets (id) ON DELETE CASCADE,
  code text NOT NULL CHECK (code ~ '^[a-z0-9_]{1,40}$'),
  libelle text NOT NULL CHECK (length(btrim(libelle)) BETWEEN 1 AND 160),
  bailleur text NOT NULL CHECK (length(btrim(bailleur)) BETWEEN 1 AND 120),
  -- [{ "section": "identite" | "resume" | …, "titre": "…" }], validé par `gabaritCvSectionsSchema`.
  sections jsonb NOT NULL
    CHECK (jsonb_typeof(sections) = 'array' AND jsonb_array_length(sections) BETWEEN 1 AND 7),
  ordre_experiences text NOT NULL DEFAULT 'antechronologique'
    CHECK (ordre_experiences IN ('antechronologique', 'chronologique')),
  experiences_annees_max int CHECK (experiences_annees_max IS NULL
    OR experiences_annees_max BETWEEN 1 AND 60),
  cree_par uuid,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  CHECK ((cabinet_id IS NULL) = (cree_par IS NULL)),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE UNIQUE INDEX ao_cv_gabarits_cabinet_uniq ON ao_cv_gabarits (cabinet_id, code)
  WHERE cabinet_id IS NOT NULL;
CREATE UNIQUE INDEX ao_cv_gabarits_standard_uniq ON ao_cv_gabarits (code) WHERE cabinet_id IS NULL;
ALTER TABLE ao_cv_gabarits ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON ao_cv_gabarits
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY standard_lecture ON ao_cv_gabarits FOR SELECT
  USING (cabinet_id IS NULL AND app_cabinet_id() IS NOT NULL);
CREATE POLICY portail_interdit ON ao_cv_gabarits AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON ao_cv_gabarits FROM missionpilot_app;
CREATE TRIGGER ao_cv_gabarits_ajout_seul BEFORE UPDATE OR DELETE ON ao_cv_gabarits
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_banque_ao();

-- Gabarits standard de départ : sections et ordre usuels des formulaires de CV des bailleurs,
-- à faire confirmer sur les dossiers types de chaque bailleur avant usage réel.
INSERT INTO ao_cv_gabarits (cabinet_id, code, libelle, bailleur, sections, ordre_experiences,
  experiences_annees_max) VALUES
  (NULL, 'generique', 'CV générique', 'Tout bailleur',
   '[{"section":"identite","titre":"Identité"},{"section":"resume","titre":"Profil"},
     {"section":"formations","titre":"Formation"},{"section":"langues","titre":"Langues"},
     {"section":"experiences","titre":"Expérience professionnelle"},
     {"section":"competences","titre":"Compétences"},
     {"section":"secteurs","titre":"Secteurs d''intervention"}]',
   'antechronologique', NULL),
  (NULL, 'banque_mondiale', 'Curriculum vitae (format Banque mondiale)', 'Banque mondiale',
   '[{"section":"identite","titre":"Nom de l''expert et poste proposé"},
     {"section":"formations","titre":"Formation"},
     {"section":"langues","titre":"Langues"},
     {"section":"experiences","titre":"Expérience professionnelle"},
     {"section":"competences","titre":"Compétences adaptées à la mission"}]',
   'antechronologique', NULL),
  (NULL, 'bad', 'Curriculum vitae (format Banque africaine de développement)',
   'Banque africaine de développement',
   '[{"section":"identite","titre":"Identité et poste proposé"},
     {"section":"formations","titre":"Diplômes"},
     {"section":"langues","titre":"Connaissances linguistiques"},
     {"section":"experiences","titre":"Expérience professionnelle"},
     {"section":"secteurs","titre":"Secteurs d''expérience"}]',
   'antechronologique', NULL),
  (NULL, 'union_europeenne', 'Curriculum vitae (format Union européenne)', 'Union européenne',
   '[{"section":"identite","titre":"Identité"},
     {"section":"formations","titre":"Éducation"},
     {"section":"langues","titre":"Compétences linguistiques"},
     {"section":"competences","titre":"Autres compétences"},
     {"section":"experiences","titre":"Expérience professionnelle"}]',
   'antechronologique', 15);
