-- Guichets de financement du cabinet (services candidats, business plan bancable) : banques,
-- bailleurs, fonds d'investissement et programmes publics que le cabinet SUIT. Le rapprochement
-- d'un client avec ces guichets est un calcul indicatif (`packages/engines`, `rapprocherGuichets`).
--
-- LISTE VIDE PAR DÉFAUT : aucun guichet n'est inventé ni semé ; le cabinet saisit les siens
-- (`a_valider = true` : à valider par un expert, aucune source externe n'est interrogée).
--
-- Garanties tenues en base :
-- - on DÉSACTIVE (actif = false), on ne supprime pas : DELETE refusé au rôle applicatif ;
-- - le rôle applicatif ne modifie que les colonnes de contenu (jamais id, cabinet, auteur, date) ;
-- - MQV01 : identité figée (id, cabinet, auteur, date de création), même pour le propriétaire
--   (traduit en 409 GUICHET_FIGE).
-- - MQV02 : plafond de 500 guichets par cabinet (traduit en 409 PLAFOND_GUICHETS_ATTEINT) ;
--   verrou consultatif par cabinet pour que deux créations simultanées ne dépassent pas le plafond.
-- Lettre de domaine des codes SQLSTATE : `V` (MQV01, MQV02).

CREATE TABLE guichets_financement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  nom text NOT NULL CHECK (length(btrim(nom)) BETWEEN 1 AND 200 AND nom !~ '[[:cntrl:]]'),
  type text NOT NULL CHECK (type IN
    ('banque', 'bailleur', 'fonds_investissement', 'programme_public', 'autre')),
  -- Critères d'éligibilité : un tableau vide signifie « sans restriction » sur ce critère.
  pays text[] NOT NULL DEFAULT '{}' CHECK (cardinality(pays) <= 60
    AND length(array_to_string(pays, ',')) <= 600),
  secteurs text[] NOT NULL DEFAULT '{}' CHECK (cardinality(secteurs) <= 50
    AND length(array_to_string(secteurs, ',')) <= 2000),
  filieres text[] NOT NULL DEFAULT '{}' CHECK (cardinality(filieres) <= 50
    AND length(array_to_string(filieres, ',')) <= 2000),
  tailles text[] NOT NULL DEFAULT '{}' CHECK (cardinality(tailles) <= 10
    AND length(array_to_string(tailles, ',')) <= 200),
  objets text[] NOT NULL DEFAULT '{}' CHECK (cardinality(objets) <= 10
    AND objets <@ ARRAY['creation', 'investissement', 'bfr', 'croissance', 'restructuration',
      'export']::text[]),
  devises text[] NOT NULL DEFAULT '{}' CHECK (cardinality(devises) <= 4
    AND devises <@ ARRAY['XOF', 'XAF', 'EUR', 'USD']::text[]),
  montant_min bigint CHECK (montant_min IS NULL OR montant_min BETWEEN 0 AND 9007199254740991),
  montant_max bigint CHECK (montant_max IS NULL OR montant_max BETWEEN 0 AND 9007199254740991),
  devise_montant text CHECK (devise_montant IS NULL OR devise_montant IN ('XOF', 'XAF', 'EUR', 'USD')),
  date_limite date,
  description text CHECK (description IS NULL OR length(description) <= 4000),
  url text CHECK (url IS NULL OR (length(url) <= 500 AND url ~* '^https?://[^[:space:]]+$')),
  actif boolean NOT NULL DEFAULT true,
  a_valider boolean NOT NULL DEFAULT true,
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  modifie_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  CHECK (montant_min IS NULL OR montant_max IS NULL OR montant_min <= montant_max),
  CHECK ((montant_min IS NULL AND montant_max IS NULL) OR devise_montant IS NOT NULL),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX guichets_financement_liste_idx ON guichets_financement (cabinet_id, actif, nom, id);
ALTER TABLE guichets_financement ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON guichets_financement
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON guichets_financement AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE DELETE ON guichets_financement FROM missionpilot_app;
REVOKE UPDATE ON guichets_financement FROM missionpilot_app;
GRANT UPDATE (nom, type, pays, secteurs, filieres, tailles, objets, devises, montant_min,
  montant_max, devise_montant, date_limite, description, url, actif, a_valider, modifie_le)
  ON guichets_financement TO missionpilot_app;

CREATE FUNCTION controler_guichet_financement() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF (NEW.id, NEW.cabinet_id, NEW.cree_par, NEW.cree_le)
       IS DISTINCT FROM (OLD.id, OLD.cabinet_id, OLD.cree_par, OLD.cree_le) THEN
      RAISE EXCEPTION 'Identité d''un guichet figée.' USING ERRCODE = 'MQV01';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER guichets_financement_identite BEFORE UPDATE ON guichets_financement
  FOR EACH ROW EXECUTE FUNCTION controler_guichet_financement();

CREATE FUNCTION controler_plafond_guichets() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('guichets_financement:' || NEW.cabinet_id::text, 0));
    IF (SELECT count(*) FROM guichets_financement WHERE cabinet_id = NEW.cabinet_id) >= 500 THEN
      RAISE EXCEPTION 'Plafond de 500 guichets par cabinet atteint.' USING ERRCODE = 'MQV02';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER guichets_financement_plafond BEFORE INSERT ON guichets_financement
  FOR EACH ROW EXECUTE FUNCTION controler_plafond_guichets();
