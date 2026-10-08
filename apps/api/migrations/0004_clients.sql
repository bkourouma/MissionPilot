-- Fiches clients et contacts (SOC-03).
CREATE TABLE clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  raison_sociale text NOT NULL CHECK (length(raison_sociale) BETWEEN 1 AND 200),
  forme_juridique text,
  rccm text,
  compte_contribuable text,
  secteur text,
  pays char(2) NOT NULL DEFAULT 'CI',
  taille text CHECK (taille IN ('tpe', 'pme', 'eti', 'grande_entreprise')),
  adresse text,
  actif boolean NOT NULL DEFAULT true,
  cree_le timestamptz NOT NULL DEFAULT now(),
  modifie_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id)
);
-- Identité légale unique par cabinet quand elle est renseignée.
CREATE UNIQUE INDEX clients_rccm_uniq ON clients (cabinet_id, upper(rccm)) WHERE rccm IS NOT NULL;
CREATE UNIQUE INDEX clients_compte_contribuable_uniq ON clients (cabinet_id, upper(compte_contribuable))
  WHERE compte_contribuable IS NOT NULL;
CREATE INDEX clients_tri_idx ON clients (cabinet_id, lower(raison_sociale), id);
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON clients
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
-- Un client est archivé (actif = false), jamais supprimé : les missions et
-- factures à venir le référencent.
REVOKE DELETE ON clients FROM missionpilot_app;

CREATE TABLE contacts_client (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  nom text NOT NULL CHECK (length(nom) BETWEEN 1 AND 160),
  fonction text,
  email text,
  telephone text,
  principal boolean NOT NULL DEFAULT false,
  cree_le timestamptz NOT NULL DEFAULT now(),
  modifie_le timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (cabinet_id, client_id) REFERENCES clients (cabinet_id, id) ON DELETE CASCADE
);
CREATE INDEX contacts_client_client_idx ON contacts_client (client_id);
ALTER TABLE contacts_client ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON contacts_client
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
