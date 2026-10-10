-- Offre technique d'un appel d'offres (AO-06, lot AO-B) : compréhension des termes de
-- référence, méthodologie, planning, organisation.
--
-- « L'IA propose, l'expert dispose » : la version 1 est un brouillon produit par l'orchestrateur
-- IA (origine `ia`, repli déterministe `gabarit`) ; toute modification humaine est une nouvelle
-- version (origine `manuel`, motif obligatoire) ; une version n'est utilisable qu'une fois
-- VALIDÉE par un humain (ao_offre_technique_validations). Statut affiché, déduit : dernière
-- version validée → « validée » ; sinon origine ia ou gabarit → « brouillon IA » ; sinon
-- « modifiée ». Le planning et l'organisation sont construits par le code depuis la méthode
-- standard et les CV : aucun nombre n'y vient du modèle de langage.
--
-- - ao_offres_techniques            : identité, contexte et liens (méthode, CV), jamais modifiés ;
--   l'appel d'offres (lot AO-A) est un identifiant facultatif SANS clé étrangère.
-- - ao_offre_technique_versions     : contenu en ajout seul (MPW01), versions consécutives (MPW02).
-- - ao_offre_technique_validations  : une validation par version, de la DERNIÈRE version
--   seulement (MPW03), avec acquittement des nombres non vérifiés d'un brouillon IA (MPW04).

CREATE TABLE ao_offres_techniques (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  numero bigint GENERATED ALWAYS AS IDENTITY,
  appel_offres_id uuid,
  titre text NOT NULL CHECK (length(btrim(titre)) BETWEEN 1 AND 300),
  -- Version de méthode (standard ou du cabinet) dont part la méthodologie ; lue sous RLS.
  methode_version_id uuid REFERENCES methode_versions (id),
  contexte jsonb NOT NULL
    CHECK (jsonb_typeof(contexte) = 'object' AND octet_length(contexte::text) <= 100000),
  cv_ids uuid[] NOT NULL DEFAULT '{}' CHECK (cardinality(cv_ids) <= 30),
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX ao_offres_techniques_tri_idx ON ao_offres_techniques (cabinet_id, numero DESC);
CREATE INDEX ao_offres_techniques_ao_idx ON ao_offres_techniques (cabinet_id, appel_offres_id)
  WHERE appel_offres_id IS NOT NULL;
ALTER TABLE ao_offres_techniques ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON ao_offres_techniques
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON ao_offres_techniques AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON ao_offres_techniques FROM missionpilot_app;
CREATE TRIGGER ao_offres_techniques_ajout_seul BEFORE UPDATE OR DELETE ON ao_offres_techniques
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_banque_ao();

CREATE TABLE ao_offre_technique_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  offre_id uuid NOT NULL,
  version int NOT NULL CHECK (version BETWEEN 1 AND 10000),
  sections jsonb NOT NULL
    CHECK (jsonb_typeof(sections) = 'object'
      AND sections ?& ARRAY['comprehension', 'methodologie', 'planning', 'organisation']
      AND octet_length(sections::text) <= 200000),
  origine text NOT NULL CHECK (origine IN ('ia', 'gabarit', 'manuel')),
  demande_ia_id uuid,
  chiffres_non_verifies boolean NOT NULL DEFAULT false,
  nombres_non_verifies text[] NOT NULL DEFAULT '{}' CHECK (cardinality(nombres_non_verifies) <= 200),
  motif text CHECK (motif IS NULL OR length(btrim(motif)) BETWEEN 1 AND 500),
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (offre_id, version),
  CHECK ((version = 1) = (motif IS NULL)),
  -- Le brouillon (IA ou gabarit) est la version 1 ; ensuite, des modifications humaines.
  CHECK ((origine = 'manuel') = (version > 1)),
  CHECK (origine <> 'ia' OR demande_ia_id IS NOT NULL),
  CHECK (origine <> 'manuel' OR (demande_ia_id IS NULL AND NOT chiffres_non_verifies)),
  FOREIGN KEY (cabinet_id, offre_id) REFERENCES ao_offres_techniques (cabinet_id, id),
  FOREIGN KEY (cabinet_id, demande_ia_id) REFERENCES ia_demandes (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX ao_offre_technique_versions_courante_idx
  ON ao_offre_technique_versions (cabinet_id, offre_id, version DESC);
ALTER TABLE ao_offre_technique_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON ao_offre_technique_versions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON ao_offre_technique_versions AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON ao_offre_technique_versions FROM missionpilot_app;
CREATE TRIGGER ao_offre_technique_versions_ajout_seul
  BEFORE UPDATE OR DELETE ON ao_offre_technique_versions
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_banque_ao();
CREATE TRIGGER ao_offre_technique_versions_consecutives BEFORE INSERT ON ao_offre_technique_versions
  FOR EACH ROW EXECUTE FUNCTION controler_version_banque_ao('offre_id');

CREATE TABLE ao_offre_technique_validations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  offre_id uuid NOT NULL,
  version_id uuid NOT NULL,
  valide_par uuid NOT NULL,
  acquitte_chiffres boolean NOT NULL DEFAULT false,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (version_id),
  FOREIGN KEY (cabinet_id, offre_id) REFERENCES ao_offres_techniques (cabinet_id, id),
  FOREIGN KEY (cabinet_id, version_id) REFERENCES ao_offre_technique_versions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, valide_par) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE ao_offre_technique_validations ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON ao_offre_technique_validations
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON ao_offre_technique_validations AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON ao_offre_technique_validations FROM missionpilot_app;
CREATE TRIGGER ao_offre_technique_validations_ajout_seul
  BEFORE UPDATE OR DELETE ON ao_offre_technique_validations
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_banque_ao();
CREATE TRIGGER ao_offre_technique_validations_sans_portail
  BEFORE INSERT ON ao_offre_technique_validations
  FOR EACH ROW EXECUTE FUNCTION refuser_utilisateur_portail('valide_par');

-- Validation de la DERNIÈRE version de l'offre (MPW03), nombres non vérifiés acquittés (MPW04).
CREATE FUNCTION controler_validation_offre_ao() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v ao_offre_technique_versions%ROWTYPE;
  BEGIN
    SELECT * INTO v FROM ao_offre_technique_versions WHERE id = NEW.version_id;
    IF v.offre_id IS DISTINCT FROM NEW.offre_id OR v.version <> (
         SELECT max(x.version) FROM ao_offre_technique_versions x WHERE x.offre_id = NEW.offre_id) THEN
      RAISE EXCEPTION 'Seule la dernière version d''une offre se valide.' USING ERRCODE = 'MPW03';
    END IF;
    IF v.chiffres_non_verifies AND NOT NEW.acquitte_chiffres THEN
      RAISE EXCEPTION 'Les nombres non vérifiés du brouillon IA doivent être acquittés.'
        USING ERRCODE = 'MPW04';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER ao_offre_technique_validations_controle
  BEFORE INSERT ON ao_offre_technique_validations
  FOR EACH ROW EXECUTE FUNCTION controler_validation_offre_ao();
