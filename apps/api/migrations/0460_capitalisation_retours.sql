-- Capitalisation (lot CAP, PRD complémentaire §12) — recherche plein texte et retour
-- d'expérience (CAP-01).
--
-- SQLSTATE du domaine (lettre J, plage 0460–0479) :
--   MPJ01 historique de la capitalisation en ajout seul ;
--   MPJ02 circuit du retour d'expérience (validation définitive d'une version existante,
--         versions consécutives, aucune version après validation) ;
--   MPJ03 rattachement tâche → brique d'une mission clôturée ;
--   MPJ04 séparation des tâches des compétences (niveau validé par la personne elle-même ou
--         par son déclarant hors associé) ;
--   MPJ05 cohérence (mission, retour, collaborateur, compétence).
--
-- Recherche (CAP-07) : `cap_sans_accents` (minuscules, accents retirés, IMMUABLE : utilisable
-- dans un index) et `cap_tsv` / `cap_tsq` (configuration « french »). Les deux côtés de la
-- comparaison passent par la même normalisation : « décision » et « decision » se valent.
--
-- Retour d'expérience : une IDENTITÉ par mission (`retours_experience`, brouillon → validé,
-- définitif) et des VERSIONS en ajout seul (`retour_experience_versions` : gabarit déterministe
-- construit depuis les données de la mission, brouillon IA, ou rédaction humaine). Seule la
-- version validée par le chef ou le directeur de la mission (ou un associé) est versée à la base
-- de connaissances. Le portail client n'y accède jamais (`portail_interdit`).

CREATE FUNCTION cap_sans_accents(p text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$
    SELECT pg_catalog.replace(pg_catalog.replace(pg_catalog.translate(pg_catalog.lower(p),
      'àâäáãåçéèêëíìîïñóòôöõúùûüýÿ', 'aaaaaaceeeeiiiinooooouuuuyy'), 'œ', 'oe'), 'æ', 'ae')
  $$;

CREATE FUNCTION cap_tsv(p text) RETURNS tsvector
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$
    SELECT pg_catalog.to_tsvector('pg_catalog.french'::regconfig,
      public.cap_sans_accents(coalesce(p, '')))
  $$;

CREATE FUNCTION cap_tsq(p text) RETURNS tsquery
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$
    SELECT pg_catalog.websearch_to_tsquery('pg_catalog.french'::regconfig,
      public.cap_sans_accents(coalesce(p, '')))
  $$;

CREATE FUNCTION cap_ajout_seul() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    RAISE EXCEPTION 'Historique de la capitalisation en ajout seul.' USING ERRCODE = 'MPJ01';
  END $$;

CREATE TABLE retours_experience (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  mission_id uuid NOT NULL,
  statut text NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon', 'valide')),
  version_validee integer CHECK (version_validee IS NULL OR version_validee BETWEEN 1 AND 1000),
  valide_par uuid,
  valide_le timestamptz,
  ouvert_par uuid NOT NULL,
  ouvert_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, mission_id),
  FOREIGN KEY (cabinet_id, mission_id) REFERENCES missions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, ouvert_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, valide_par) REFERENCES utilisateurs (cabinet_id, id),
  CHECK ((statut = 'valide') = (version_validee IS NOT NULL AND valide_par IS NOT NULL
                                AND valide_le IS NOT NULL))
);
CREATE INDEX retours_experience_tri_idx ON retours_experience (cabinet_id, ouvert_le DESC, id DESC);
ALTER TABLE retours_experience ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON retours_experience
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON retours_experience AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON retours_experience FROM missionpilot_app;
GRANT UPDATE (statut, version_validee, valide_par, valide_le) ON retours_experience
  TO missionpilot_app;

CREATE TABLE retour_experience_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  retour_id uuid NOT NULL,
  version integer NOT NULL CHECK (version BETWEEN 1 AND 1000),
  origine text NOT NULL CHECK (origine IN ('gabarit', 'ia', 'humain')),
  contexte text NOT NULL CHECK (length(btrim(contexte)) BETWEEN 1 AND 8000),
  methode text NOT NULL CHECK (length(btrim(methode)) BETWEEN 1 AND 8000),
  ecarts text NOT NULL CHECK (length(btrim(ecarts)) BETWEEN 1 AND 8000),
  lecons text NOT NULL CHECK (length(btrim(lecons)) BETWEEN 1 AND 8000),
  -- Faits calculés par les moteurs à la rédaction (jours, écarts, briques, dérogations) : trace.
  donnees jsonb NOT NULL DEFAULT '{}'
    CHECK (jsonb_typeof(donnees) = 'object' AND octet_length(donnees::text) <= 200000),
  -- Génération IA à l'origine de la version (brouillon IA, ou repli sur gabarit).
  ia_demande_id uuid,
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (retour_id, version),
  FOREIGN KEY (cabinet_id, retour_id) REFERENCES retours_experience (cabinet_id, id),
  FOREIGN KEY (cabinet_id, ia_demande_id) REFERENCES ia_demandes (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id),
  CHECK (origine <> 'ia' OR ia_demande_id IS NOT NULL)
);
CREATE INDEX retour_experience_versions_idx
  ON retour_experience_versions (cabinet_id, retour_id, version DESC);
CREATE INDEX retour_experience_versions_recherche_idx ON retour_experience_versions
  USING gin (cap_tsv(contexte || ' ' || methode || ' ' || ecarts || ' ' || lecons));
ALTER TABLE retour_experience_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON retour_experience_versions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON retour_experience_versions AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON retour_experience_versions FROM missionpilot_app;
CREATE TRIGGER retour_experience_versions_ajout_seul
  BEFORE UPDATE OR DELETE ON retour_experience_versions
  FOR EACH ROW EXECUTE FUNCTION cap_ajout_seul();

-- Versions consécutives, jamais après la validation (MPJ02).
CREATE FUNCTION controler_retour_version() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_statut text;
  BEGIN
    SELECT statut INTO v_statut FROM retours_experience WHERE id = NEW.retour_id FOR UPDATE;
    IF NOT FOUND OR v_statut <> 'brouillon' THEN
      RAISE EXCEPTION 'Retour d''expérience validé : aucune nouvelle version.' USING ERRCODE = 'MPJ02';
    END IF;
    IF NEW.version <> (SELECT coalesce(max(v.version), 0) + 1 FROM retour_experience_versions v
                       WHERE v.retour_id = NEW.retour_id) THEN
      RAISE EXCEPTION 'Les versions d''un retour d''expérience se suivent.' USING ERRCODE = 'MPJ02';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER retour_experience_versions_controle BEFORE INSERT ON retour_experience_versions
  FOR EACH ROW EXECUTE FUNCTION controler_retour_version();

-- Identité figée ; seule transition : brouillon → validé, sur une version existante (MPJ02).
CREATE FUNCTION controler_retour_experience() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Un retour d''expérience ne se supprime pas.' USING ERRCODE = 'MPJ01';
    END IF;
    IF (NEW.id, NEW.cabinet_id, NEW.mission_id, NEW.ouvert_par, NEW.ouvert_le)
       IS DISTINCT FROM (OLD.id, OLD.cabinet_id, OLD.mission_id, OLD.ouvert_par, OLD.ouvert_le)
       OR OLD.statut <> 'brouillon' OR NEW.statut <> 'valide' THEN
      RAISE EXCEPTION 'Validation du retour d''expérience définitive.' USING ERRCODE = 'MPJ02';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM retour_experience_versions v
                   WHERE v.retour_id = NEW.id AND v.version = NEW.version_validee) THEN
      RAISE EXCEPTION 'Version validée inexistante.' USING ERRCODE = 'MPJ02';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER retours_experience_controle BEFORE UPDATE OR DELETE ON retours_experience
  FOR EACH ROW EXECUTE FUNCTION controler_retour_experience();
