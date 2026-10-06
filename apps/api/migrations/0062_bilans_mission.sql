-- Bilan de clôture d'une mission (cycle de vie : la clôture archive le bilan
-- de rentabilité et recueille un retour d'expérience). Snapshot IMMUABLE,
-- calculé par @missionpilot/engines à la clôture : écarts budget / réalisé en
-- jours et en montant, taux de réalisation, marge, version budgétaire
-- « atterrissage » (FIN-03). Les montants (bloc `finance`, `atterrissage`) ne
-- sont servis qu'avec « finance.lire » ; le bloc `jours` est lisible de tous
-- ceux qui voient la mission.
-- Seul le retour d'expérience (base de connaissances V2, SOC-12) se modifie,
-- par le directeur de la mission, jusqu'à 30 jours après la clôture.

CREATE TABLE bilans_mission (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  mission_id uuid NOT NULL,
  cloture_le timestamptz NOT NULL,
  date_cloture date NOT NULL CHECK (date_cloture BETWEEN '2000-01-01' AND '2100-12-31'),
  devise text NOT NULL CHECK (devise IN ('XOF', 'XAF', 'EUR', 'USD')),
  jours jsonb NOT NULL CHECK (jsonb_typeof(jours) = 'object'),
  finance jsonb NOT NULL CHECK (jsonb_typeof(finance) = 'object'),
  atterrissage jsonb NOT NULL CHECK (jsonb_typeof(atterrissage) = 'object'),
  retour_experience text CHECK (retour_experience IS NULL OR length(retour_experience) <= 10000),
  retour_modifie_par uuid,
  retour_modifie_le timestamptz,
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, mission_id),
  FOREIGN KEY (cabinet_id, mission_id) REFERENCES missions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, retour_modifie_par) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE bilans_mission ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON bilans_mission
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE UPDATE, DELETE ON bilans_mission FROM missionpilot_app;
GRANT UPDATE (retour_experience, retour_modifie_par, retour_modifie_le) ON bilans_mission
  TO missionpilot_app;

-- Snapshot figé ; retour d'expérience modifiable 30 jours après la clôture.
CREATE FUNCTION controler_bilan_mission() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Bilan de clôture : suppression refusée.' USING ERRCODE = 'MPE03';
    END IF;
    IF (NEW.id, NEW.cabinet_id, NEW.mission_id, NEW.cloture_le, NEW.date_cloture, NEW.devise,
        NEW.jours, NEW.finance, NEW.atterrissage, NEW.cree_par, NEW.cree_le)
       IS DISTINCT FROM
       (OLD.id, OLD.cabinet_id, OLD.mission_id, OLD.cloture_le, OLD.date_cloture, OLD.devise,
        OLD.jours, OLD.finance, OLD.atterrissage, OLD.cree_par, OLD.cree_le) THEN
      RAISE EXCEPTION 'Bilan de clôture : snapshot immuable.' USING ERRCODE = 'MPE03';
    END IF;
    IF now() > OLD.cloture_le + interval '30 days' THEN
      RAISE EXCEPTION 'Retour d''expérience : délai de 30 jours après la clôture dépassé.'
        USING ERRCODE = 'MPE04';
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER bilans_mission_controle BEFORE UPDATE OR DELETE ON bilans_mission
  FOR EACH ROW EXECUTE FUNCTION controler_bilan_mission();
