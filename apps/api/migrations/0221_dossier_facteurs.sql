-- Facteurs de contexte du client (STD-04, PRD complémentaire §4.3), portés par le dossier.
--
-- Une valeur typée (booléen, nombre, code d'énumération, liste de codes : forme de
-- `valeurFacteurContexteSchema`, packages/shared/src/schemas/fondations.ts) datée et
-- sourcée. La définition des facteurs (libellés, valeurs permises) appartient au
-- référentiel de méthodes (lot STD) ; ici, seuls le code et le type sont contrôlés. Deux
-- codes sont de convention (DOS-04) : `fiabilite_comptes` et `part_informel`.
--
-- Ajout seul (MPO01) : une nouvelle valeur (même code) prend effet à sa date ; à date
-- d'effet égale, la plus récente l'emporte (moteur `valeursCourantesDatees`).

CREATE TABLE dossier_facteurs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  code text NOT NULL CHECK (code ~ '^[a-z0-9_.-]{1,120}$'),
  type text NOT NULL CHECK (type IN ('booleen', 'nombre', 'enumeration', 'liste')),
  valeur jsonb NOT NULL CHECK (octet_length(valeur::text) <= 8000),
  date_effet date NOT NULL CHECK (date_effet BETWEEN '1900-01-01' AND '2100-12-31'),
  source_type text NOT NULL CHECK (source_type IN ('questionnaire', 'entretien', 'observation',
    'document', 'donnee_externe')),
  source_libelle text NOT NULL CHECK (length(btrim(source_libelle)) BETWEEN 1 AND 300),
  source_document_id uuid,
  source_page integer CHECK (source_page BETWEEN 1 AND 100000),
  source_reference text CHECK (source_reference IS NULL OR length(source_reference) BETWEEN 1 AND 120),
  fiabilite text NOT NULL CHECK (fiabilite IN ('A', 'B', 'C', 'D')),
  auteur_id uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  CHECK (source_type = 'document' OR (source_document_id IS NULL AND source_page IS NULL)),
  CHECK (CASE type
    WHEN 'booleen' THEN jsonb_typeof(valeur) = 'boolean'
    WHEN 'nombre' THEN jsonb_typeof(valeur) = 'number'
    WHEN 'enumeration' THEN jsonb_typeof(valeur) = 'string'
    ELSE jsonb_typeof(valeur) = 'array' END),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, client_id) REFERENCES clients (cabinet_id, id),
  FOREIGN KEY (cabinet_id, source_document_id) REFERENCES fichiers (cabinet_id, id),
  FOREIGN KEY (cabinet_id, auteur_id) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX dossier_facteurs_client_idx
  ON dossier_facteurs (cabinet_id, client_id, code, date_effet, cree_le);
ALTER TABLE dossier_facteurs ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON dossier_facteurs
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON dossier_facteurs AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON dossier_facteurs FROM missionpilot_app;
CREATE TRIGGER dossier_facteurs_ajout_seul BEFORE UPDATE OR DELETE ON dossier_facteurs
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_dossier();
