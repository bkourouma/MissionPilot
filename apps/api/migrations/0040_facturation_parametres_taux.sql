-- Facturation (FIN-02, FIN-07) : paramètres de facturation du cabinet et taux
-- de vente négociés par client. Toute table porte cabinet_id, RLS (politique
-- `isolation`) et des clés étrangères composites (cabinet_id, id).
-- Codes SQLSTATE de la facturation : MPB01 facture émise immuable, MPB02
-- débours validé figé, MPB03 échéance facturée figée, MPB04 numérotation.

-- Paramètres de facturation (absence de ligne : valeurs de départ).
-- TVA 18 % (Côte d'Ivoire) et retenue désactivée : valeurs de DÉPART, à
-- faire valider par le métier (valeurs_validees = false tant que non confirmé).
CREATE TABLE parametres_facturation (
  cabinet_id uuid PRIMARY KEY REFERENCES cabinets (id) ON DELETE CASCADE,
  -- Mentions légales de l'émetteur (snapshot copié dans chaque facture émise).
  raison_sociale text CHECK (raison_sociale IS NULL OR length(raison_sociale) BETWEEN 1 AND 200),
  forme_juridique text CHECK (forme_juridique IS NULL OR length(forme_juridique) <= 80),
  rccm text CHECK (rccm IS NULL OR length(rccm) <= 80),
  compte_contribuable text CHECK (compte_contribuable IS NULL OR length(compte_contribuable) <= 80),
  regime_fiscal text CHECK (regime_fiscal IS NULL OR length(regime_fiscal) <= 120),
  adresse text CHECK (adresse IS NULL OR length(adresse) <= 500),
  telephone text CHECK (telephone IS NULL OR length(telephone) <= 40),
  email text CHECK (email IS NULL OR length(email) <= 254),
  banque text CHECK (banque IS NULL OR length(banque) <= 120),
  iban text CHECK (iban IS NULL OR iban ~ '^[A-Z]{2}[0-9A-Z]{10,32}$'),
  autres_coordonnees text CHECK (autres_coordonnees IS NULL OR length(autres_coordonnees) <= 500),
  mentions_complementaires text
    CHECK (mentions_complementaires IS NULL OR length(mentions_complementaires) <= 1000),
  -- Numérotation : <préfixe>-<exercice>-<numéro sur N chiffres>, continue par exercice.
  prefixe_facture text NOT NULL DEFAULT 'FA' CHECK (prefixe_facture ~ '^[A-Z0-9]{1,10}$'),
  prefixe_avoir text NOT NULL DEFAULT 'AV' CHECK (prefixe_avoir ~ '^[A-Z0-9]{1,10}$'),
  chiffres_numero smallint NOT NULL DEFAULT 5 CHECK (chiffres_numero BETWEEN 3 AND 8),
  delai_paiement_jours smallint NOT NULL DEFAULT 30 CHECK (delai_paiement_jours BETWEEN 0 AND 365),
  taux_tva_defaut numeric(5, 2) NOT NULL DEFAULT 18 CHECK (taux_tva_defaut BETWEEN 0 AND 100),
  taux_tva_autorises numeric(5, 2)[] NOT NULL DEFAULT '{0,18}'
    CHECK (cardinality(taux_tva_autorises) BETWEEN 1 AND 10),
  taux_tva_debours numeric(5, 2) NOT NULL DEFAULT 0 CHECK (taux_tva_debours BETWEEN 0 AND 100),
  retenue_active boolean NOT NULL DEFAULT false,
  retenue_taux numeric(7, 4) NOT NULL DEFAULT 0 CHECK (retenue_taux BETWEEN 0 AND 100),
  retenue_base text NOT NULL DEFAULT 'HT' CHECK (retenue_base IN ('HT', 'TTC')),
  retenue_libelle text NOT NULL DEFAULT 'Retenue à la source'
    CHECK (length(retenue_libelle) BETWEEN 1 AND 120),
  valeurs_validees boolean NOT NULL DEFAULT false,
  modifie_par uuid,
  modifie_le timestamptz NOT NULL DEFAULT now(),
  CHECK (prefixe_facture <> prefixe_avoir),
  CHECK (taux_tva_defaut = ANY (taux_tva_autorises)),
  CHECK (taux_tva_debours = ANY (taux_tva_autorises)),
  FOREIGN KEY (cabinet_id, modifie_par) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE parametres_facturation ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON parametres_facturation
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE DELETE ON parametres_facturation FROM missionpilot_app;

-- Taux de vente journaliers négociés par client et par grade (FIN-02) :
-- donnée financière, servie seulement avec « taux.gerer » et « finance.lire ».
-- Une fin de validité remplace la suppression.
CREATE TABLE taux_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  grade_id uuid NOT NULL,
  taux bigint NOT NULL CHECK (taux >= 0),
  devise text NOT NULL CHECK (devise IN ('XOF', 'XAF', 'EUR', 'USD')),
  valide_du date CHECK (valide_du IS NULL OR valide_du BETWEEN '2000-01-01' AND '2100-12-31'),
  valide_au date CHECK (valide_au IS NULL OR valide_au BETWEEN '2000-01-01' AND '2100-12-31'),
  cree_par uuid,
  cree_le timestamptz NOT NULL DEFAULT now(),
  modifie_le timestamptz NOT NULL DEFAULT now(),
  CHECK (valide_au IS NULL OR valide_du IS NULL OR valide_au >= valide_du),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, client_id) REFERENCES clients (cabinet_id, id),
  FOREIGN KEY (cabinet_id, grade_id) REFERENCES grades (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
-- Un seul taux par client, grade, devise et début de validité.
CREATE UNIQUE INDEX taux_clients_uniq ON taux_clients (cabinet_id, client_id, grade_id, devise, valide_du)
  NULLS NOT DISTINCT;
CREATE INDEX taux_clients_client_idx ON taux_clients (cabinet_id, client_id, grade_id);
ALTER TABLE taux_clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON taux_clients
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE DELETE ON taux_clients FROM missionpilot_app;
