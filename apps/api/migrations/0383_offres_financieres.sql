-- Offre financière d'un appel d'offres (AO-07, lot AO-B) : jours par expert, taux journaliers,
-- per diem, débours, taxes, devise, totaux.
--
-- Données FIN-02 (taux journaliers) : lues et écrites par l'API sous `finance.lire` seulement.
-- Les montants sont CALCULÉS par le moteur pur packages/engines/src/offre-financiere au moment
-- de l'enregistrement : `entree` garde la saisie, `resultat` le calcul figé (lignes, sous-totaux,
-- taxes, totaux), `total_ht` et `total_ttc` en sont recopiés pour les listes. Aucune somme SQL.
--
-- - ao_offres_financieres         : identité ; appel d'offres facultatif SANS clé étrangère.
-- - ao_offre_financiere_versions  : versions en ajout seul (MPW01), consécutives (MPW02), motif
--   dès la version 2.

CREATE TABLE ao_offres_financieres (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  numero bigint GENERATED ALWAYS AS IDENTITY,
  appel_offres_id uuid,
  titre text NOT NULL CHECK (length(btrim(titre)) BETWEEN 1 AND 300),
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX ao_offres_financieres_tri_idx ON ao_offres_financieres (cabinet_id, numero DESC);
ALTER TABLE ao_offres_financieres ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON ao_offres_financieres
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON ao_offres_financieres AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON ao_offres_financieres FROM missionpilot_app;
CREATE TRIGGER ao_offres_financieres_ajout_seul BEFORE UPDATE OR DELETE ON ao_offres_financieres
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_banque_ao();

CREATE TABLE ao_offre_financiere_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  offre_id uuid NOT NULL,
  version int NOT NULL CHECK (version BETWEEN 1 AND 10000),
  devise text NOT NULL CHECK (devise IN ('XOF', 'XAF', 'EUR', 'USD')),
  entree jsonb NOT NULL
    CHECK (jsonb_typeof(entree) = 'object' AND octet_length(entree::text) <= 300000),
  resultat jsonb NOT NULL
    CHECK (jsonb_typeof(resultat) = 'object' AND octet_length(resultat::text) <= 600000),
  total_ht bigint NOT NULL CHECK (total_ht >= 0),
  total_ttc bigint NOT NULL CHECK (total_ttc >= total_ht),
  motif text CHECK (motif IS NULL OR length(btrim(motif)) BETWEEN 1 AND 500),
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (offre_id, version),
  CHECK ((version = 1) = (motif IS NULL)),
  FOREIGN KEY (cabinet_id, offre_id) REFERENCES ao_offres_financieres (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX ao_offre_financiere_versions_courante_idx
  ON ao_offre_financiere_versions (cabinet_id, offre_id, version DESC);
ALTER TABLE ao_offre_financiere_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON ao_offre_financiere_versions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON ao_offre_financiere_versions AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON ao_offre_financiere_versions FROM missionpilot_app;
CREATE TRIGGER ao_offre_financiere_versions_ajout_seul
  BEFORE UPDATE OR DELETE ON ao_offre_financiere_versions
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_banque_ao();
CREATE TRIGGER ao_offre_financiere_versions_consecutives
  BEFORE INSERT ON ao_offre_financiere_versions
  FOR EACH ROW EXECUTE FUNCTION controler_version_banque_ao('offre_id');
