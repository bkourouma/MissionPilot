-- Banque de références et d'attestations de bonne exécution (AO-05, lot AO-B).
--
-- - ao_references          : IDENTITÉ d'une référence, jamais modifiée.
-- - ao_reference_versions  : contenu daté en AJOUT SEUL (titre, client, pays, secteurs, bailleur,
--   montant du marché en unités mineures et sa devise, dates, rôle du cabinet) ; motif dès la
--   version 2. Le montant est celui du marché (public) : ce n'est ni un coût ni une marge (FIN-02).
--   Client et mission sont facultatifs ; donnés ensemble, la mission est celle du client (MPW03).
-- - ao_attestations        : pièces justificatives (fichiers du stockage existant). Seul le
--   RETRAIT motivé est possible, une fois (MPW01) ; un fichier retiré redevient orphelin et la
--   purge à 24 h l'efface (fichier_orphelin, 0384).

CREATE TABLE ao_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  numero bigint GENERATED ALWAYS AS IDENTITY,
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE ao_references ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON ao_references
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON ao_references AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON ao_references FROM missionpilot_app;
CREATE TRIGGER ao_references_ajout_seul BEFORE UPDATE OR DELETE ON ao_references
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_banque_ao();

CREATE TABLE ao_reference_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  reference_id uuid NOT NULL,
  version int NOT NULL CHECK (version BETWEEN 1 AND 10000),
  titre text NOT NULL CHECK (length(btrim(titre)) BETWEEN 1 AND 300),
  client_nom text NOT NULL CHECK (length(btrim(client_nom)) BETWEEN 1 AND 200),
  client_id uuid,
  mission_id uuid,
  pays text NOT NULL CHECK (pays ~ '^[A-Z]{2}$'),
  secteurs text[] NOT NULL DEFAULT '{}' CHECK (cardinality(secteurs) <= 10),
  bailleur text CHECK (bailleur IS NULL OR length(btrim(bailleur)) BETWEEN 1 AND 120),
  montant bigint NOT NULL CHECK (montant >= 0),
  devise text NOT NULL CHECK (devise IN ('XOF', 'XAF', 'EUR', 'USD')),
  date_debut date NOT NULL CHECK (date_debut BETWEEN '1950-01-01' AND '2100-12-31'),
  date_fin date CHECK (date_fin IS NULL OR date_fin BETWEEN '1950-01-01' AND '2100-12-31'),
  role_cabinet text NOT NULL
    CHECK (role_cabinet IN ('seul', 'chef_de_file', 'membre', 'sous_traitant')),
  description text CHECK (description IS NULL OR length(description) <= 4000),
  motif text CHECK (motif IS NULL OR length(btrim(motif)) BETWEEN 1 AND 500),
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (reference_id, version),
  CHECK ((version = 1) = (motif IS NULL)),
  CHECK (date_fin IS NULL OR date_fin >= date_debut),
  FOREIGN KEY (cabinet_id, reference_id) REFERENCES ao_references (cabinet_id, id),
  FOREIGN KEY (cabinet_id, client_id) REFERENCES clients (cabinet_id, id),
  FOREIGN KEY (cabinet_id, mission_id) REFERENCES missions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX ao_reference_versions_courante_idx
  ON ao_reference_versions (cabinet_id, reference_id, version DESC);
ALTER TABLE ao_reference_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON ao_reference_versions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON ao_reference_versions AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON ao_reference_versions FROM missionpilot_app;
CREATE TRIGGER ao_reference_versions_ajout_seul BEFORE UPDATE OR DELETE ON ao_reference_versions
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_banque_ao();
CREATE TRIGGER ao_reference_versions_consecutives BEFORE INSERT ON ao_reference_versions
  FOR EACH ROW EXECUTE FUNCTION controler_version_banque_ao('reference_id');

-- Mission et client donnés ensemble : la mission est celle du client (MPW03).
CREATE FUNCTION controler_reference_ao() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NEW.mission_id IS NOT NULL AND NEW.client_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM missions m WHERE m.id = NEW.mission_id AND m.client_id = NEW.client_id) THEN
      RAISE EXCEPTION 'La mission citée n''est pas celle du client de la référence.'
        USING ERRCODE = 'MPW03';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER ao_reference_versions_controle BEFORE INSERT ON ao_reference_versions
  FOR EACH ROW EXECUTE FUNCTION controler_reference_ao();

CREATE TABLE ao_attestations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  reference_id uuid NOT NULL,
  fichier_id uuid NOT NULL,
  type text NOT NULL CHECK (type IN ('attestation_bonne_execution', 'proces_verbal_reception',
    'contrat', 'autre')),
  date_attestation date NOT NULL
    CHECK (date_attestation BETWEEN '1950-01-01' AND '2100-12-31'),
  emetteur text NOT NULL CHECK (length(btrim(emetteur)) BETWEEN 1 AND 200),
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  retiree_le timestamptz,
  retiree_par uuid,
  motif_retrait text CHECK (motif_retrait IS NULL OR length(btrim(motif_retrait)) BETWEEN 1 AND 500),
  UNIQUE (cabinet_id, id),
  -- Un fichier ne justifie qu'une pièce.
  UNIQUE (fichier_id),
  CHECK ((retiree_le IS NULL) = (retiree_par IS NULL)),
  CHECK ((retiree_le IS NULL) = (motif_retrait IS NULL)),
  FOREIGN KEY (cabinet_id, reference_id) REFERENCES ao_references (cabinet_id, id),
  FOREIGN KEY (cabinet_id, fichier_id) REFERENCES fichiers (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, retiree_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX ao_attestations_reference_idx ON ao_attestations (cabinet_id, reference_id, cree_le);
ALTER TABLE ao_attestations ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON ao_attestations
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON ao_attestations AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON ao_attestations FROM missionpilot_app;
GRANT UPDATE (retiree_le, retiree_par, motif_retrait) ON ao_attestations TO missionpilot_app;

-- Seul changement admis : le retrait motivé, une fois ; rien d'autre ne bouge (MPW01).
CREATE FUNCTION controler_attestation_ao() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'DELETE' OR OLD.retiree_le IS NOT NULL OR NEW.retiree_le IS NULL
       OR (NEW.cabinet_id, NEW.reference_id, NEW.fichier_id, NEW.type, NEW.date_attestation,
           NEW.emetteur, NEW.cree_par, NEW.cree_le)
          IS DISTINCT FROM (OLD.cabinet_id, OLD.reference_id, OLD.fichier_id, OLD.type,
           OLD.date_attestation, OLD.emetteur, OLD.cree_par, OLD.cree_le) THEN
      RAISE EXCEPTION 'Une pièce ne se modifie pas : seul son retrait motivé, une fois.'
        USING ERRCODE = 'MPW01';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER ao_attestations_controle BEFORE UPDATE OR DELETE ON ao_attestations
  FOR EACH ROW EXECUTE FUNCTION controler_attestation_ao();
