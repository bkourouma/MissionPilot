-- Indice de confiance d'une note (NOT-11, PRD complémentaire §11.1) : affiché avec la note,
-- publication impossible sous un seuil paramétrable par le cabinet.
--
-- - `notation_parametres` : seuil de confiance (0,5 par défaut, à calibrer au pilote) et cible
--   de répondants (3 par défaut) du cabinet ; une ligne par cabinet, modifiée par un associé
--   (`cabinet.gerer`, contrôle de l'API) et journalisée. Sans ligne : valeurs par défaut.
-- - `notation_confiances` : indice CALCULÉ PAR LE MOTEUR (`indiceConfiance`) pour une version,
--   enregistré en ajout seul (MPN10) avec le seuil courant du cabinet (un seuil plus bas que le
--   seuil courant est refusé).
-- - Garde de publication doublée en base : l'événement « publication » d'une version exige un
--   indice enregistré DANS LA MÊME TRANSACTION (cree_le = now()), déclaré publiable, au moins
--   égal au seuil courant du cabinet (MPN10). Le déclencheur s'exécute après
--   `notation_evenements_controle` (ordre des noms) : la séparation des tâches (MPN04) reste
--   contrôlée en premier.

CREATE TABLE notation_parametres (
  cabinet_id uuid PRIMARY KEY REFERENCES cabinets (id) ON DELETE CASCADE,
  seuil_confiance numeric(5, 4) NOT NULL DEFAULT 0.5 CHECK (seuil_confiance BETWEEN 0 AND 1),
  repondants_cible int NOT NULL DEFAULT 3 CHECK (repondants_cible BETWEEN 1 AND 1000),
  modifie_par uuid NOT NULL,
  modifie_le timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (cabinet_id, modifie_par) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE notation_parametres ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON notation_parametres
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON notation_parametres AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE DELETE ON notation_parametres FROM missionpilot_app;

/** Seuil de confiance courant d'un cabinet (0,5 sans paramètre). */
CREATE FUNCTION notation_seuil_confiance(p_cabinet uuid) RETURNS numeric
  LANGUAGE sql STABLE
  AS $$
  SELECT coalesce((SELECT p.seuil_confiance FROM notation_parametres p WHERE p.cabinet_id = p_cabinet),
                  0.5)
  $$;

CREATE TABLE notation_confiances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  version_id uuid NOT NULL,
  rang int NOT NULL CHECK (rang BETWEEN 1 AND 100000),
  indice numeric(5, 4) NOT NULL CHECK (indice BETWEEN 0 AND 1),
  seuil numeric(5, 4) NOT NULL CHECK (seuil BETWEEN 0 AND 1),
  publiable boolean NOT NULL,
  composantes jsonb NOT NULL
    CHECK (jsonb_typeof(composantes) = 'object' AND octet_length(composantes::text) <= 20000),
  calcule_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT publiable OR indice >= seuil),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, version_id, rang),
  FOREIGN KEY (cabinet_id, version_id) REFERENCES notation_versions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, calcule_par) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE notation_confiances ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON notation_confiances
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON notation_confiances AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON notation_confiances FROM missionpilot_app;

CREATE FUNCTION controler_notation_confiance() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP <> 'INSERT' THEN
      RAISE EXCEPTION 'L''historique des indices de confiance est en ajout seul.' USING ERRCODE = 'MPN10';
    END IF;
    IF NEW.rang <> coalesce((SELECT max(c.rang) FROM notation_confiances c
                             WHERE c.version_id = NEW.version_id), 0) + 1 THEN
      RAISE EXCEPTION 'Rang d''indice de confiance inattendu.' USING ERRCODE = 'MPN10';
    END IF;
    IF NEW.seuil < notation_seuil_confiance(NEW.cabinet_id) THEN
      RAISE EXCEPTION 'Le seuil enregistré est inférieur au seuil de confiance du cabinet.'
        USING ERRCODE = 'MPN10';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER notation_confiances_controle BEFORE INSERT OR UPDATE OR DELETE ON notation_confiances
  FOR EACH ROW EXECUTE FUNCTION controler_notation_confiance();

-- Publication : indice de la même transaction, publiable, au moins égal au seuil courant.
CREATE FUNCTION controler_publication_confiance() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_conf notation_confiances%ROWTYPE;
  BEGIN
    SELECT * INTO v_conf FROM notation_confiances c WHERE c.version_id = NEW.version_id
      ORDER BY c.rang DESC LIMIT 1;
    IF NOT FOUND OR v_conf.cree_le <> now() OR NOT v_conf.publiable
       OR v_conf.indice < notation_seuil_confiance(NEW.cabinet_id) THEN
      RAISE EXCEPTION 'Indice de confiance absent ou sous le seuil du cabinet : publication refusée.'
        USING ERRCODE = 'MPN10';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER notation_evenements_publication_confiance BEFORE INSERT ON notation_evenements
  FOR EACH ROW WHEN (NEW.action = 'publication')
  EXECUTE FUNCTION controler_publication_confiance();
