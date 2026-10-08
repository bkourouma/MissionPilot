-- Documents de mission (SOC-05) : métadonnées seulement, sans fichier binaire
-- pour l'instant. Une nouvelle version d'un document est une nouvelle ligne
-- (version + 1) : l'historique ne se modifie pas.

CREATE TABLE mission_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  mission_id uuid NOT NULL,
  type text NOT NULL CHECK (type IN ('proposition', 'lettre_de_mission', 'livrable', 'autre')),
  nom text NOT NULL CHECK (length(nom) BETWEEN 1 AND 200),
  version int NOT NULL CHECK (version >= 1),
  auteur_id uuid,
  chemin_stockage text CHECK (chemin_stockage IS NULL OR length(chemin_stockage) <= 500),
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mission_id, type, nom, version),
  FOREIGN KEY (cabinet_id, mission_id) REFERENCES missions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, auteur_id) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX mission_documents_idx ON mission_documents (mission_id, type, nom, version DESC);
ALTER TABLE mission_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON mission_documents
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE UPDATE, DELETE ON mission_documents FROM missionpilot_app;
