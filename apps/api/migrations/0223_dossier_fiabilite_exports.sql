-- Indice de fiabilité des données du client (DOS-04) et exports du dossier (DOS-07).
--
-- `dossier_indices_fiabilite` : instantanés de l'indice calculé par le moteur
-- `indiceFiabiliteDossier` (packages/engines/src/dossier), inscrits à chaque écriture qui
-- en change une entrée (facteur, état financier, décision) quand le résultat diffère du
-- précédent : l'historique montre quand la confiance a changé. Ajout seul (MPO01).
--
-- `dossier_exports` : trace de chaque export du dossier à la demande du client
-- (portabilité, loi n° 2013-450 et RGPD) : demandeur, format, empreinte et taille du
-- contenu remis, volumes. Le contenu n'est pas conservé. Ajout seul (MPO01) ; l'action est
-- aussi au journal d'audit (`dossier.exporter`).

CREATE TABLE dossier_indices_fiabilite (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  points integer NOT NULL CHECK (points BETWEEN 0 AND 1000),
  classe text NOT NULL CHECK (classe IN ('A', 'B', 'C', 'D')),
  analyses_indicatives boolean NOT NULL,
  detail jsonb NOT NULL CHECK (jsonb_typeof(detail) = 'object' AND octet_length(detail::text) <= 8000),
  calcule_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, client_id) REFERENCES clients (cabinet_id, id),
  FOREIGN KEY (cabinet_id, calcule_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX dossier_indices_fiabilite_client_idx
  ON dossier_indices_fiabilite (cabinet_id, client_id, cree_le);
ALTER TABLE dossier_indices_fiabilite ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON dossier_indices_fiabilite
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON dossier_indices_fiabilite AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON dossier_indices_fiabilite FROM missionpilot_app;
CREATE TRIGGER dossier_indices_fiabilite_ajout_seul BEFORE UPDATE OR DELETE ON dossier_indices_fiabilite
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_dossier();

CREATE TABLE dossier_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  format text NOT NULL CHECK (format IN ('json', 'zip')),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  taille integer NOT NULL CHECK (taille BETWEEN 1 AND 104857600),
  volumes jsonb NOT NULL CHECK (jsonb_typeof(volumes) = 'object' AND octet_length(volumes::text) <= 2000),
  demandeur_id uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, client_id) REFERENCES clients (cabinet_id, id),
  FOREIGN KEY (cabinet_id, demandeur_id) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX dossier_exports_client_idx ON dossier_exports (cabinet_id, client_id, cree_le);
ALTER TABLE dossier_exports ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON dossier_exports
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON dossier_exports AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON dossier_exports FROM missionpilot_app;
CREATE TRIGGER dossier_exports_ajout_seul BEFORE UPDATE OR DELETE ON dossier_exports
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_dossier();
