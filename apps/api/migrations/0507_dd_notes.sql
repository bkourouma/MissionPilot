-- Note au comité (DD-13), en AJOUT SEUL : versions, soumission à base FIGÉE par les moteurs,
-- validation par un tiers.
--
-- - dd_notes             : identité d'une note d'un dossier (jamais modifiée).
-- - dd_note_versions     : contenu (recommandation, synthèse, conditions). Une version `brouillon`
--   se corrige par une nouvelle version ; une version `soumise` porte la `base_figee` (jsonb,
--   1 Mo au plus) construite PAR LE SERVEUR depuis les moteurs (apps/api/src/due-diligence/
--   base-note.ts) : jamais reçue d'un client, aucun verbatim nominatif ni nom de personne.
--   Garde MPZ29 de COHÉRENCE (la base est calculée par l'API ; du SQL arbitraire du même rôle la
--   contournerait, limite connue, comme la garde de provenance de 0270) : base présente, bloquants
--   vides, aucune exclusion bloquante pour une recommandation favorable, au moins une condition
--   pour « favorable sous conditions ».
-- - dd_note_validations  : décision d'un TIERS sur une version soumise (une par version) ; seule une
--   version validée se rend en rapport (MPR04, 0508). MPZ26 : le valideur n'est ni le créateur de
--   la note ni l'auteur d'aucune de ses versions (brouillons et soumissions compris), sauf
--   associé ; MPZ27 : la version est la DERNIÈRE soumise de sa note.
--
-- SQLSTATE : MPZ23, MPZ26, MPZ27, MPZ29.

CREATE TABLE dd_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  numero bigint GENERATED ALWAYS AS IDENTITY,
  dossier_id uuid NOT NULL,
  titre text NOT NULL CHECK (std_libelle_valide(titre, 200)),
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, dossier_id) REFERENCES dd_dossiers (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX dd_notes_dossier_idx ON dd_notes (cabinet_id, dossier_id, numero);
ALTER TABLE dd_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON dd_notes
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON dd_notes AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON dd_notes FROM missionpilot_app;
CREATE TRIGGER dd_notes_ajout_seul BEFORE UPDATE OR DELETE ON dd_notes
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_dd();
CREATE TRIGGER dd_notes_auteur_sans_portail BEFORE INSERT ON dd_notes
  FOR EACH ROW EXECUTE FUNCTION refuser_utilisateur_portail('cree_par');

CREATE TABLE dd_note_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  numero bigint GENERATED ALWAYS AS IDENTITY,
  note_id uuid NOT NULL,
  version int NOT NULL CHECK (version BETWEEN 1 AND 200),
  etat text NOT NULL CHECK (etat IN ('brouillon', 'soumise')),
  recommandation text NOT NULL CHECK (recommandation IN
    ('favorable', 'favorable_sous_conditions', 'reservee', 'defavorable')),
  synthese text NOT NULL CHECK (length(synthese) BETWEEN 1 AND 4000),
  conditions text[] NOT NULL DEFAULT '{}' CHECK (dd_textes_valides(conditions, 20, 300)),
  base_figee jsonb,
  soumise_le timestamptz,
  motif text CHECK (motif IS NULL OR length(motif) BETWEEN 1 AND 500),
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (note_id, version),
  UNIQUE (cabinet_id, note_id, version),
  CHECK ((version = 1) = (motif IS NULL)),
  CHECK ((etat = 'soumise') = (base_figee IS NOT NULL AND soumise_le IS NOT NULL)),
  CONSTRAINT dd_note_versions_base_taille_check
    CHECK (base_figee IS NULL OR octet_length(base_figee::text) <= 1000000),
  FOREIGN KEY (cabinet_id, note_id) REFERENCES dd_notes (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX dd_note_versions_courante_idx ON dd_note_versions (cabinet_id, note_id, version DESC);
ALTER TABLE dd_note_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON dd_note_versions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON dd_note_versions AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON dd_note_versions FROM missionpilot_app;
CREATE TRIGGER dd_note_versions_ajout_seul BEFORE UPDATE OR DELETE ON dd_note_versions
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_dd();
CREATE TRIGGER dd_note_versions_numerotation BEFORE INSERT ON dd_note_versions
  FOR EACH ROW EXECUTE FUNCTION dd_numeroter_version('note_id');
CREATE TRIGGER dd_note_versions_auteur_sans_portail BEFORE INSERT ON dd_note_versions
  FOR EACH ROW EXECUTE FUNCTION refuser_utilisateur_portail('cree_par');

-- MPZ29 : version soumise cohérente (garde de COHÉRENCE, pas de provenance).
CREATE FUNCTION controler_dd_note_version() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_exclusions text;
  BEGIN
    IF NEW.etat = 'soumise' THEN
      IF NEW.base_figee IS NULL OR NEW.soumise_le IS NULL
         OR jsonb_typeof(NEW.base_figee) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'Une version soumise porte sa base figée.' USING ERRCODE = 'MPZ29';
      END IF;
      IF jsonb_typeof(NEW.base_figee -> 'bloquants') IS DISTINCT FROM 'array'
         OR jsonb_array_length(NEW.base_figee -> 'bloquants') <> 0 THEN
        RAISE EXCEPTION 'Une version soumise ne porte aucun bloquant.' USING ERRCODE = 'MPZ29';
      END IF;
      v_exclusions := NEW.base_figee ->> 'exclusions_bloquantes';
      IF v_exclusions IS NULL OR v_exclusions !~ '^[0-9]{1,9}$' THEN
        RAISE EXCEPTION 'Le nombre d''exclusions bloquantes de la base figée est absent.'
          USING ERRCODE = 'MPZ29';
      END IF;
      IF v_exclusions::integer <> 0
         AND NEW.recommandation IN ('favorable', 'favorable_sous_conditions') THEN
        RAISE EXCEPTION 'Une recommandation favorable exige que les exclusions soient levées.'
          USING ERRCODE = 'MPZ29';
      END IF;
      IF NEW.recommandation = 'favorable_sous_conditions' AND cardinality(NEW.conditions) = 0 THEN
        RAISE EXCEPTION 'Une recommandation favorable sous conditions énonce ses conditions.'
          USING ERRCODE = 'MPZ29';
      END IF;
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER dd_note_versions_controle BEFORE INSERT ON dd_note_versions
  FOR EACH ROW EXECUTE FUNCTION controler_dd_note_version();

CREATE TABLE dd_note_validations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  numero bigint GENERATED ALWAYS AS IDENTITY,
  note_version_id uuid NOT NULL UNIQUE,
  decision text NOT NULL CHECK (decision IN ('valide', 'rejete')),
  motif text CHECK (motif IS NULL OR length(motif) BETWEEN 1 AND 1000),
  valide_par uuid NOT NULL,
  valide_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  CHECK (decision = 'valide' OR motif IS NOT NULL),
  FOREIGN KEY (cabinet_id, note_version_id) REFERENCES dd_note_versions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, valide_par) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE dd_note_validations ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON dd_note_validations
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON dd_note_validations AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON dd_note_validations FROM missionpilot_app;
CREATE TRIGGER dd_note_validations_ajout_seul BEFORE UPDATE OR DELETE ON dd_note_validations
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_dd();
CREATE TRIGGER dd_note_validations_auteur_sans_portail BEFORE INSERT ON dd_note_validations
  FOR EACH ROW EXECUTE FUNCTION refuser_utilisateur_portail('valide_par');

-- MPZ27 : la version est soumise et la DERNIÈRE soumise de sa note ; MPZ26 : séparation des
-- tâches (sauf associé), même règle que le contrôle de l'API.
CREATE FUNCTION controler_dd_note_validation() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    v record;
  BEGIN
    SELECT x.note_id, x.etat, x.version INTO v FROM dd_note_versions x
      WHERE x.id = NEW.note_version_id;
    IF v.etat IS DISTINCT FROM 'soumise' OR EXISTS (
         SELECT 1 FROM dd_note_versions y
         WHERE y.note_id = v.note_id AND y.etat = 'soumise' AND y.version > v.version) THEN
      RAISE EXCEPTION 'Cette version n''est plus la dernière version soumise de la note.'
        USING ERRCODE = 'MPZ27';
    END IF;
    IF NOT est_associe_dd(NEW.valide_par)
       AND (EXISTS (SELECT 1 FROM dd_notes n WHERE n.id = v.note_id AND n.cree_par = NEW.valide_par)
            OR EXISTS (SELECT 1 FROM dd_note_versions z
                       WHERE z.note_id = v.note_id AND z.cree_par = NEW.valide_par)) THEN
      RAISE EXCEPTION 'Une note ne se valide ni par son créateur, ni par l''auteur d''une de ses versions.'
        USING ERRCODE = 'MPZ26';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER dd_note_validations_controle BEFORE INSERT ON dd_note_validations
  FOR EACH ROW EXECUTE FUNCTION controler_dd_note_validation();
