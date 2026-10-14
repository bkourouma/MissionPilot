-- Redressement : registre des créanciers, créances, négociations et échéanciers (RED-12).
-- SQLSTATE : voir 0480.
--
-- - red_creanciers             : registre (identité figée ; nom, garantie, référence, actif vivants,
--   journalisés) ;
-- - red_creances               : versions de la créance courante d'un créancier, EN AJOUT SEUL ;
-- - red_negociation_evenements : fil de la négociation, EN AJOUT SEUL ; un accord n'est en vigueur
--   que tant qu'aucune rupture ne le référence ; un créancier n'a jamais deux accords en vigueur ;
-- - red_echeances              : échéancier convenu d'un accord, écrit dans la transaction de
--   l'accord, EN AJOUT SEUL. « Somme des échéances = montant convenu » n'est PAS vérifiée en SQL
--   (pas de calcul en base) : elle l'est par le moteur (`validerEcheancierAccord`) avant l'écriture.
-- La situation d'un créancier (reste dû, échu, avancement) est recalculée à chaque lecture.

CREATE TABLE red_creanciers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  dossier_id uuid NOT NULL,
  nom text NOT NULL CHECK (length(btrim(nom)) BETWEEN 1 AND 200),
  categorie text NOT NULL
    CHECK (categorie IN ('fournisseur', 'banque', 'fiscal', 'social', 'bailleur', 'autre')),
  garanti boolean NOT NULL DEFAULT false,
  reference text CHECK (reference IS NULL OR length(reference) BETWEEN 1 AND 120),
  actif boolean NOT NULL DEFAULT true,
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  modifie_par uuid,
  modifie_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, dossier_id, id),
  FOREIGN KEY (cabinet_id, dossier_id) REFERENCES red_dossiers (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, modifie_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE UNIQUE INDEX red_creanciers_nom_uniq
  ON red_creanciers (cabinet_id, dossier_id, lower(nom), categorie);
CREATE INDEX red_creanciers_dossier_idx ON red_creanciers (cabinet_id, dossier_id, id);
ALTER TABLE red_creanciers ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON red_creanciers
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON red_creanciers AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE DELETE ON red_creanciers FROM missionpilot_app;

CREATE FUNCTION red_controler_creancier() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'UPDATE' THEN
      IF (NEW.cabinet_id, NEW.dossier_id, NEW.categorie, NEW.cree_par, NEW.cree_le)
         IS DISTINCT FROM (OLD.cabinet_id, OLD.dossier_id, OLD.categorie, OLD.cree_par, OLD.cree_le) THEN
        RAISE EXCEPTION 'Dossier, catégorie et création d''un créancier sont figés.'
          USING ERRCODE = 'MPZ04';
      END IF;
    END IF;
    NEW.modifie_le := now();
    RETURN NEW;
  END $$;
CREATE TRIGGER red_creanciers_controle BEFORE INSERT OR UPDATE ON red_creanciers
  FOR EACH ROW EXECUTE FUNCTION red_controler_creancier();
CREATE TRIGGER red_creanciers_01_mission_ouverte BEFORE INSERT OR UPDATE ON red_creanciers
  FOR EACH ROW EXECUTE FUNCTION red_controler_mission_ouverte();
CREATE TRIGGER red_creanciers_plafond BEFORE INSERT ON red_creanciers
  FOR EACH ROW EXECUTE FUNCTION red_controler_plafond('dossier_id', '200', 'créanciers par dossier');

CREATE TABLE red_creances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  dossier_id uuid NOT NULL,
  creancier_id uuid NOT NULL,
  version int NOT NULL CHECK (version >= 1),
  principal bigint NOT NULL CHECK (principal BETWEEN 0 AND 10000000000000),
  interets bigint NOT NULL DEFAULT 0 CHECK (interets BETWEEN 0 AND 10000000000000),
  date_arrete date NOT NULL CHECK (date_arrete BETWEEN '2000-01-01' AND '2100-12-31'),
  echeance_initiale date
    CHECK (echeance_initiale IS NULL OR echeance_initiale BETWEEN '2000-01-01' AND '2100-12-31'),
  nature text CHECK (nature IS NULL OR length(nature) BETWEEN 1 AND 200),
  commentaire text CHECK (commentaire IS NULL OR length(commentaire) BETWEEN 1 AND 1000),
  saisi_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, creancier_id, version),
  FOREIGN KEY (cabinet_id, dossier_id) REFERENCES red_dossiers (cabinet_id, id),
  FOREIGN KEY (cabinet_id, dossier_id, creancier_id)
    REFERENCES red_creanciers (cabinet_id, dossier_id, id),
  FOREIGN KEY (cabinet_id, saisi_par) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE red_creances ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON red_creances
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON red_creances AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON red_creances FROM missionpilot_app;
CREATE TRIGGER red_creances_ajout_seul BEFORE UPDATE OR DELETE ON red_creances
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_redressement();
CREATE TRIGGER red_creances_01_mission_ouverte BEFORE INSERT ON red_creances
  FOR EACH ROW EXECUTE FUNCTION red_controler_mission_ouverte();
CREATE TRIGGER red_creances_plafond BEFORE INSERT ON red_creances
  FOR EACH ROW EXECUTE FUNCTION red_controler_plafond('creancier_id', '100', 'versions de créance par créancier');
CREATE TRIGGER red_creances_version BEFORE INSERT ON red_creances
  FOR EACH ROW EXECUTE FUNCTION red_controler_version('creancier_id');

CREATE TABLE red_negociation_evenements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  dossier_id uuid NOT NULL,
  creancier_id uuid NOT NULL,
  type text NOT NULL CHECK (type IN
    ('ouverture', 'proposition', 'contre_proposition', 'accord', 'rupture', 'paiement',
     'annulation_paiement', 'note')),
  date_evenement date NOT NULL CHECK (date_evenement BETWEEN '2000-01-01' AND '2100-12-31'),
  -- Montant proposé, convenu (accord) ou payé (paiement).
  montant bigint CHECK (montant BETWEEN 0 AND 10000000000000),
  -- Garanties, intérêts, clause de déchéance, motif de rupture : JAMAIS journalisé.
  conditions text CHECK (conditions IS NULL OR length(conditions) BETWEEN 1 AND 2000),
  accord_id uuid,
  -- Paiement rattaché à une échéance de l'accord.
  echeance_rang smallint CHECK (echeance_rang BETWEEN 1 AND 60),
  -- Annulation d'un paiement saisi à tort ou en double : l'événement d'annulation référence le paiement
  -- annulé (l'historique reste en ajout seul ; le total payé l'exclut). Un paiement s'annule une fois.
  paiement_annule_id uuid,
  auteur_id uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, dossier_id, id),
  UNIQUE (cabinet_id, paiement_annule_id),
  CHECK ((type = 'annulation_paiement') = (paiement_annule_id IS NOT NULL)),
  CHECK (CASE type
    WHEN 'accord' THEN coalesce(montant, 0) > 0 AND accord_id IS NULL AND echeance_rang IS NULL
    WHEN 'paiement' THEN coalesce(montant, 0) > 0 AND accord_id IS NOT NULL
    WHEN 'rupture' THEN accord_id IS NOT NULL AND montant IS NULL AND echeance_rang IS NULL
    WHEN 'annulation_paiement' THEN accord_id IS NOT NULL AND montant IS NULL AND echeance_rang IS NULL
    ELSE accord_id IS NULL AND echeance_rang IS NULL END),
  FOREIGN KEY (cabinet_id, dossier_id) REFERENCES red_dossiers (cabinet_id, id),
  FOREIGN KEY (cabinet_id, dossier_id, creancier_id)
    REFERENCES red_creanciers (cabinet_id, dossier_id, id),
  FOREIGN KEY (cabinet_id, dossier_id, accord_id)
    REFERENCES red_negociation_evenements (cabinet_id, dossier_id, id),
  FOREIGN KEY (cabinet_id, dossier_id, paiement_annule_id)
    REFERENCES red_negociation_evenements (cabinet_id, dossier_id, id),
  FOREIGN KEY (cabinet_id, auteur_id) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX red_negociation_evenements_creancier_idx
  ON red_negociation_evenements (cabinet_id, creancier_id, cree_le, id);
CREATE INDEX red_negociation_evenements_accord_idx
  ON red_negociation_evenements (cabinet_id, accord_id) WHERE accord_id IS NOT NULL;
ALTER TABLE red_negociation_evenements ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON red_negociation_evenements
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON red_negociation_evenements AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON red_negociation_evenements FROM missionpilot_app;
CREATE TRIGGER red_negociation_evenements_ajout_seul BEFORE UPDATE OR DELETE ON red_negociation_evenements
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_redressement();

-- Cohérence de la négociation (fonction d'invocateur : la RLS du cabinet s'applique aux lectures).
CREATE FUNCTION red_controler_evenement_negociation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_accord red_negociation_evenements%ROWTYPE;
    v_paiement red_negociation_evenements%ROWTYPE;
  BEGIN
    IF NEW.type = 'accord' THEN
      -- Un seul accord en vigueur (aucune rupture ne le référence) par créancier.
      IF EXISTS (SELECT 1 FROM red_negociation_evenements a
                 WHERE a.creancier_id = NEW.creancier_id AND a.type = 'accord'
                   AND NOT EXISTS (SELECT 1 FROM red_negociation_evenements r
                                   WHERE r.type = 'rupture' AND r.accord_id = a.id)) THEN
        RAISE EXCEPTION 'Un accord est déjà en vigueur pour ce créancier.' USING ERRCODE = 'MPZ09';
      END IF;
    ELSIF NEW.type IN ('paiement', 'rupture') THEN
      SELECT * INTO v_accord FROM red_negociation_evenements a WHERE a.id = NEW.accord_id;
      IF NOT FOUND OR v_accord.type <> 'accord' OR v_accord.creancier_id <> NEW.creancier_id THEN
        RAISE EXCEPTION 'L''accord visé n''est pas un accord de ce créancier.' USING ERRCODE = 'MPZ09';
      END IF;
      IF EXISTS (SELECT 1 FROM red_negociation_evenements r
                 WHERE r.type = 'rupture' AND r.accord_id = NEW.accord_id) THEN
        RAISE EXCEPTION 'L''accord visé est rompu.' USING ERRCODE = 'MPZ09';
      END IF;
      IF NEW.type = 'paiement' AND NEW.echeance_rang IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM red_echeances e
           WHERE e.accord_id = NEW.accord_id AND e.rang = NEW.echeance_rang) THEN
        RAISE EXCEPTION 'L''échéance visée n''existe pas dans l''accord.' USING ERRCODE = 'MPZ09';
      END IF;
    ELSIF NEW.type = 'annulation_paiement' THEN
      -- Un paiement du même accord et du même créancier, pas déjà annulé (l''unicité le garantit aussi).
      SELECT * INTO v_paiement FROM red_negociation_evenements p WHERE p.id = NEW.paiement_annule_id;
      IF NOT FOUND OR v_paiement.type <> 'paiement' OR v_paiement.creancier_id <> NEW.creancier_id
         OR v_paiement.accord_id IS DISTINCT FROM NEW.accord_id THEN
        RAISE EXCEPTION 'Le paiement annulé n''est pas un paiement de cet accord.' USING ERRCODE = 'MPZ09';
      END IF;
      IF EXISTS (SELECT 1 FROM red_negociation_evenements x
                 WHERE x.type = 'annulation_paiement' AND x.paiement_annule_id = NEW.paiement_annule_id) THEN
        RAISE EXCEPTION 'Ce paiement est déjà annulé.' USING ERRCODE = 'MPZ09';
      END IF;
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER red_negociation_evenements_controle BEFORE INSERT ON red_negociation_evenements
  FOR EACH ROW EXECUTE FUNCTION red_controler_evenement_negociation();
CREATE TRIGGER red_negociation_evenements_01_mission_ouverte BEFORE INSERT ON red_negociation_evenements
  FOR EACH ROW EXECUTE FUNCTION red_controler_mission_ouverte();
CREATE TRIGGER red_negociation_evenements_plafond BEFORE INSERT ON red_negociation_evenements
  FOR EACH ROW EXECUTE FUNCTION red_controler_plafond('creancier_id', '300', 'événements de négociation par créancier');

CREATE TABLE red_echeances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  dossier_id uuid NOT NULL,
  creancier_id uuid NOT NULL,
  accord_id uuid NOT NULL,
  rang smallint NOT NULL CHECK (rang BETWEEN 1 AND 60),
  date_echeance date NOT NULL CHECK (date_echeance BETWEEN '2000-01-01' AND '2100-12-31'),
  montant bigint NOT NULL CHECK (montant BETWEEN 1 AND 10000000000000),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, dossier_id, id),
  UNIQUE (cabinet_id, accord_id, rang),
  FOREIGN KEY (cabinet_id, dossier_id) REFERENCES red_dossiers (cabinet_id, id),
  FOREIGN KEY (cabinet_id, dossier_id, creancier_id)
    REFERENCES red_creanciers (cabinet_id, dossier_id, id),
  FOREIGN KEY (cabinet_id, dossier_id, accord_id)
    REFERENCES red_negociation_evenements (cabinet_id, dossier_id, id)
);
ALTER TABLE red_echeances ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON red_echeances
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON red_echeances AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON red_echeances FROM missionpilot_app;
CREATE TRIGGER red_echeances_ajout_seul BEFORE UPDATE OR DELETE ON red_echeances
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_redressement();

-- L'échéance naît dans la transaction de son accord (même créancier, type « accord »).
CREATE FUNCTION red_controler_echeance() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM red_negociation_evenements a
                   WHERE a.id = NEW.accord_id AND a.type = 'accord'
                     AND a.creancier_id = NEW.creancier_id AND a.cree_le = now()) THEN
      RAISE EXCEPTION 'Une échéance naît dans la transaction de l''accord de son créancier.'
        USING ERRCODE = 'MPZ09';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER red_echeances_controle BEFORE INSERT ON red_echeances
  FOR EACH ROW EXECUTE FUNCTION red_controler_echeance();
CREATE TRIGGER red_echeances_01_mission_ouverte BEFORE INSERT ON red_echeances
  FOR EACH ROW EXECUTE FUNCTION red_controler_mission_ouverte();
CREATE TRIGGER red_echeances_plafond BEFORE INSERT ON red_echeances
  FOR EACH ROW EXECUTE FUNCTION red_controler_plafond('accord_id', '60', 'échéances par accord');
