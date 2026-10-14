-- Bibliothèque de signaux d'alerte par secteur et pays (DD-11), propre au cabinet, VIDE au départ
-- (aucun contenu d'amorçage : travail d'experts, SPEC-3b §4.3 et §16). Ajout seul, versions.
--
-- - dd_signaux         : identité d'un signal (code unique par cabinet), jamais modifiée.
-- - dd_signal_versions : contenu ; la version courante est la plus grande ; `actif` se corrige par
--   une nouvelle version. `secteur_code` et `pays_code` NULL = tous (une filière, un secteur, un
--   pays ou une zone de la taxonomie, validés par l'API). `reference_publique` est le NOM d'un
--   document public, jamais un extrait.
-- Les signaux applicables à un dossier se calculent dans packages/engines (signauxApplicables).

CREATE TABLE dd_signaux (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  numero bigint GENERATED ALWAYS AS IDENTITY,
  code text NOT NULL CHECK (std_code_valide(code)),
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, code),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE dd_signaux ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON dd_signaux
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON dd_signaux AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON dd_signaux FROM missionpilot_app;
CREATE TRIGGER dd_signaux_ajout_seul BEFORE UPDATE OR DELETE ON dd_signaux
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_dd();
CREATE TRIGGER dd_signaux_auteur_sans_portail BEFORE INSERT ON dd_signaux
  FOR EACH ROW EXECUTE FUNCTION refuser_utilisateur_portail('cree_par');

CREATE TABLE dd_signal_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  numero bigint GENERATED ALWAYS AS IDENTITY,
  signal_id uuid NOT NULL,
  version int NOT NULL CHECK (version BETWEEN 1 AND 200),
  libelle text NOT NULL CHECK (std_libelle_valide(libelle, 200)),
  description text CHECK (description IS NULL OR length(description) BETWEEN 1 AND 2000),
  famille text NOT NULL CHECK (famille IN ('pays', 'change', 'operationnel', 'reglementaire')),
  secteur_code text CHECK (secteur_code IS NULL OR std_code_valide(secteur_code)),
  pays_code text CHECK (pays_code IS NULL OR std_code_valide(pays_code)),
  gravite_indicative text NOT NULL
    CHECK (gravite_indicative IN ('faible', 'modere', 'eleve', 'critique')),
  question text CHECK (question IS NULL OR length(question) BETWEEN 1 AND 1000),
  reference_publique text CHECK (reference_publique IS NULL
    OR length(reference_publique) BETWEEN 1 AND 500),
  actif boolean NOT NULL DEFAULT true,
  motif text CHECK (motif IS NULL OR length(motif) BETWEEN 1 AND 500),
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (signal_id, version),
  UNIQUE (cabinet_id, signal_id, version),
  CHECK ((version = 1) = (motif IS NULL)),
  FOREIGN KEY (cabinet_id, signal_id) REFERENCES dd_signaux (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX dd_signal_versions_courante_idx
  ON dd_signal_versions (cabinet_id, signal_id, version DESC);
ALTER TABLE dd_signal_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON dd_signal_versions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON dd_signal_versions AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON dd_signal_versions FROM missionpilot_app;
CREATE TRIGGER dd_signal_versions_ajout_seul BEFORE UPDATE OR DELETE ON dd_signal_versions
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_dd();
CREATE TRIGGER dd_signal_versions_numerotation BEFORE INSERT ON dd_signal_versions
  FOR EACH ROW EXECUTE FUNCTION dd_numeroter_version('signal_id');
CREATE TRIGGER dd_signal_versions_auteur_sans_portail BEFORE INSERT ON dd_signal_versions
  FOR EACH ROW EXECUTE FUNCTION refuser_utilisateur_portail('cree_par');
