-- Dimensionnement de marché (DD-12), descendant ou ascendant, en AJOUT SEUL.
--
-- - dd_dimensionnements          : identité (méthode figée à la création), jamais modifiée.
-- - dd_dimensionnement_versions  : paramètres sourcés, ajustements d'expert et RÉSULTAT du moteur
--   (packages/engines `dimensionnerMarche`) figé à l'écriture : stable même si la formule change
--   (`moteur_version`). Le résultat est calculé par l'API depuis le moteur, jamais reçu.
--   `parametres` : tableau de { code, unite, bas, base, haut, source } avec source =
--   { "type": "preuve", "preuve_id": uuid } ou { "type": "avis_expert", "motif": texte ≥ 10 }.
--   `ajustements` : tableau (≤ 10) de { libelle, facteur_bp, motif }.
--
-- SQLSTATE : MPZ23 (versions sans trou), MPZ31 (paramètre sans source valide : preuve d'une autre
-- mission ou avis d'expert sans motif ; le calcul à blanc de l'API, sans écriture, l'admet).
-- Données de MARCHÉ de l'opération étudiée : aucune donnée financière interne (FIN-02).

CREATE TABLE dd_dimensionnements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  numero bigint GENERATED ALWAYS AS IDENTITY,
  dossier_id uuid NOT NULL,
  methode text NOT NULL CHECK (methode IN ('descendant', 'ascendant')),
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, dossier_id) REFERENCES dd_dossiers (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX dd_dimensionnements_dossier_idx ON dd_dimensionnements (cabinet_id, dossier_id, numero);
ALTER TABLE dd_dimensionnements ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON dd_dimensionnements
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON dd_dimensionnements AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON dd_dimensionnements FROM missionpilot_app;
CREATE TRIGGER dd_dimensionnements_ajout_seul BEFORE UPDATE OR DELETE ON dd_dimensionnements
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_dd();
CREATE TRIGGER dd_dimensionnements_auteur_sans_portail BEFORE INSERT ON dd_dimensionnements
  FOR EACH ROW EXECUTE FUNCTION refuser_utilisateur_portail('cree_par');

CREATE TABLE dd_dimensionnement_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  numero bigint GENERATED ALWAYS AS IDENTITY,
  dimensionnement_id uuid NOT NULL,
  version int NOT NULL CHECK (version BETWEEN 1 AND 200),
  libelle text NOT NULL CHECK (std_libelle_valide(libelle, 200)),
  parametres jsonb NOT NULL,
  ajustements jsonb NOT NULL DEFAULT '[]',
  resultat jsonb NOT NULL,
  moteur_version smallint NOT NULL DEFAULT 1 CHECK (moteur_version >= 1),
  motif text CHECK (motif IS NULL OR length(motif) BETWEEN 1 AND 500),
  auteur_id uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (dimensionnement_id, version),
  UNIQUE (cabinet_id, dimensionnement_id, version),
  CHECK ((version = 1) = (motif IS NULL)),
  CHECK (jsonb_typeof(parametres) = 'array' AND jsonb_array_length(parametres) BETWEEN 1 AND 12),
  CHECK (jsonb_typeof(ajustements) = 'array' AND jsonb_array_length(ajustements) <= 10),
  CHECK (jsonb_typeof(resultat) = 'object' AND octet_length(resultat::text) <= 50000),
  FOREIGN KEY (cabinet_id, dimensionnement_id) REFERENCES dd_dimensionnements (cabinet_id, id),
  FOREIGN KEY (cabinet_id, auteur_id) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX dd_dimensionnement_versions_courante_idx
  ON dd_dimensionnement_versions (cabinet_id, dimensionnement_id, version DESC);
ALTER TABLE dd_dimensionnement_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON dd_dimensionnement_versions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON dd_dimensionnement_versions AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON dd_dimensionnement_versions FROM missionpilot_app;
CREATE TRIGGER dd_dimensionnement_versions_ajout_seul
  BEFORE UPDATE OR DELETE ON dd_dimensionnement_versions
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_dd();
CREATE TRIGGER dd_dimensionnement_versions_numerotation BEFORE INSERT ON dd_dimensionnement_versions
  FOR EACH ROW EXECUTE FUNCTION dd_numeroter_version('dimensionnement_id');
CREATE TRIGGER dd_dimensionnement_versions_auteur_sans_portail
  BEFORE INSERT ON dd_dimensionnement_versions
  FOR EACH ROW EXECUTE FUNCTION refuser_utilisateur_portail('auteur_id');

-- MPZ31 : chaque paramètre cite une preuve de la MISSION du dossier ou un avis d'expert motivé
-- (au moins 10 caractères) ; le calcul à blanc de l'API n'écrit rien et admet l'absence de source.
CREATE FUNCTION controler_dd_dimensionnement_version() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_mission uuid;
    v_parametre jsonb;
    v_source jsonb;
  BEGIN
    SELECT d.mission_id INTO v_mission
      FROM dd_dimensionnements m JOIN dd_dossiers d ON d.id = m.dossier_id
      WHERE m.id = NEW.dimensionnement_id;
    IF jsonb_typeof(NEW.parametres) = 'array' THEN
      FOR v_parametre IN SELECT p.value FROM jsonb_array_elements(NEW.parametres) p LOOP
        v_source := CASE WHEN jsonb_typeof(v_parametre) = 'object' THEN v_parametre -> 'source' END;
        IF jsonb_typeof(v_source) IS DISTINCT FROM 'object' THEN
          RAISE EXCEPTION 'Chaque paramètre cite sa source.' USING ERRCODE = 'MPZ31';
        END IF;
        IF v_source ->> 'type' = 'preuve' THEN
          IF coalesce(v_source ->> 'preuve_id', '')
               !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             OR NOT EXISTS (SELECT 1 FROM preuves p
                            WHERE p.id = (v_source ->> 'preuve_id')::uuid
                              AND p.mission_id = v_mission) THEN
            RAISE EXCEPTION 'La preuve citée n''appartient pas à la mission du dossier.'
              USING ERRCODE = 'MPZ31';
          END IF;
        ELSIF v_source ->> 'type' = 'avis_expert' THEN
          IF length(btrim(coalesce(v_source ->> 'motif', ''))) < 10 THEN
            RAISE EXCEPTION 'Un avis d''expert est motivé (10 caractères au moins).'
              USING ERRCODE = 'MPZ31';
          END IF;
        ELSE
          RAISE EXCEPTION 'Source de paramètre inconnue.' USING ERRCODE = 'MPZ31';
        END IF;
      END LOOP;
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER dd_dimensionnement_versions_controle BEFORE INSERT ON dd_dimensionnement_versions
  FOR EACH ROW EXECUTE FUNCTION controler_dd_dimensionnement_version();
