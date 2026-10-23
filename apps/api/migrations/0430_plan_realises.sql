-- Plan vivant (PLA-18, PRD complémentaire §11.3) : réalisés trimestriels.
--
-- `plan_realises` enregistre, par exercice et par trimestre (1 à 4), le chiffre
-- d'affaires, l'excédent brut d'exploitation (EBE), et, facultativement, le
-- résultat net et la trésorerie de fin de trimestre, en montants ENTIERS de la
-- devise du plan. La table est en AJOUT SEUL VERSIONNÉ : corriger un réalisé
-- insère une version plus haute (la courante est la plus haute), l'ancienne
-- reste lisible. Le plan VALIDÉ n'est jamais modifié : cette table ne
-- référence ni version du modèle, ni élément du plan, hors le plan lui-même.
--
-- Les trimestres se saisissent dans l'ordre, sans trou : la 1re version du
-- trimestre t (t > 1) exige un trimestre t - 1 déjà saisi pour le même
-- exercice (déclencheur, MQL18). Aucune suppression n'existant, aucun trou ne
-- peut apparaître ensuite.
--
-- Volume borné : au plus 50 versions par trimestre et 1000 par plan (MQL17).
--
-- Table à RLS : politique `isolation` (cabinet) et politique RESTRICTIVE
-- `portail_interdit` (états financiers du client : jamais au portail).
--
-- SQLSTATE (préfixe MQL ; plage MQL15 à MQL24 du plan vivant, migrations 0430 et 0431) :
--   MQL15  réalisé en ajout seul (modification ou suppression refusée) ;
--   MQL16  numéro de version non séquentiel ;
--   MQL17  plafond de versions (50 par trimestre, 1000 par plan) ;
--   MQL18  trimestre saisi avant le précédent (trimestres consécutifs) ;
--   MQL19  re-prévision en ajout seul (modification ou suppression refusée) ;
--   MQL20  version du modèle d'un autre plan que la re-prévision ;
--   MQL21  version du modèle non validée ;
--   MQL22  numéro de version de re-prévision non séquentiel ;
--   MQL23  plafond de 40 re-prévisions par exercice ;
--   MQL24  re-prévision incohérente avec ses entrées figées ou son résultat.

CREATE TABLE plan_realises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  plan_id uuid NOT NULL,
  exercice integer NOT NULL CHECK (exercice BETWEEN 2000 AND 2100),
  trimestre integer NOT NULL CHECK (trimestre BETWEEN 1 AND 4),
  version integer NOT NULL CHECK (version BETWEEN 1 AND 50),
  chiffre_affaires bigint NOT NULL
    CHECK (chiffre_affaires BETWEEN 0 AND 9007199254740991),
  ebe bigint NOT NULL CHECK (ebe BETWEEN -9007199254740991 AND 9007199254740991),
  resultat_net bigint CHECK (resultat_net IS NULL
    OR resultat_net BETWEEN -9007199254740991 AND 9007199254740991),
  tresorerie_fin bigint CHECK (tresorerie_fin IS NULL
    OR tresorerie_fin BETWEEN -9007199254740991 AND 9007199254740991),
  commentaire text CHECK (commentaire IS NULL OR (length(commentaire) <= 1000
    AND commentaire !~ '[[:cntrl:]]')),
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (plan_id, exercice, trimestre, version),
  FOREIGN KEY (cabinet_id, plan_id) REFERENCES plans_strategiques (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX plan_realises_plan_idx
  ON plan_realises (cabinet_id, plan_id, exercice, trimestre, version DESC);
ALTER TABLE plan_realises ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON plan_realises
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON plan_realises AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON plan_realises FROM missionpilot_app;

CREATE FUNCTION refuser_modification_realise() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    RAISE EXCEPTION 'Un réalisé enregistré ne se modifie ni ne se supprime : saisir une nouvelle version.'
      USING ERRCODE = 'MQL15';
  END $$;
CREATE TRIGGER plan_realises_ajout_seul
  BEFORE UPDATE OR DELETE ON plan_realises
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_realise();

/*
 * Numérotation continue des versions d'un trimestre, plafonds, trimestres
 * consécutifs. L'API verrouille le plan (FOR UPDATE) avant d'écrire : les
 * décomptes ne se croisent pas.
 */
CREATE FUNCTION controler_plan_realise() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_max integer;
  BEGIN
    SELECT max(version) INTO v_max FROM plan_realises
      WHERE plan_id = NEW.plan_id AND exercice = NEW.exercice AND trimestre = NEW.trimestre;
    IF NEW.version IS DISTINCT FROM coalesce(v_max, 0) + 1 THEN
      RAISE EXCEPTION 'Numéro de version du réalisé non séquentiel.' USING ERRCODE = 'MQL16';
    END IF;
    IF NEW.version > 50
       OR (SELECT count(*) FROM plan_realises WHERE plan_id = NEW.plan_id) >= 1000 THEN
      RAISE EXCEPTION 'Plafond de versions de réalisés atteint (50 par trimestre, 1000 par plan).'
        USING ERRCODE = 'MQL17';
    END IF;
    IF NEW.version = 1 AND NEW.trimestre > 1 AND NOT EXISTS (
      SELECT 1 FROM plan_realises
      WHERE plan_id = NEW.plan_id AND exercice = NEW.exercice AND trimestre = NEW.trimestre - 1
    ) THEN
      RAISE EXCEPTION 'Les trimestres se saisissent dans l''ordre, sans trou.'
        USING ERRCODE = 'MQL18';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER plan_realises_controle BEFORE INSERT ON plan_realises
  FOR EACH ROW EXECUTE FUNCTION controler_plan_realise();
