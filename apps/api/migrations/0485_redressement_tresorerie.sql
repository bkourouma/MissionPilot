-- Redressement : trésorerie à 13 semaines (RED-06 en partie, RED-11). SQLSTATE : voir 0480.
--
-- - red_tresorerie_versions : une prévision (fenêtre de 13 semaines à partir d'un lundi), EN AJOUT
--   SEUL ; une nouvelle version par fenêtre glissante ;
-- - red_tresorerie_lignes   : flux prévus d'une version, EN AJOUT SEUL, écrits dans la transaction
--   de leur version ;
-- - red_tresorerie_realises : réalisé d'une semaine, EN AJOUT SEUL ; une correction est une nouvelle
--   ligne qui REMPLACE la courante de la semaine (chaîne `remplace_id`, 10 corrections au plus).
-- Soldes, écarts, semaines de tension et besoin de financement sont calculés à la lecture par le
-- moteur ; la contiguïté des semaines réalisées est une règle de l'API et du moteur.
-- Montants en unités mineures, bornés à 10^13 (les sommes de 600 lignes restent exactes en nombre).

CREATE TABLE red_tresorerie_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  dossier_id uuid NOT NULL,
  version int NOT NULL CHECK (version >= 1),
  -- Lundi de la semaine 1.
  date_debut date NOT NULL
    CHECK (extract(isodow FROM date_debut) = 1 AND date_debut BETWEEN '2000-01-01' AND '2100-12-31'),
  -- Peut être négatif (découvert).
  solde_initial bigint NOT NULL
    CHECK (solde_initial BETWEEN -10000000000000 AND 10000000000000),
  seuil_tension bigint NOT NULL DEFAULT 0 CHECK (seuil_tension BETWEEN 0 AND 10000000000000),
  motif text CHECK (motif IS NULL OR length(motif) BETWEEN 1 AND 500),
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, dossier_id, id),
  UNIQUE (cabinet_id, dossier_id, version),
  FOREIGN KEY (cabinet_id, dossier_id) REFERENCES red_dossiers (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE red_tresorerie_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON red_tresorerie_versions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON red_tresorerie_versions AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON red_tresorerie_versions FROM missionpilot_app;
CREATE TRIGGER red_tresorerie_versions_ajout_seul BEFORE UPDATE OR DELETE ON red_tresorerie_versions
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_redressement();
CREATE TRIGGER red_tresorerie_versions_01_mission_ouverte BEFORE INSERT ON red_tresorerie_versions
  FOR EACH ROW EXECUTE FUNCTION red_controler_mission_ouverte();
CREATE TRIGGER red_tresorerie_versions_plafond BEFORE INSERT ON red_tresorerie_versions
  FOR EACH ROW EXECUTE FUNCTION red_controler_plafond('dossier_id', '200', 'versions de trésorerie par dossier');
CREATE TRIGGER red_tresorerie_versions_version BEFORE INSERT ON red_tresorerie_versions
  FOR EACH ROW EXECUTE FUNCTION red_controler_version('dossier_id');

CREATE TABLE red_tresorerie_lignes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  dossier_id uuid NOT NULL,
  version_id uuid NOT NULL,
  rang smallint NOT NULL CHECK (rang BETWEEN 1 AND 600),
  semaine smallint NOT NULL CHECK (semaine BETWEEN 1 AND 13),
  sens text NOT NULL CHECK (sens IN ('encaissement', 'decaissement')),
  categorie text NOT NULL,
  libelle text CHECK (libelle IS NULL OR length(libelle) BETWEEN 1 AND 200),
  montant bigint NOT NULL CHECK (montant BETWEEN 1 AND 10000000000000),
  creancier_id uuid,
  echeance_id uuid,
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, version_id, rang),
  CHECK (CASE sens
    WHEN 'encaissement' THEN categorie IN ('clients', 'autres_encaissements', 'financement', 'cessions')
    ELSE categorie IN ('fournisseurs', 'salaires', 'fiscal_social', 'loyers_charges', 'service_dette',
                       'investissements', 'autres_decaissements') END),
  CHECK (echeance_id IS NULL OR creancier_id IS NOT NULL),
  FOREIGN KEY (cabinet_id, dossier_id) REFERENCES red_dossiers (cabinet_id, id),
  FOREIGN KEY (cabinet_id, dossier_id, version_id)
    REFERENCES red_tresorerie_versions (cabinet_id, dossier_id, id),
  FOREIGN KEY (cabinet_id, dossier_id, creancier_id)
    REFERENCES red_creanciers (cabinet_id, dossier_id, id),
  FOREIGN KEY (cabinet_id, dossier_id, echeance_id)
    REFERENCES red_echeances (cabinet_id, dossier_id, id)
);
ALTER TABLE red_tresorerie_lignes ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON red_tresorerie_lignes
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON red_tresorerie_lignes AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON red_tresorerie_lignes FROM missionpilot_app;
CREATE TRIGGER red_tresorerie_lignes_ajout_seul BEFORE UPDATE OR DELETE ON red_tresorerie_lignes
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_redressement();

-- Une ligne naît dans la transaction de sa version (modèle controler_dossier_etat_ligne, 0222) ;
-- l'échéance rattachée appartient au créancier de la ligne.
CREATE FUNCTION red_controler_tresorerie_ligne() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM red_tresorerie_versions v
                   WHERE v.id = NEW.version_id AND v.cree_le = now()) THEN
      RAISE EXCEPTION 'Les lignes de trésorerie naissent dans la transaction de leur version.'
        USING ERRCODE = 'MPZ01';
    END IF;
    IF NEW.echeance_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM red_echeances e
         WHERE e.id = NEW.echeance_id AND e.creancier_id = NEW.creancier_id) THEN
      RAISE EXCEPTION 'L''échéance rattachée n''appartient pas au créancier de la ligne.'
        USING ERRCODE = 'MPZ02';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER red_tresorerie_lignes_controle BEFORE INSERT ON red_tresorerie_lignes
  FOR EACH ROW EXECUTE FUNCTION red_controler_tresorerie_ligne();
CREATE TRIGGER red_tresorerie_lignes_01_mission_ouverte BEFORE INSERT ON red_tresorerie_lignes
  FOR EACH ROW EXECUTE FUNCTION red_controler_mission_ouverte();
CREATE TRIGGER red_tresorerie_lignes_plafond BEFORE INSERT ON red_tresorerie_lignes
  FOR EACH ROW EXECUTE FUNCTION red_controler_plafond('version_id', '600', 'lignes par version de trésorerie');

CREATE TABLE red_tresorerie_realises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  dossier_id uuid NOT NULL,
  semaine_debut date NOT NULL
    CHECK (extract(isodow FROM semaine_debut) = 1
           AND semaine_debut BETWEEN '2000-01-01' AND '2100-12-31'),
  -- { "encaissement": { "clients": 1200000 }, "decaissement": { "salaires": 800000 } } : catégories
  -- et entiers validés par le schéma partagé.
  flux jsonb NOT NULL CHECK (jsonb_typeof(flux) = 'object' AND octet_length(flux::text) <= 4000),
  -- Solde bancaire de fin de semaine, facultatif : il ancre le solde retenu.
  solde_constate bigint
    CHECK (solde_constate IS NULL OR solde_constate BETWEEN -10000000000000 AND 10000000000000),
  remplace_id uuid,
  commentaire text CHECK (commentaire IS NULL OR length(commentaire) BETWEEN 1 AND 1000),
  saisi_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, dossier_id, id),
  UNIQUE (cabinet_id, remplace_id),
  CHECK (remplace_id IS NULL OR remplace_id <> id),
  FOREIGN KEY (cabinet_id, dossier_id) REFERENCES red_dossiers (cabinet_id, id),
  FOREIGN KEY (cabinet_id, dossier_id, remplace_id)
    REFERENCES red_tresorerie_realises (cabinet_id, dossier_id, id),
  FOREIGN KEY (cabinet_id, saisi_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX red_tresorerie_realises_semaine_idx
  ON red_tresorerie_realises (cabinet_id, dossier_id, semaine_debut, cree_le);
ALTER TABLE red_tresorerie_realises ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON red_tresorerie_realises
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON red_tresorerie_realises AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON red_tresorerie_realises FROM missionpilot_app;
CREATE TRIGGER red_tresorerie_realises_ajout_seul BEFORE UPDATE OR DELETE ON red_tresorerie_realises
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_redressement();

-- La ligne courante d'une semaine est celle qu'aucune autre ne remplace : une nouvelle ligne la
-- remplace, et elle seule (ou n'a pas de remplacée s'il n'y en a pas). 11 lignes au plus par semaine.
CREATE FUNCTION red_controler_realise() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_courante uuid;
    v_nombre bigint;
  BEGIN
    SELECT r.id INTO v_courante FROM red_tresorerie_realises r
      WHERE r.dossier_id = NEW.dossier_id AND r.semaine_debut = NEW.semaine_debut
        AND NOT EXISTS (SELECT 1 FROM red_tresorerie_realises s WHERE s.remplace_id = r.id)
      LIMIT 1;
    IF v_courante IS DISTINCT FROM NEW.remplace_id THEN
      RAISE EXCEPTION 'Un réalisé remplace la ligne courante de la même semaine, et elle seule.'
        USING ERRCODE = 'MPZ08';
    END IF;
    SELECT count(*) INTO v_nombre FROM red_tresorerie_realises r
      WHERE r.dossier_id = NEW.dossier_id AND r.semaine_debut = NEW.semaine_debut;
    IF v_nombre >= 11 THEN
      RAISE EXCEPTION 'Au plus 10 corrections d''un même réalisé de semaine.' USING ERRCODE = 'MPZ11';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER red_tresorerie_realises_controle BEFORE INSERT ON red_tresorerie_realises
  FOR EACH ROW EXECUTE FUNCTION red_controler_realise();
CREATE TRIGGER red_tresorerie_realises_01_mission_ouverte BEFORE INSERT ON red_tresorerie_realises
  FOR EACH ROW EXECUTE FUNCTION red_controler_mission_ouverte();
CREATE TRIGGER red_tresorerie_realises_plafond BEFORE INSERT ON red_tresorerie_realises
  FOR EACH ROW EXECUTE FUNCTION red_controler_plafond('dossier_id', '1000', 'lignes de réalisé par dossier');
