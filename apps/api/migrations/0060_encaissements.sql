-- Encaissements et imputations (FIN-09). Historique en AJOUT SEUL : un
-- encaissement ou une imputation ne se modifie ni ne se supprime ; une erreur
-- se corrige par une contre-passation (encaissement négatif lié, motif
-- obligatoire, validée par un autre utilisateur que le demandeur, sauf
-- associé : contrôle applicatif, valideur tracé). Le statut de paiement d'une
-- facture est DÉRIVÉ des imputations (non payée, partiellement payée, soldée,
-- en retard) : il n'est stocké nulle part. Soldes et contrôles de trop-perçu
-- sont calculés par @missionpilot/engines dans l'API, sous verrou FOR UPDATE
-- des factures et de l'encaissement concernés.

CREATE TABLE encaissements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  date_encaissement date NOT NULL CHECK (date_encaissement BETWEEN '2000-01-01' AND '2100-12-31'),
  -- Positif ; négatif seulement pour une contre-passation.
  montant bigint NOT NULL CHECK (montant <> 0),
  devise text NOT NULL CHECK (devise IN ('XOF', 'XAF', 'EUR', 'USD')),
  mode text NOT NULL CHECK (mode IN ('virement', 'cheque', 'especes', 'mobile_money')),
  -- Mobile Money : référence d'opération saisie à la main (pas d'API de paiement en V1).
  operateur text CHECK (operateur IN ('orange_money', 'mtn_momo', 'wave', 'moov_money', 'autre')),
  reference text CHECK (reference IS NULL OR (length(reference) BETWEEN 1 AND 120
    AND reference !~ '[[:cntrl:]]')),
  commentaire text CHECK (commentaire IS NULL OR length(commentaire) <= 500),
  -- Part non imputée acceptée comme avance du client (trop-perçu explicite).
  avance boolean NOT NULL DEFAULT false,
  contre_passation_de uuid,
  motif text CHECK (motif IS NULL OR length(motif) BETWEEN 1 AND 500),
  saisi_par uuid NOT NULL,
  -- Contre-passation : valideur (distinct du demandeur sauf associé, contrôle applicatif).
  valide_par uuid,
  saisi_le timestamptz NOT NULL DEFAULT now(),
  CHECK ((mode = 'mobile_money') = (operateur IS NOT NULL)),
  CHECK (mode NOT IN ('mobile_money', 'cheque') OR reference IS NOT NULL OR contre_passation_de IS NOT NULL),
  CHECK ((contre_passation_de IS NULL) = (montant > 0)),
  CHECK ((contre_passation_de IS NULL) = (motif IS NULL)),
  CHECK ((contre_passation_de IS NULL) = (valide_par IS NULL)),
  CHECK (contre_passation_de IS NULL OR NOT avance),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, client_id) REFERENCES clients (cabinet_id, id),
  FOREIGN KEY (cabinet_id, contre_passation_de) REFERENCES encaissements (cabinet_id, id),
  FOREIGN KEY (cabinet_id, saisi_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, valide_par) REFERENCES utilisateurs (cabinet_id, id)
);
-- Un encaissement n'est contre-passé qu'une fois.
CREATE UNIQUE INDEX encaissements_contre_passation_uniq ON encaissements (contre_passation_de)
  WHERE contre_passation_de IS NOT NULL;
CREATE INDEX encaissements_tri_idx ON encaissements (cabinet_id, date_encaissement DESC, id);
CREATE INDEX encaissements_client_idx ON encaissements (cabinet_id, client_id, date_encaissement);
ALTER TABLE encaissements ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON encaissements
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE UPDATE, DELETE ON encaissements FROM missionpilot_app;

-- Imputation d'un encaissement sur une facture émise du même client et de la
-- même devise. `origine` : saisie avec l'encaissement, imputation ultérieure
-- d'une avance, ou contre-passation (négative, miroir de l'imputation annulée).
CREATE TABLE imputations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  encaissement_id uuid NOT NULL,
  facture_id uuid NOT NULL,
  montant bigint NOT NULL CHECK (montant <> 0),
  devise text NOT NULL CHECK (devise IN ('XOF', 'XAF', 'EUR', 'USD')),
  origine text NOT NULL CHECK (origine IN ('saisie', 'avance', 'contre_passation')),
  date_imputation date NOT NULL CHECK (date_imputation BETWEEN '2000-01-01' AND '2100-12-31'),
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  CHECK ((origine = 'contre_passation') = (montant < 0)),
  FOREIGN KEY (cabinet_id, encaissement_id) REFERENCES encaissements (cabinet_id, id),
  FOREIGN KEY (cabinet_id, facture_id) REFERENCES factures (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX imputations_facture_idx ON imputations (cabinet_id, facture_id);
CREATE INDEX imputations_encaissement_idx ON imputations (encaissement_id);
ALTER TABLE imputations ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON imputations
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE UPDATE, DELETE ON imputations FROM missionpilot_app;

-- Ajout seul, même pour le propriétaire : aucune modification ni suppression.
CREATE FUNCTION refuser_modification_finance() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    RAISE EXCEPTION 'Historique financier en ajout seul : corriger par une contre-passation.'
      USING ERRCODE = 'MPE01';
  END $$;

CREATE TRIGGER encaissements_ajout_seul BEFORE UPDATE OR DELETE ON encaissements
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_finance();
CREATE TRIGGER imputations_ajout_seul BEFORE UPDATE OR DELETE ON imputations
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_finance();

-- Cohérence structurelle d'une imputation (les montants sont contrôlés par le
-- moteur dans l'API) : facture émise (ou annulée, pour une contre-passation),
-- nature « facture », même client et même devise que l'encaissement ; une
-- imputation positive porte sur un encaissement positif, une négative sur une
-- contre-passation. SECURITY DEFINER : lecture hors visibilité RLS.
CREATE FUNCTION controler_imputation() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE f factures%ROWTYPE; e encaissements%ROWTYPE;
  BEGIN
    SELECT * INTO f FROM factures WHERE id = NEW.facture_id AND cabinet_id = NEW.cabinet_id;
    SELECT * INTO e FROM encaissements WHERE id = NEW.encaissement_id AND cabinet_id = NEW.cabinet_id;
    IF f.id IS NULL OR e.id IS NULL THEN
      RAISE EXCEPTION 'Imputation : facture ou encaissement inconnu.' USING ERRCODE = 'MPE02';
    END IF;
    IF f.nature <> 'facture' OR f.client_id <> e.client_id OR f.devise <> e.devise
       OR NEW.devise <> e.devise THEN
      RAISE EXCEPTION 'Imputation : facture d''un autre client ou d''une autre devise.' USING ERRCODE = 'MPE02';
    END IF;
    IF NEW.montant > 0 AND (f.statut <> 'emise' OR e.montant < 0
       OR EXISTS (SELECT 1 FROM encaissements x WHERE x.contre_passation_de = e.id)) THEN
      RAISE EXCEPTION 'Imputation : facture non émise ou encaissement contre-passé.' USING ERRCODE = 'MPE02';
    END IF;
    IF NEW.montant < 0 AND (e.contre_passation_de IS NULL OR f.statut NOT IN ('emise', 'annulee')) THEN
      RAISE EXCEPTION 'Imputation négative réservée aux contre-passations.' USING ERRCODE = 'MPE02';
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER imputations_controle BEFORE INSERT ON imputations
  FOR EACH ROW EXECUTE FUNCTION controler_imputation();

-- Contre-passation d'un encaissement négatif : il reprend le client, la
-- devise, le mode et l'opposé exact du montant de l'encaissement d'origine,
-- qui doit être positif et non déjà contre-passé (index unique).
CREATE FUNCTION controler_encaissement() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE o encaissements%ROWTYPE;
  BEGIN
    IF NEW.contre_passation_de IS NULL THEN RETURN NEW; END IF;
    SELECT * INTO o FROM encaissements WHERE id = NEW.contre_passation_de AND cabinet_id = NEW.cabinet_id;
    IF o.id IS NULL OR o.montant <= 0 OR o.contre_passation_de IS NOT NULL
       OR NEW.montant <> -o.montant OR NEW.devise <> o.devise OR NEW.client_id <> o.client_id
       OR NEW.mode <> o.mode THEN
      RAISE EXCEPTION 'Contre-passation : opposé exact d''un encaissement positif.' USING ERRCODE = 'MPE02';
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER encaissements_controle BEFORE INSERT ON encaissements
  FOR EACH ROW EXECUTE FUNCTION controler_encaissement();

-- Demandes de contre-passation : demandée → validée (crée l'encaissement
-- négatif) | rejetée (motif). Une seule demande en attente par encaissement ;
-- une décision est définitive (déclencheur).
CREATE TABLE contre_passations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  encaissement_id uuid NOT NULL,
  motif text NOT NULL CHECK (length(btrim(motif)) > 0 AND length(motif) <= 500),
  statut text NOT NULL DEFAULT 'demandee' CHECK (statut IN ('demandee', 'validee', 'rejetee')),
  demandee_par uuid NOT NULL,
  demandee_le timestamptz NOT NULL DEFAULT now(),
  decidee_par uuid,
  decidee_le timestamptz,
  motif_rejet text CHECK (motif_rejet IS NULL OR length(motif_rejet) <= 500),
  encaissement_negatif_id uuid,
  CHECK (statut = 'demandee' OR (decidee_par IS NOT NULL AND decidee_le IS NOT NULL)),
  CHECK ((statut = 'validee') = (encaissement_negatif_id IS NOT NULL)),
  CHECK (statut <> 'rejetee' OR (motif_rejet IS NOT NULL AND length(btrim(motif_rejet)) > 0)),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, encaissement_id) REFERENCES encaissements (cabinet_id, id),
  FOREIGN KEY (cabinet_id, encaissement_negatif_id) REFERENCES encaissements (cabinet_id, id),
  FOREIGN KEY (cabinet_id, demandee_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, decidee_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE UNIQUE INDEX contre_passations_en_attente_uniq ON contre_passations (encaissement_id)
  WHERE statut = 'demandee';
CREATE INDEX contre_passations_tri_idx ON contre_passations (cabinet_id, demandee_le DESC, id);
ALTER TABLE contre_passations ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON contre_passations
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE DELETE ON contre_passations FROM missionpilot_app;

CREATE FUNCTION controler_contre_passation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Demande de contre-passation : suppression refusée.' USING ERRCODE = 'MPE01';
    END IF;
    IF OLD.statut <> 'demandee' OR NEW.statut = 'demandee'
       OR (NEW.cabinet_id, NEW.encaissement_id, NEW.motif, NEW.demandee_par, NEW.demandee_le)
          IS DISTINCT FROM (OLD.cabinet_id, OLD.encaissement_id, OLD.motif, OLD.demandee_par, OLD.demandee_le) THEN
      RAISE EXCEPTION 'Demande de contre-passation déjà décidée.' USING ERRCODE = 'MPE01';
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER contre_passations_controle BEFORE UPDATE OR DELETE ON contre_passations
  FOR EACH ROW EXECUTE FUNCTION controler_contre_passation();
