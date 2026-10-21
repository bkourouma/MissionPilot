-- Observatoire (CAP-04) : contributions d'un cabinet, SANS AUCUN identifiant de client ni texte
-- libre (secteur de la nomenclature fermée du moteur, taille, valeur au dixième), visibles du seul
-- cabinet qui les a versées (RLS `isolation`), jamais du portail (`portail_interdit`).
--
-- - Un versement n'est possible que si l'adhésion du cabinet est active (MQK22, déclencheur).
-- - Une contribution ne se modifie jamais (MQK23) ; le cabinet la retire (suppression :
--   minimisation), et un nouveau versement REMPLACE celui du mois en cours.
-- - Gel par mois civil (atténuation de la différence TEMPORELLE) : `periode` est imposée au mois
--   civil courant (UTC) par le déclencheur, et `obs_agregats` (0472) ne retient pour chaque
--   cabinet que son DERNIER versement d'un mois ANTÉRIEUR au mois courant. Un versement ou un
--   remplacement en cours de mois ne change donc les agrégats qu'au mois suivant, mêlé aux
--   versements de tous les autres cabinets du mois ; seuls le retrait d'adhésion et le retrait des
--   contributions agissent aussitôt (exigence : exclusion immédiate). Une ré-adhésion ne réactive
--   pas les contributions versées avant elle (0472) : il faut verser à nouveau.

CREATE FUNCTION obs_periode_courante() RETURNS date
  LANGUAGE sql STABLE
  AS $$ SELECT date_trunc('month', now() AT TIME ZONE 'UTC')::date $$;

CREATE TABLE obs_contributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  indicateur text NOT NULL CHECK (indicateur IN ('notation_score_global')),
  secteur text NOT NULL CHECK (secteur IN ('agriculture', 'industrie', 'btp', 'commerce',
                                            'services', 'numerique', 'finance', 'autres')),
  taille text NOT NULL CHECK (taille IN ('tpe', 'pme', 'eti', 'grande_entreprise')),
  valeur numeric(4, 1) NOT NULL CHECK (valeur BETWEEN 0 AND 100),
  periode date NOT NULL CHECK (periode = date_trunc('month', periode)::date),
  verse_par uuid NOT NULL,
  verse_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, verse_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX obs_contributions_cabinet_idx ON obs_contributions (cabinet_id, indicateur, periode);
CREATE INDEX obs_contributions_case_idx ON obs_contributions (indicateur, secteur, taille);
ALTER TABLE obs_contributions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON obs_contributions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON obs_contributions AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE ON obs_contributions FROM missionpilot_app;

CREATE FUNCTION controler_obs_contribution() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'UPDATE' THEN
      RAISE EXCEPTION 'Une contribution à l''observatoire ne se modifie pas.' USING ERRCODE = 'MQK23';
    END IF;
    IF NOT obs_adhesion_active(NEW.cabinet_id) THEN
      RAISE EXCEPTION 'Versement refusé : le cabinet n''adhère pas à l''observatoire.'
        USING ERRCODE = 'MQK22';
    END IF;
    NEW.periode := obs_periode_courante();
    NEW.verse_le := now();
    RETURN NEW;
  END $$;
CREATE TRIGGER obs_contributions_controle BEFORE INSERT OR UPDATE ON obs_contributions
  FOR EACH ROW EXECUTE FUNCTION controler_obs_contribution();
