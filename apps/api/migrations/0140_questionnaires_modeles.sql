-- Modèles de questionnaires du cabinet (SOC-10), versionnés.
--
-- Un modèle porte un code stable ; ses versions portent la définition JSON
-- (forme contrôlée par le schéma partagé, cohérence par le moteur
-- `validerDefinition`). Une version est rédigée en BROUILLON (un seul par
-- modèle), puis VALIDÉE : elle devient immuable (MPQ01) et seule une version
-- validée s'envoie. Toute correction passe par une nouvelle version. Un
-- modèle peut être la copie d'un gabarit générique de MissionPilot ou d'un
-- autre modèle du cabinet. Aucune suppression (historique des envois).

CREATE TABLE questionnaire_modeles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  code text NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9_.-]{0,79}$'),
  titre text NOT NULL CHECK (length(titre) BETWEEN 1 AND 200),
  origine text NOT NULL CHECK (origine IN ('cabinet', 'gabarit', 'copie')),
  gabarit text CHECK (gabarit IS NULL OR gabarit ~ '^[a-z0-9][a-z0-9_.-]{0,79}$'),
  copie_de uuid,
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  modifie_le timestamptz NOT NULL DEFAULT now(),
  CHECK ((origine = 'gabarit') = (gabarit IS NOT NULL)),
  CHECK ((origine = 'copie') = (copie_de IS NOT NULL)),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, code),
  FOREIGN KEY (cabinet_id, copie_de) REFERENCES questionnaire_modeles (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX questionnaire_modeles_tri_idx ON questionnaire_modeles (cabinet_id, lower(titre), id);
ALTER TABLE questionnaire_modeles ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON questionnaire_modeles
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE DELETE ON questionnaire_modeles FROM missionpilot_app;

-- Modèle : seuls le titre (repris de la dernière version) et la date de
-- modification changent ; code, origine, gabarit, copie et auteur sont figés.
CREATE FUNCTION controler_questionnaire_modele() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF (NEW.id, NEW.cabinet_id, NEW.code, NEW.origine, NEW.gabarit, NEW.copie_de, NEW.cree_par,
        NEW.cree_le)
       IS DISTINCT FROM (OLD.id, OLD.cabinet_id, OLD.code, OLD.origine, OLD.gabarit, OLD.copie_de,
        OLD.cree_par, OLD.cree_le) THEN
      RAISE EXCEPTION 'L''identité d''un modèle de questionnaire est figée (seul le titre change).'
        USING ERRCODE = 'MPQ01';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER questionnaire_modeles_controle BEFORE UPDATE ON questionnaire_modeles
  FOR EACH ROW EXECUTE FUNCTION controler_questionnaire_modele();

CREATE TABLE questionnaire_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  modele_id uuid NOT NULL,
  version int NOT NULL CHECK (version BETWEEN 1 AND 100000),
  definition jsonb NOT NULL CHECK (jsonb_typeof(definition) = 'object'),
  statut text NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon', 'valide')),
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  modifie_par uuid NOT NULL,
  modifie_le timestamptz NOT NULL DEFAULT now(),
  valide_par uuid,
  valide_le timestamptz,
  CHECK ((statut = 'valide') = (valide_par IS NOT NULL)),
  CHECK ((valide_par IS NULL) = (valide_le IS NULL)),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, modele_id, version),
  FOREIGN KEY (cabinet_id, modele_id) REFERENCES questionnaire_modeles (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, modifie_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, valide_par) REFERENCES utilisateurs (cabinet_id, id)
);
-- Un seul brouillon à la fois par modèle.
CREATE UNIQUE INDEX questionnaire_versions_brouillon_uniq ON questionnaire_versions (cabinet_id, modele_id)
  WHERE statut = 'brouillon';
ALTER TABLE questionnaire_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON questionnaire_versions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE DELETE ON questionnaire_versions FROM missionpilot_app;

-- Version validée : figée. Brouillon : seuls la définition et le passage à
-- « valide » changent ; l'identité de la version ne change jamais.
CREATE FUNCTION controler_questionnaire_version() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Une version de questionnaire ne se supprime pas.' USING ERRCODE = 'MPQ01';
    END IF;
    IF OLD.statut = 'valide' THEN
      RAISE EXCEPTION 'Une version validée est figée : créer une nouvelle version.' USING ERRCODE = 'MPQ01';
    END IF;
    IF (NEW.cabinet_id, NEW.modele_id, NEW.version, NEW.cree_par, NEW.cree_le)
       IS DISTINCT FROM (OLD.cabinet_id, OLD.modele_id, OLD.version, OLD.cree_par, OLD.cree_le) THEN
      RAISE EXCEPTION 'L''identité d''une version de questionnaire est figée.' USING ERRCODE = 'MPQ01';
    END IF;
    NEW.modifie_le := now();
    RETURN NEW;
  END $$;
CREATE TRIGGER questionnaire_versions_controle BEFORE UPDATE OR DELETE ON questionnaire_versions
  FOR EACH ROW EXECUTE FUNCTION controler_questionnaire_version();
