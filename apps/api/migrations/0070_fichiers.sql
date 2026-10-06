-- Fichiers téléversés (SOC-05, FIN-05). Le binaire vit dans le stockage
-- (disque local, S3 plus tard) sous une clé GÉNÉRÉE PAR LE SERVEUR (128 bits
-- aléatoires en hexadécimal), jamais dérivée du nom ; l'arborescence est
-- rangée par cabinet. Cette table n'en garde que les métadonnées.
--
-- Ajout seul : le rôle applicatif ne modifie ni ne supprime une ligne. Une
-- suppression (purge des orphelins, retrait) est une ligne de
-- `fichiers_suppressions` ; l'objet du stockage est alors effacé.

CREATE TABLE fichiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  cle_stockage text NOT NULL UNIQUE CHECK (cle_stockage ~ '^[0-9a-f]{32}$'),
  -- Nom d'origine ASSAINI (sans chemin, contrôle ni caractère réservé).
  nom_origine text NOT NULL CHECK (length(nom_origine) BETWEEN 1 AND 200
    AND nom_origine !~ '[/\\[:cntrl:]]' AND nom_origine NOT IN ('.', '..')),
  -- Type détecté par signature (jamais l'en-tête ni l'extension seuls).
  type_mime text NOT NULL CHECK (type_mime IN (
    'application/pdf', 'image/png', 'image/jpeg', 'image/webp',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/csv', 'text/plain')),
  taille bigint NOT NULL CHECK (taille > 0 AND taille <= 104857600),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  envoye_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, envoye_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX fichiers_cabinet_idx ON fichiers (cabinet_id, cree_le);
CREATE INDEX fichiers_empreinte_idx ON fichiers (cabinet_id, sha256);
CREATE INDEX fichiers_envoye_par_idx ON fichiers (cabinet_id, envoye_par, cree_le);
ALTER TABLE fichiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON fichiers
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE UPDATE, DELETE ON fichiers FROM missionpilot_app;

-- Marquage de suppression (ajout seul) : un fichier marqué n'est plus servi,
-- ne compte plus dans le quota et son objet de stockage est effacé.
CREATE TABLE fichiers_suppressions (
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  fichier_id uuid NOT NULL,
  motif text NOT NULL CHECK (motif IN ('orphelin', 'retire')),
  supprime_par uuid,
  supprime_le timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (fichier_id),
  FOREIGN KEY (cabinet_id, fichier_id) REFERENCES fichiers (cabinet_id, id),
  FOREIGN KEY (cabinet_id, supprime_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX fichiers_suppressions_cabinet_idx ON fichiers_suppressions (cabinet_id);
ALTER TABLE fichiers_suppressions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON fichiers_suppressions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE UPDATE, DELETE ON fichiers_suppressions FROM missionpilot_app;
