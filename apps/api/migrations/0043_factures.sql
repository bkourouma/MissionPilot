-- Factures et avoirs (FIN-07, FIN-15). Circuit : brouillon → a_approuver →
-- approuvee → emise ; a_approuver → brouillon (rejet motivé) ; une facture
-- émise n'est corrigée que par un avoir, dont l'émission la passe à « annulee ».
-- Montants calculés par @missionpilot/engines (calculerFacture, creerAvoir)
-- et enregistrés ; une facture émise est IMMUABLE (déclencheurs ci-dessous) :
-- ni ses lignes, ni ses montants, ni ses mentions ne changent, et elle ne se
-- supprime pas. Les mentions légales de l'émetteur et du client sont copiées
-- (snapshot) à l'émission. Numérotation continue sans trou par cabinet, nature
-- et exercice (sequences_facturation, verrou de ligne).
-- Encaissements, relances et statut de paiement : livrés ensuite ; ils se
-- branchent sur factures (cabinet_id, id) et net_a_payer, le statut de
-- paiement étant dérivé des encaissements (non stocké ici).

CREATE TABLE factures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  nature text NOT NULL DEFAULT 'facture' CHECK (nature IN ('facture', 'avoir')),
  facture_origine_id uuid,
  mission_id uuid NOT NULL,
  client_id uuid NOT NULL,
  devise text NOT NULL CHECK (devise IN ('XOF', 'XAF', 'EUR', 'USD')),
  statut text NOT NULL DEFAULT 'brouillon'
    CHECK (statut IN ('brouillon', 'a_approuver', 'approuvee', 'emise', 'annulee')),
  objet text CHECK (objet IS NULL OR length(objet) <= 300),
  motif text CHECK (motif IS NULL OR length(motif) <= 500),
  numero text CHECK (numero IS NULL OR length(numero) BETWEEN 1 AND 40),
  exercice int CHECK (exercice IS NULL OR exercice BETWEEN 2000 AND 2100),
  sequence int CHECK (sequence IS NULL OR sequence >= 1),
  date_emission date CHECK (date_emission IS NULL OR date_emission BETWEEN '2000-01-01' AND '2100-12-31'),
  date_echeance date CHECK (date_echeance IS NULL OR date_echeance BETWEEN '2000-01-01' AND '2101-12-31'),
  delai_paiement_jours smallint NOT NULL DEFAULT 30 CHECK (delai_paiement_jours BETWEEN 0 AND 365),
  remise_globale_type text CHECK (remise_globale_type IN ('pourcentage', 'montant')),
  remise_globale_valeur numeric(24, 4) CHECK (remise_globale_valeur IS NULL OR remise_globale_valeur >= 0),
  retenue_active boolean NOT NULL DEFAULT false,
  retenue_taux numeric(7, 4) NOT NULL DEFAULT 0 CHECK (retenue_taux BETWEEN 0 AND 100),
  retenue_base text NOT NULL DEFAULT 'HT' CHECK (retenue_base IN ('HT', 'TTC')),
  retenue_libelle text NOT NULL DEFAULT 'Retenue à la source' CHECK (length(retenue_libelle) BETWEEN 1 AND 120),
  -- Totaux calculés par le moteur (négatifs pour un avoir).
  total_brut bigint NOT NULL DEFAULT 0,
  total_remises bigint NOT NULL DEFAULT 0,
  total_ht bigint NOT NULL DEFAULT 0,
  total_tva bigint NOT NULL DEFAULT 0,
  total_ttc bigint NOT NULL DEFAULT 0,
  total_retenues bigint NOT NULL DEFAULT 0,
  net_a_payer bigint NOT NULL DEFAULT 0,
  tva jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(tva) = 'array'),
  retenues jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(retenues) = 'array'),
  -- Approbation (FIN-15) : rôle exigé par les seuils, calculé à la soumission.
  role_approbateur text CHECK (role_approbateur IN ('chef_mission', 'directeur_mission', 'associe')),
  motif_rejet text CHECK (motif_rejet IS NULL OR length(motif_rejet) <= 500),
  soumise_par uuid,
  soumise_le timestamptz,
  approuvee_par uuid,
  approuvee_le timestamptz,
  emise_par uuid,
  emise_le timestamptz,
  -- Snapshot des mentions légales (émetteur, client, mission) à l'émission.
  mentions jsonb CHECK (mentions IS NULL OR jsonb_typeof(mentions) = 'object'),
  -- Point d'extension : envoi (PDF par e-mail) branché plus tard.
  envoyee_le timestamptz,
  annulee_le timestamptz,
  annulee_par_avoir_id uuid,
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  modifie_le timestamptz NOT NULL DEFAULT now(),
  CHECK ((nature = 'avoir') = (facture_origine_id IS NOT NULL)),
  CHECK ((remise_globale_type IS NULL) = (remise_globale_valeur IS NULL)),
  CHECK (nature = 'facture' OR remise_globale_type IS NULL),
  CHECK ((statut IN ('emise', 'annulee')) = (numero IS NOT NULL)),
  CHECK (statut NOT IN ('emise', 'annulee') OR (exercice IS NOT NULL AND sequence IS NOT NULL
    AND date_emission IS NOT NULL AND date_echeance IS NOT NULL AND mentions IS NOT NULL
    AND emise_par IS NOT NULL AND emise_le IS NOT NULL)),
  CHECK (statut NOT IN ('approuvee', 'emise', 'annulee')
    OR (approuvee_par IS NOT NULL AND approuvee_le IS NOT NULL AND role_approbateur IS NOT NULL)),
  CHECK ((statut = 'annulee') = (annulee_le IS NOT NULL)),
  CHECK ((annulee_le IS NULL) = (annulee_par_avoir_id IS NULL)),
  CHECK (statut <> 'annulee' OR nature = 'facture'),
  CHECK (nature = 'avoir' OR (total_ht >= 0 AND net_a_payer >= 0)),
  CHECK (nature = 'facture' OR (total_ht <= 0 AND net_a_payer <= 0)),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, numero),
  UNIQUE (cabinet_id, nature, exercice, sequence),
  FOREIGN KEY (cabinet_id, facture_origine_id) REFERENCES factures (cabinet_id, id),
  FOREIGN KEY (cabinet_id, annulee_par_avoir_id) REFERENCES factures (cabinet_id, id),
  FOREIGN KEY (cabinet_id, mission_id) REFERENCES missions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, client_id) REFERENCES clients (cabinet_id, id),
  FOREIGN KEY (cabinet_id, soumise_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, approuvee_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, emise_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
-- Jamais deux avoirs pour une même facture (un avoir annule toute la facture).
CREATE UNIQUE INDEX factures_avoir_uniq ON factures (facture_origine_id) WHERE facture_origine_id IS NOT NULL;
CREATE INDEX factures_mission_idx ON factures (cabinet_id, mission_id, cree_le DESC);
CREATE INDEX factures_tri_idx ON factures (cabinet_id, cree_le DESC, id);
ALTER TABLE factures ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON factures
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());

CREATE TABLE facture_lignes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  facture_id uuid NOT NULL,
  mission_id uuid NOT NULL,
  ordre int NOT NULL DEFAULT 0 CHECK (ordre BETWEEN 0 AND 100000),
  origine text NOT NULL CHECK (origine IN ('echeance', 'debours')),
  echeance_id uuid,
  debours_id uuid,
  libelle text NOT NULL CHECK (length(libelle) BETWEEN 1 AND 300),
  quantite numeric(14, 4) NOT NULL,
  prix_unitaire bigint NOT NULL,
  taux_tva numeric(5, 2) NOT NULL CHECK (taux_tva BETWEEN 0 AND 100),
  remise_type text CHECK (remise_type IN ('pourcentage', 'montant')),
  remise_valeur numeric(24, 4) CHECK (remise_valeur IS NULL OR remise_valeur >= 0),
  montant_brut bigint NOT NULL DEFAULT 0,
  remise_ligne bigint NOT NULL DEFAULT 0,
  part_remise_globale bigint NOT NULL DEFAULT 0,
  montant_ht bigint NOT NULL DEFAULT 0,
  CHECK ((remise_type IS NULL) = (remise_valeur IS NULL)),
  CHECK ((origine = 'echeance') = (echeance_id IS NOT NULL)),
  CHECK ((origine = 'debours') = (debours_id IS NOT NULL)),
  FOREIGN KEY (cabinet_id, facture_id) REFERENCES factures (cabinet_id, id) ON DELETE CASCADE,
  FOREIGN KEY (cabinet_id, mission_id) REFERENCES missions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, mission_id, echeance_id) REFERENCES echeances_facturation (cabinet_id, mission_id, id),
  FOREIGN KEY (cabinet_id, mission_id, debours_id) REFERENCES debours (cabinet_id, mission_id, id)
);
CREATE INDEX facture_lignes_facture_idx ON facture_lignes (facture_id, ordre);
ALTER TABLE facture_lignes ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON facture_lignes
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());

-- Rattachements en cours : une échéance ou un débours n'est facturé que par
-- une seule facture non annulée. L'émission d'un avoir libère ceux de la
-- facture annulée (libere_le), qui redeviennent facturables.
CREATE TABLE facturation_liens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  facture_id uuid NOT NULL,
  mission_id uuid NOT NULL,
  echeance_id uuid,
  debours_id uuid,
  cree_le timestamptz NOT NULL DEFAULT now(),
  libere_le timestamptz,
  CHECK ((echeance_id IS NULL) <> (debours_id IS NULL)),
  FOREIGN KEY (cabinet_id, facture_id) REFERENCES factures (cabinet_id, id) ON DELETE CASCADE,
  FOREIGN KEY (cabinet_id, mission_id, echeance_id) REFERENCES echeances_facturation (cabinet_id, mission_id, id),
  FOREIGN KEY (cabinet_id, mission_id, debours_id) REFERENCES debours (cabinet_id, mission_id, id)
);
CREATE UNIQUE INDEX facturation_liens_echeance_uniq ON facturation_liens (echeance_id)
  WHERE echeance_id IS NOT NULL AND libere_le IS NULL;
CREATE UNIQUE INDEX facturation_liens_debours_uniq ON facturation_liens (debours_id)
  WHERE debours_id IS NOT NULL AND libere_le IS NULL;
CREATE INDEX facturation_liens_facture_idx ON facturation_liens (facture_id);
ALTER TABLE facturation_liens ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON facturation_liens
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());

-- Séquences de numérotation par cabinet, nature et exercice : la ligne est
-- verrouillée (FOR UPDATE) pendant l'émission ; un numéro n'est consommé que
-- si la transaction d'émission aboutit, il n'est jamais réutilisé ni sauté.
CREATE TABLE sequences_facturation (
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  nature text NOT NULL CHECK (nature IN ('facture', 'avoir')),
  exercice int NOT NULL CHECK (exercice BETWEEN 2000 AND 2100),
  dernier int NOT NULL DEFAULT 0 CHECK (dernier >= 0),
  PRIMARY KEY (cabinet_id, nature, exercice)
);
ALTER TABLE sequences_facturation ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON sequences_facturation
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE DELETE ON sequences_facturation FROM missionpilot_app;

CREATE FUNCTION controler_sequence_facturation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF (NEW.cabinet_id, NEW.nature, NEW.exercice) IS DISTINCT FROM (OLD.cabinet_id, OLD.nature, OLD.exercice)
       OR NEW.dernier <> OLD.dernier + 1 THEN
      RAISE EXCEPTION 'Numérotation des factures : incrément de un seulement.' USING ERRCODE = 'MPB04';
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER sequences_facturation_controle BEFORE UPDATE ON sequences_facturation
  FOR EACH ROW EXECUTE FUNCTION controler_sequence_facturation();

-- Facture : identité figée, transitions contrôlées, contenu figé dès la
-- soumission, et IMMUABLE après émission (seuls passages permis : émise →
-- annulée par un avoir, et la date d'envoi renseignée une fois).
CREATE FUNCTION controler_facture() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v factures%ROWTYPE;
  BEGIN
    IF TG_OP = 'DELETE' THEN
      IF OLD.statut <> 'brouillon' OR OLD.numero IS NOT NULL THEN
        RAISE EXCEPTION 'Facture soumise ou émise : suppression refusée.' USING ERRCODE = 'MPB01';
      END IF;
      RETURN OLD;
    END IF;
    IF (NEW.cabinet_id, NEW.nature, NEW.facture_origine_id, NEW.mission_id, NEW.client_id, NEW.devise,
        NEW.cree_par, NEW.cree_le)
       IS DISTINCT FROM
       (OLD.cabinet_id, OLD.nature, OLD.facture_origine_id, OLD.mission_id, OLD.client_id, OLD.devise,
        OLD.cree_par, OLD.cree_le) THEN
      RAISE EXCEPTION 'Identité d''une facture figée.' USING ERRCODE = 'MPB01';
    END IF;
    IF OLD.statut IN ('emise', 'annulee') THEN
      v := NEW;
      v.statut := OLD.statut;
      v.annulee_le := OLD.annulee_le;
      v.annulee_par_avoir_id := OLD.annulee_par_avoir_id;
      v.envoyee_le := OLD.envoyee_le;
      v.modifie_le := OLD.modifie_le;
      IF ROW(v.*) IS DISTINCT FROM ROW(OLD.*)
         OR (NEW.statut IS DISTINCT FROM OLD.statut AND NOT (OLD.statut = 'emise' AND NEW.statut = 'annulee'))
         OR (OLD.statut = 'annulee'
             AND (NEW.annulee_le, NEW.annulee_par_avoir_id) IS DISTINCT FROM (OLD.annulee_le, OLD.annulee_par_avoir_id))
         OR (OLD.envoyee_le IS NOT NULL AND NEW.envoyee_le IS DISTINCT FROM OLD.envoyee_le) THEN
        RAISE EXCEPTION 'Facture émise : immuable, la corriger par un avoir.' USING ERRCODE = 'MPB01';
      END IF;
      RETURN NEW;
    END IF;
    IF NEW.statut IS DISTINCT FROM OLD.statut AND NOT (
         (OLD.statut = 'brouillon' AND NEW.statut = 'a_approuver')
      OR (OLD.statut = 'a_approuver' AND NEW.statut IN ('brouillon', 'approuvee'))
      OR (OLD.statut = 'approuvee' AND NEW.statut IN ('emise', 'brouillon'))) THEN
      RAISE EXCEPTION 'Transition de statut de facture refusée.' USING ERRCODE = 'MPB01';
    END IF;
    -- Contenu figé dès la soumission : seule une facture en brouillon se modifie.
    IF OLD.statut IN ('a_approuver', 'approuvee') AND
       (NEW.objet, NEW.delai_paiement_jours, NEW.remise_globale_type, NEW.remise_globale_valeur,
        NEW.retenue_active, NEW.retenue_taux, NEW.retenue_base, NEW.retenue_libelle, NEW.total_brut,
        NEW.total_remises, NEW.total_ht, NEW.total_tva, NEW.total_ttc, NEW.total_retenues,
        NEW.net_a_payer, NEW.tva, NEW.retenues)
         IS DISTINCT FROM
       (OLD.objet, OLD.delai_paiement_jours, OLD.remise_globale_type, OLD.remise_globale_valeur,
        OLD.retenue_active, OLD.retenue_taux, OLD.retenue_base, OLD.retenue_libelle, OLD.total_brut,
        OLD.total_remises, OLD.total_ht, OLD.total_tva, OLD.total_ttc, OLD.total_retenues,
        OLD.net_a_payer, OLD.tva, OLD.retenues) THEN
      RAISE EXCEPTION 'Facture soumise : contenu figé.' USING ERRCODE = 'MPB01';
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER factures_controle BEFORE UPDATE OR DELETE ON factures
  FOR EACH ROW EXECUTE FUNCTION controler_facture();

-- Lignes : ajoutées, modifiées ou supprimées seulement dans une facture en
-- brouillon. SECURITY DEFINER : le contrôle lit la facture quelle que soit la
-- visibilité RLS ; une facture déjà supprimée (cascade d'un brouillon) passe.
CREATE FUNCTION controler_facture_ligne() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE v_factures uuid[]; v_statut text;
  BEGIN
    IF TG_OP = 'INSERT' THEN v_factures := ARRAY[NEW.facture_id];
    ELSIF TG_OP = 'DELETE' THEN v_factures := ARRAY[OLD.facture_id];
    ELSE v_factures := ARRAY[OLD.facture_id, NEW.facture_id];
    END IF;
    IF EXISTS (SELECT 1 FROM factures WHERE id = ANY (v_factures) AND statut <> 'brouillon') THEN
      RAISE EXCEPTION 'Facture soumise ou émise : lignes figées.' USING ERRCODE = 'MPB01';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER facture_lignes_controle BEFORE INSERT OR UPDATE OR DELETE ON facture_lignes
  FOR EACH ROW EXECUTE FUNCTION controler_facture_ligne();

-- Rattachements : créés ou supprimés avec un brouillon ; libérés une seule
-- fois, quand leur facture est annulée par un avoir.
CREATE FUNCTION controler_facturation_lien() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE v_statut text;
  BEGIN
    SELECT statut INTO v_statut FROM factures
      WHERE id = (CASE WHEN TG_OP = 'INSERT' THEN NEW.facture_id ELSE OLD.facture_id END);
    IF TG_OP = 'INSERT' THEN
      IF v_statut IS DISTINCT FROM 'brouillon' THEN
        RAISE EXCEPTION 'Rattachement à une facture non brouillon refusé.' USING ERRCODE = 'MPB01';
      END IF;
      RETURN NEW;
    END IF;
    IF TG_OP = 'DELETE' THEN
      IF v_statut IS NOT NULL AND v_statut <> 'brouillon' THEN
        RAISE EXCEPTION 'Rattachement d''une facture soumise ou émise : figé.' USING ERRCODE = 'MPB01';
      END IF;
      RETURN OLD;
    END IF;
    IF (NEW.cabinet_id, NEW.facture_id, NEW.mission_id, NEW.echeance_id, NEW.debours_id, NEW.cree_le)
         IS DISTINCT FROM (OLD.cabinet_id, OLD.facture_id, OLD.mission_id, OLD.echeance_id, OLD.debours_id, OLD.cree_le)
       OR OLD.libere_le IS NOT NULL OR NEW.libere_le IS NULL OR v_statut IS DISTINCT FROM 'annulee' THEN
      RAISE EXCEPTION 'Rattachement figé : libéré seulement par l''annulation de sa facture.'
        USING ERRCODE = 'MPB01';
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER facturation_liens_controle BEFORE INSERT OR UPDATE OR DELETE ON facturation_liens
  FOR EACH ROW EXECUTE FUNCTION controler_facturation_lien();

-- Les temps rattachés à une échéance facturée ne se détachent pas.
CREATE FUNCTION controler_echeance_temps() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF EXISTS (SELECT 1 FROM echeances_facturation WHERE id = OLD.echeance_id AND statut = 'facturee') THEN
      RAISE EXCEPTION 'Temps d''une échéance facturée : rattachement figé.' USING ERRCODE = 'MPB03';
    END IF;
    RETURN OLD;
  END $$;

CREATE TRIGGER echeance_temps_controle BEFORE DELETE ON echeance_temps
  FOR EACH ROW EXECUTE FUNCTION controler_echeance_temps();
