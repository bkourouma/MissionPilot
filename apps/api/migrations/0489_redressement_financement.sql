-- Redressement : covenants bancaires financiers et plan de financement (RED-06, lot 2).
-- SQLSTATE : voir 0480 (MPZ01, MPZ03, MPZ05, MPZ10) ; MPZ15 et MPZ16 sont posés ici.
--
-- - red_covenants_versions  : une version de la liste des covenants du dossier, EN AJOUT SEUL ;
-- - red_covenants_lignes    : covenants d'une version (ratio de la liste fermée du moteur, plancher
--   ou plafond en points de base, prêteur facultatif, fréquence de test), EN AJOUT SEUL, écrits
--   dans la transaction de leur version ;
-- - red_financement_versions: un plan de financement (années ou semestres, 1 à 8 périodes à partir
--   d'un premier jour de mois), EN AJOUT SEUL ;
-- - red_financement_lignes  : emplois et ressources par période, EN AJOUT SEUL, écrits dans la
--   transaction de leur version.
-- Aucun résultat n'est stocké : l'évaluation des covenants (contre le dernier exercice accepté du
-- dossier client) et les totaux, soldes et couvertures du plan sont calculés à la lecture par les
-- moteurs. Un covenant « en défaut » est un constat arithmétique, jamais une qualification juridique.
-- Garanties : écritures refusées si le dossier est clos ou la mission clôturée (MPZ03, par
-- red_controler_mission_ouverte) ; versions consécutives par dossier (MPZ05) ; plafonds de volume
-- (MPZ10) ; MPZ15 : covenant incohérent (même ratio et même opérateur deux fois dans une version,
-- plancher au-dessus du plafond d'un même ratio) ; MPZ16 : ligne de plan incohérente (période au-delà
-- du nombre de périodes de sa version). Une ligne naît dans la transaction de sa version (MPZ01).
-- Montants en unités mineures, bornés à 10^13 comme 0485 ; les devises sont celles du dossier.

CREATE TABLE red_covenants_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  dossier_id uuid NOT NULL,
  version int NOT NULL CHECK (version >= 1),
  motif text CHECK (motif IS NULL OR length(motif) BETWEEN 1 AND 500),
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, dossier_id, id),
  UNIQUE (cabinet_id, dossier_id, version),
  FOREIGN KEY (cabinet_id, dossier_id) REFERENCES red_dossiers (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE red_covenants_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON red_covenants_versions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON red_covenants_versions AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON red_covenants_versions FROM missionpilot_app;
CREATE TRIGGER red_covenants_versions_ajout_seul BEFORE UPDATE OR DELETE ON red_covenants_versions
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_redressement();
CREATE TRIGGER red_covenants_versions_01_mission_ouverte BEFORE INSERT ON red_covenants_versions
  FOR EACH ROW EXECUTE FUNCTION red_controler_mission_ouverte();
CREATE TRIGGER red_covenants_versions_plafond BEFORE INSERT ON red_covenants_versions
  FOR EACH ROW EXECUTE FUNCTION red_controler_plafond('dossier_id', '100', 'versions de covenants par dossier');
CREATE TRIGGER red_covenants_versions_version BEFORE INSERT ON red_covenants_versions
  FOR EACH ROW EXECUTE FUNCTION red_controler_version('dossier_id');

CREATE TABLE red_covenants_lignes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  dossier_id uuid NOT NULL,
  version_id uuid NOT NULL,
  rang smallint NOT NULL CHECK (rang BETWEEN 1 AND 12),
  -- Liste fermée tirée des codes de ratio du moteur (ratios.ts).
  ratio text NOT NULL CHECK (ratio IN ('liquidite_generale', 'liquidite_reduite', 'liquidite_immediate',
    'autonomie_financiere', 'solvabilite_generale', 'endettement', 'couverture_charges_financieres')),
  operateur text NOT NULL CHECK (operateur IN ('min', 'max')),
  -- Points de base (10 000 = 1) ; peut être négatif.
  seuil_pb bigint NOT NULL CHECK (seuil_pb BETWEEN -100000000 AND 100000000),
  preteur text CHECK (preteur IS NULL OR length(preteur) BETWEEN 1 AND 120),
  frequence text NOT NULL CHECK (frequence IN ('trimestrielle', 'semestrielle', 'annuelle')),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, version_id, rang),
  FOREIGN KEY (cabinet_id, dossier_id) REFERENCES red_dossiers (cabinet_id, id),
  FOREIGN KEY (cabinet_id, dossier_id, version_id)
    REFERENCES red_covenants_versions (cabinet_id, dossier_id, id)
);
ALTER TABLE red_covenants_lignes ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON red_covenants_lignes
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON red_covenants_lignes AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON red_covenants_lignes FROM missionpilot_app;
CREATE TRIGGER red_covenants_lignes_ajout_seul BEFORE UPDATE OR DELETE ON red_covenants_lignes
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_redressement();

-- Une ligne naît dans la transaction de sa version (modèle red_controler_tresorerie_ligne, 0485) ;
-- cohérence : pas deux fois (ratio, opérateur) dans une version, et plancher <= plafond pour un ratio.
CREATE FUNCTION red_controler_covenant_ligne() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM red_covenants_versions v
                   WHERE v.id = NEW.version_id AND v.cree_le = now()) THEN
      RAISE EXCEPTION 'Les covenants naissent dans la transaction de leur version.'
        USING ERRCODE = 'MPZ01';
    END IF;
    IF EXISTS (SELECT 1 FROM red_covenants_lignes l
               WHERE l.version_id = NEW.version_id AND l.ratio = NEW.ratio
                 AND l.operateur = NEW.operateur) THEN
      RAISE EXCEPTION 'Un même ratio ne porte pas deux fois le même opérateur dans une version.'
        USING ERRCODE = 'MPZ15';
    END IF;
    IF EXISTS (SELECT 1 FROM red_covenants_lignes l
               WHERE l.version_id = NEW.version_id AND l.ratio = NEW.ratio
                 AND ((NEW.operateur = 'min' AND l.operateur = 'max' AND l.seuil_pb < NEW.seuil_pb)
                   OR (NEW.operateur = 'max' AND l.operateur = 'min' AND l.seuil_pb > NEW.seuil_pb))) THEN
      RAISE EXCEPTION 'Le plancher d''un ratio ne dépasse pas son plafond.' USING ERRCODE = 'MPZ15';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER red_covenants_lignes_controle BEFORE INSERT ON red_covenants_lignes
  FOR EACH ROW EXECUTE FUNCTION red_controler_covenant_ligne();
CREATE TRIGGER red_covenants_lignes_01_mission_ouverte BEFORE INSERT ON red_covenants_lignes
  FOR EACH ROW EXECUTE FUNCTION red_controler_mission_ouverte();
CREATE TRIGGER red_covenants_lignes_plafond BEFORE INSERT ON red_covenants_lignes
  FOR EACH ROW EXECUTE FUNCTION red_controler_plafond('version_id', '12', 'covenants par version');

CREATE TABLE red_financement_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  dossier_id uuid NOT NULL,
  version int NOT NULL CHECK (version >= 1),
  -- Premier jour du mois de la première période.
  date_debut date NOT NULL
    CHECK (extract(day FROM date_debut) = 1 AND date_debut BETWEEN '2000-01-01' AND '2100-12-31'),
  type_periode text NOT NULL CHECK (type_periode IN ('annee', 'semestre')),
  nombre_periodes smallint NOT NULL CHECK (nombre_periodes BETWEEN 1 AND 8),
  motif text CHECK (motif IS NULL OR length(motif) BETWEEN 1 AND 500),
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, dossier_id, id),
  UNIQUE (cabinet_id, dossier_id, version),
  FOREIGN KEY (cabinet_id, dossier_id) REFERENCES red_dossiers (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE red_financement_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON red_financement_versions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON red_financement_versions AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON red_financement_versions FROM missionpilot_app;
CREATE TRIGGER red_financement_versions_ajout_seul BEFORE UPDATE OR DELETE ON red_financement_versions
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_redressement();
CREATE TRIGGER red_financement_versions_01_mission_ouverte BEFORE INSERT ON red_financement_versions
  FOR EACH ROW EXECUTE FUNCTION red_controler_mission_ouverte();
CREATE TRIGGER red_financement_versions_plafond BEFORE INSERT ON red_financement_versions
  FOR EACH ROW EXECUTE FUNCTION red_controler_plafond('dossier_id', '100', 'versions du plan de financement par dossier');
CREATE TRIGGER red_financement_versions_version BEFORE INSERT ON red_financement_versions
  FOR EACH ROW EXECUTE FUNCTION red_controler_version('dossier_id');

CREATE TABLE red_financement_lignes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  dossier_id uuid NOT NULL,
  version_id uuid NOT NULL,
  rang smallint NOT NULL CHECK (rang BETWEEN 1 AND 200),
  periode smallint NOT NULL CHECK (periode BETWEEN 1 AND 8),
  sens text NOT NULL CHECK (sens IN ('emploi', 'ressource')),
  nature text NOT NULL,
  libelle text CHECK (libelle IS NULL OR length(libelle) BETWEEN 1 AND 200),
  montant bigint NOT NULL CHECK (montant BETWEEN 1 AND 10000000000000),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, version_id, rang),
  CHECK (CASE sens
    WHEN 'emploi' THEN nature IN ('remboursement_dettes_accords', 'besoin_fonds_roulement',
                                  'investissements', 'charges_restructuration')
    ELSE nature IN ('apport_associes', 'nouveaux_concours_bancaires', 'cessions_actifs',
                    'report_echeances_obtenu', 'autofinancement') END),
  FOREIGN KEY (cabinet_id, dossier_id) REFERENCES red_dossiers (cabinet_id, id),
  FOREIGN KEY (cabinet_id, dossier_id, version_id)
    REFERENCES red_financement_versions (cabinet_id, dossier_id, id)
);
ALTER TABLE red_financement_lignes ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON red_financement_lignes
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON red_financement_lignes AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON red_financement_lignes FROM missionpilot_app;
CREATE TRIGGER red_financement_lignes_ajout_seul BEFORE UPDATE OR DELETE ON red_financement_lignes
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_redressement();

-- Une ligne naît dans la transaction de sa version ; sa période appartient au plan de la version.
CREATE FUNCTION red_controler_financement_ligne() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_periodes smallint;
  BEGIN
    SELECT v.nombre_periodes INTO v_periodes FROM red_financement_versions v
      WHERE v.id = NEW.version_id AND v.cree_le = now();
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Les lignes du plan de financement naissent dans la transaction de leur version.'
        USING ERRCODE = 'MPZ01';
    END IF;
    IF NEW.periode > v_periodes THEN
      RAISE EXCEPTION 'La période dépasse le nombre de périodes du plan de financement.'
        USING ERRCODE = 'MPZ16';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER red_financement_lignes_controle BEFORE INSERT ON red_financement_lignes
  FOR EACH ROW EXECUTE FUNCTION red_controler_financement_ligne();
CREATE TRIGGER red_financement_lignes_01_mission_ouverte BEFORE INSERT ON red_financement_lignes
  FOR EACH ROW EXECUTE FUNCTION red_controler_mission_ouverte();
CREATE TRIGGER red_financement_lignes_plafond BEFORE INSERT ON red_financement_lignes
  FOR EACH ROW EXECUTE FUNCTION red_controler_plafond('version_id', '200', 'lignes par plan de financement');
