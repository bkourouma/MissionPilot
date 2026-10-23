-- Modèles d'analyse par secteur (DD-07), propres au cabinet, VIDES au départ : aucun contenu
-- d'amorçage (travail d'experts métier, SPEC-3b §1 et §16). Seul le véhicule est posé. Ajout seul,
-- versions, comme la bibliothèque de signaux (0501).
--
-- - dd_modeles_secteur         : identité d'un modèle (un secteur + une analyse, unique par
--   cabinet), jamais modifiée.
-- - dd_modele_secteur_versions : contenu ; la version courante est la plus grande ; le retrait
--   d'un modèle (`actif` = false) est une nouvelle version. `points` est une liste ordonnée de
--   « points à examiner » {categorie, libelle} : des RAPPELS pour l'expert, jamais des affirmations
--   (aucune assertion, aucun chiffre). La catégorie doit exister pour l'analyse du modèle (MQD11).
-- `secteur_code` est validé par l'API contre la taxonomie `secteur` (comme le cadrage).

CREATE TABLE dd_modeles_secteur (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  numero bigint GENERATED ALWAYS AS IDENTITY,
  secteur_code text NOT NULL CHECK (std_code_valide(secteur_code)),
  -- « analyse » est un mot réservé de PostgreSQL : la colonne se cite entre guillemets.
  "analyse" text NOT NULL
    CHECK ("analyse" IN ('pestel', 'cinq_forces', 'swot', 'operationnelle')),
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, secteur_code, "analyse"),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE dd_modeles_secteur ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON dd_modeles_secteur
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON dd_modeles_secteur AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON dd_modeles_secteur FROM missionpilot_app;
CREATE TRIGGER dd_modeles_secteur_ajout_seul BEFORE UPDATE OR DELETE ON dd_modeles_secteur
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_dd();
CREATE TRIGGER dd_modeles_secteur_auteur_sans_portail BEFORE INSERT ON dd_modeles_secteur
  FOR EACH ROW EXECUTE FUNCTION refuser_utilisateur_portail('cree_par');

-- Points d'un modèle : MQD11 si la forme est mauvaise ou si une catégorie est inconnue de l'analyse.
CREATE FUNCTION controler_dd_modele_points() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_analyse text;
    v_point jsonb;
  BEGIN
    -- Un `points` qui n'est pas une liste est refusé par le CHECK de la table (23514).
    IF jsonb_typeof(NEW.points) <> 'array' THEN RETURN NEW; END IF;
    SELECT m.analyse INTO v_analyse FROM dd_modeles_secteur m
      WHERE m.cabinet_id = NEW.cabinet_id AND m.id = NEW.modele_id;
    FOR v_point IN SELECT value FROM jsonb_array_elements(NEW.points) LOOP
      IF jsonb_typeof(v_point) <> 'object'
         OR (SELECT count(*) FROM jsonb_object_keys(v_point)) <> 2
         OR jsonb_typeof(v_point -> 'categorie') IS DISTINCT FROM 'string'
         OR jsonb_typeof(v_point -> 'libelle') IS DISTINCT FROM 'string'
         OR length(btrim(v_point ->> 'libelle')) NOT BETWEEN 1 AND 300
         OR NOT dd_categorie_valide(v_analyse, v_point ->> 'categorie') THEN
        RAISE EXCEPTION 'Point à examiner invalide : catégorie inconnue de l''analyse ou libellé hors limites.'
          USING ERRCODE = 'MQD11';
      END IF;
    END LOOP;
    RETURN NEW;
  END $$;

CREATE TABLE dd_modele_secteur_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  numero bigint GENERATED ALWAYS AS IDENTITY,
  modele_id uuid NOT NULL,
  version int NOT NULL CHECK (version BETWEEN 1 AND 200),
  points jsonb NOT NULL CHECK (jsonb_typeof(points) = 'array'
    AND jsonb_array_length(points) BETWEEN 1 AND 50),
  actif boolean NOT NULL DEFAULT true,
  motif text CHECK (motif IS NULL OR length(motif) BETWEEN 1 AND 500),
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (modele_id, version),
  UNIQUE (cabinet_id, modele_id, version),
  CHECK ((version = 1) = (motif IS NULL)),
  CONSTRAINT dd_modele_versions_points_octets CHECK (length(points::text) <= 40000),
  FOREIGN KEY (cabinet_id, modele_id) REFERENCES dd_modeles_secteur (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX dd_modele_secteur_versions_courante_idx
  ON dd_modele_secteur_versions (cabinet_id, modele_id, version DESC);
ALTER TABLE dd_modele_secteur_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON dd_modele_secteur_versions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON dd_modele_secteur_versions AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON dd_modele_secteur_versions FROM missionpilot_app;
CREATE TRIGGER dd_modele_secteur_versions_ajout_seul BEFORE UPDATE OR DELETE
  ON dd_modele_secteur_versions
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_dd();
CREATE TRIGGER dd_modele_secteur_versions_numerotation BEFORE INSERT ON dd_modele_secteur_versions
  FOR EACH ROW EXECUTE FUNCTION dd_numeroter_version('modele_id');
CREATE TRIGGER dd_modele_secteur_versions_points BEFORE INSERT ON dd_modele_secteur_versions
  FOR EACH ROW EXECUTE FUNCTION controler_dd_modele_points();
CREATE TRIGGER dd_modele_secteur_versions_auteur_sans_portail BEFORE INSERT
  ON dd_modele_secteur_versions
  FOR EACH ROW EXECUTE FUNCTION refuser_utilisateur_portail('cree_par');
