-- Grilles de notation du cabinet (service 1, NOT-01), versionnées.
--
-- La grille générique de MissionPilot (packages/shared/src/grilles) sert par
-- défaut ; le cabinet la COPIE pour l'affiner (dimensions, indicateurs,
-- pondérations par secteur). Une version se rédige en brouillon, puis est
-- validée par un utilisateur au rôle `expert_metier` qui n'en est ni
-- l'auteur ni le dernier modificateur (séparation des tâches, MPN04) : elle
-- devient immuable (MPN05). Toute correction passe par une nouvelle version.

CREATE TABLE notation_grilles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  code text NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9_.-]{0,79}$'),
  titre text NOT NULL CHECK (length(titre) BETWEEN 1 AND 200),
  origine text NOT NULL CHECK (origine IN ('cabinet', 'generique', 'copie')),
  copie_de uuid,
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  modifie_le timestamptz NOT NULL DEFAULT now(),
  CHECK ((origine = 'copie') = (copie_de IS NOT NULL)),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, code),
  FOREIGN KEY (cabinet_id, copie_de) REFERENCES notation_grilles (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX notation_grilles_tri_idx ON notation_grilles (cabinet_id, lower(titre), id);
ALTER TABLE notation_grilles ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON notation_grilles
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE DELETE ON notation_grilles FROM missionpilot_app;

-- Grille : seuls le titre (repris de la dernière version) et la date de
-- modification changent ; code, origine, copie et auteur sont figés.
CREATE FUNCTION controler_notation_grille() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF (NEW.id, NEW.cabinet_id, NEW.code, NEW.origine, NEW.copie_de, NEW.cree_par, NEW.cree_le)
       IS DISTINCT FROM (OLD.id, OLD.cabinet_id, OLD.code, OLD.origine, OLD.copie_de, OLD.cree_par,
        OLD.cree_le) THEN
      RAISE EXCEPTION 'L''identité d''une grille de notation est figée (seul le titre change).'
        USING ERRCODE = 'MPN05';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER notation_grilles_controle BEFORE UPDATE ON notation_grilles
  FOR EACH ROW EXECUTE FUNCTION controler_notation_grille();

CREATE TABLE notation_grille_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  grille_id uuid NOT NULL,
  version int NOT NULL CHECK (version BETWEEN 1 AND 100000),
  contenu jsonb NOT NULL CHECK (jsonb_typeof(contenu) = 'object'),
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
  UNIQUE (cabinet_id, grille_id, version),
  FOREIGN KEY (cabinet_id, grille_id) REFERENCES notation_grilles (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, modifie_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, valide_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE UNIQUE INDEX notation_grille_versions_brouillon_uniq ON notation_grille_versions (cabinet_id, grille_id)
  WHERE statut = 'brouillon';
ALTER TABLE notation_grille_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON notation_grille_versions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE DELETE ON notation_grille_versions FROM missionpilot_app;

CREATE FUNCTION controler_notation_grille_version() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Une version de grille ne se supprime pas.' USING ERRCODE = 'MPN05';
    END IF;
    IF OLD.statut = 'valide' THEN
      RAISE EXCEPTION 'Une version de grille validée est figée : créer une nouvelle version.'
        USING ERRCODE = 'MPN05';
    END IF;
    IF (NEW.cabinet_id, NEW.grille_id, NEW.version, NEW.cree_par, NEW.cree_le)
       IS DISTINCT FROM (OLD.cabinet_id, OLD.grille_id, OLD.version, OLD.cree_par, OLD.cree_le) THEN
      RAISE EXCEPTION 'L''identité d''une version de grille est figée.' USING ERRCODE = 'MPN05';
    END IF;
    -- Validation : contenu inchangé, par un expert métier actif qui n'est ni
    -- l'auteur ni le dernier modificateur du brouillon (séparation des tâches).
    IF NEW.statut = 'valide' THEN
      IF NEW.contenu IS DISTINCT FROM OLD.contenu THEN
        RAISE EXCEPTION 'Le contenu d''une version de grille ne change pas à sa validation.'
          USING ERRCODE = 'MPN05';
      END IF;
      IF NEW.valide_par IN (OLD.cree_par, OLD.modifie_par) THEN
        RAISE EXCEPTION 'L''auteur ou le dernier modificateur d''une version de grille ne la valide pas.'
          USING ERRCODE = 'MPN04';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM utilisateurs u WHERE u.id = NEW.valide_par AND u.actif
                     AND 'expert_metier' = ANY (u.roles)) THEN
        RAISE EXCEPTION 'Seul un expert métier valide une version de grille.' USING ERRCODE = 'MPN04';
      END IF;
    END IF;
    NEW.modifie_le := now();
    RETURN NEW;
  END $$;
CREATE TRIGGER notation_grille_versions_controle BEFORE UPDATE OR DELETE ON notation_grille_versions
  FOR EACH ROW EXECUTE FUNCTION controler_notation_grille_version();
