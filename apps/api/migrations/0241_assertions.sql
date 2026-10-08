-- Assertions du registre des preuves (PRV-02, PRV-03) : une conclusion qu'on veut écrire dans un
-- livrable, rattachée à une dimension, une hypothèse ou un risque, et à la classe de risque du
-- livrable cible (R0 à R3, QUA-01).
--
-- - assertions         : IDENTITÉ (mission, créateur), jamais modifiée.
-- - assertion_versions : contenu, en AJOUT SEUL ; une correction est une nouvelle version (motif
--   obligatoire dès la version 2). Les liens aux preuves (0242) visent l'identité.
--
-- « Avis d'expert » (PRV-03) : une assertion sans preuve peut être assumée comme avis d'expert,
-- avec un motif, puis SIGNÉE. La signature est celle de l'auteur de la version
-- (`signe_par = cree_par`, MPV04) : elle ne se délègue pas et ne se reporte pas sur la version
-- suivante, qu'il faut signer à nouveau.
-- Aucun indice ici : l'indice de solidité sort de packages/engines/src/preuves.
-- Portail client : jamais (politique restrictive `portail_interdit`).

CREATE TABLE assertions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  numero bigint GENERATED ALWAYS AS IDENTITY,
  mission_id uuid NOT NULL,
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, mission_id) REFERENCES missions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX assertions_mission_idx ON assertions (cabinet_id, mission_id, numero DESC);
ALTER TABLE assertions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON assertions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON assertions AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON assertions FROM missionpilot_app;
CREATE TRIGGER assertions_ajout_seul BEFORE UPDATE OR DELETE ON assertions
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_preuves();

CREATE TABLE assertion_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  assertion_id uuid NOT NULL,
  version int NOT NULL CHECK (version >= 1),
  enonce text NOT NULL CHECK (length(enonce) BETWEEN 1 AND 2000),
  rattachement_type text CHECK (rattachement_type IN ('dimension', 'hypothese', 'risque')),
  rattachement_code text CHECK (rattachement_code IS NULL OR length(rattachement_code) BETWEEN 1 AND 120),
  -- Livrable cible (nom libre) et sa classe de risque.
  livrable text CHECK (livrable IS NULL OR length(livrable) BETWEEN 1 AND 200),
  classe_risque text NOT NULL CHECK (classe_risque IN ('R0', 'R1', 'R2', 'R3')),
  statut text NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon', 'retenue', 'abandonnee')),
  avis_expert boolean NOT NULL DEFAULT false,
  avis_expert_motif text CHECK (avis_expert_motif IS NULL OR length(avis_expert_motif) BETWEEN 1 AND 1000),
  signe_par uuid,
  signe_le timestamptz,
  motif text CHECK (motif IS NULL OR length(motif) BETWEEN 1 AND 500),
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (assertion_id, version),
  CHECK ((version = 1) = (motif IS NULL)),
  CHECK ((rattachement_type IS NULL) = (rattachement_code IS NULL)),
  CHECK (NOT avis_expert OR avis_expert_motif IS NOT NULL),
  CHECK (avis_expert OR (avis_expert_motif IS NULL AND signe_par IS NULL)),
  CHECK ((signe_par IS NULL) = (signe_le IS NULL)),
  FOREIGN KEY (cabinet_id, assertion_id) REFERENCES assertions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, signe_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX assertion_versions_courante_idx
  ON assertion_versions (cabinet_id, assertion_id, version DESC);
ALTER TABLE assertion_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON assertion_versions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON assertion_versions AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON assertion_versions FROM missionpilot_app;
CREATE TRIGGER assertion_versions_ajout_seul BEFORE UPDATE OR DELETE ON assertion_versions
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_preuves();

CREATE FUNCTION controler_assertion_version() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NEW.version <> (SELECT coalesce(max(v.version), 0) + 1 FROM assertion_versions v
                       WHERE v.assertion_id = NEW.assertion_id) THEN
      RAISE EXCEPTION 'Les versions d''une assertion se suivent sans trou.' USING ERRCODE = 'MPV03';
    END IF;
    IF NEW.signe_par IS NOT NULL AND NEW.signe_par <> NEW.cree_par THEN
      RAISE EXCEPTION 'Un avis d''expert est signé par l''auteur de la version.'
        USING ERRCODE = 'MPV04';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER assertion_versions_controle BEFORE INSERT ON assertion_versions
  FOR EACH ROW EXECUTE FUNCTION controler_assertion_version();
