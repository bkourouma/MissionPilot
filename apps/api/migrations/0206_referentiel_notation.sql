-- Notation calculée DEPUIS le référentiel de méthodes (vague 1, condition de
-- passage : « la notation tourne sur le référentiel avec des résultats
-- identiques à la V2 » ; PRD complémentaire §18, ADR-004).
--
-- Quand la mission d'une notation est liée à une version de méthode
-- (`mission_methodes`, 0202), chaque calcul est exécuté par
-- `apps/api/src/notation/via-methode.ts` depuis la méthode EFFECTIVE (version
-- figée → règles de modulation → dérogations approuvées) et enregistre, à côté
-- de la version de notation (0146) :
-- - la version de méthode utilisée et la ligne de liaison courante de la
--   mission (événement liaison, contexte ou migration) ;
-- - le journal de modulation tel que la mission le porte (`modulation`,
--   résultat complet du moteur pur : règles, effets, conflits, journal) ;
-- - le journal d'exécution (`execution` : briques exécutées et leur moteur,
--   pondérations appliquées à la grille, ajustements sans effet sur le calcul).
-- Ajout seul (MPN06), cohérence avec la liaison COURANTE de la mission de la
-- notation (MPN07). Une notation d'une mission sans méthode n'a pas de ligne
-- ici : son calcul reste celui de la V2, inchangé.

CREATE TABLE notation_versions_methode (
  version_id uuid PRIMARY KEY,
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  mission_methode_id uuid NOT NULL,
  methode_version_id uuid NOT NULL REFERENCES methode_versions (id),
  modulation jsonb NOT NULL
    CHECK (jsonb_typeof(modulation) = 'object' AND octet_length(modulation::text) <= 2000000),
  execution jsonb NOT NULL
    CHECK (jsonb_typeof(execution) = 'object' AND octet_length(execution::text) <= 200000),
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, version_id),
  FOREIGN KEY (cabinet_id, version_id) REFERENCES notation_versions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, mission_methode_id) REFERENCES mission_methodes (cabinet_id, id)
);
CREATE INDEX notation_versions_methode_version_idx
  ON notation_versions_methode (cabinet_id, methode_version_id);
ALTER TABLE notation_versions_methode ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON notation_versions_methode
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON notation_versions_methode AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON notation_versions_methode FROM missionpilot_app;

-- Ajout seul (même pour le propriétaire) et cohérence de la liaison : la ligne de
-- liaison est celle, COURANTE (dernier rang), de la mission de la notation, et
-- porte la version de méthode déclarée.
CREATE FUNCTION controler_notation_version_methode() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP <> 'INSERT' THEN
      RAISE EXCEPTION 'Le calcul d''une notation par la méthode est en ajout seul.'
        USING ERRCODE = 'MPN06';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM notation_versions v
      JOIN notations n ON n.id = v.notation_id
      JOIN mission_methodes mm ON mm.mission_id = n.mission_id
      WHERE v.id = NEW.version_id
        AND mm.id = NEW.mission_methode_id
        AND mm.methode_version_id = NEW.methode_version_id
        AND mm.rang = (SELECT max(m2.rang) FROM mission_methodes m2 WHERE m2.mission_id = n.mission_id)
    ) THEN
      RAISE EXCEPTION 'Méthode de la notation incohérente avec la liaison courante de sa mission.'
        USING ERRCODE = 'MPN07';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER notation_versions_methode_controle
  BEFORE INSERT OR UPDATE OR DELETE ON notation_versions_methode
  FOR EACH ROW EXECUTE FUNCTION controler_notation_version_methode();
