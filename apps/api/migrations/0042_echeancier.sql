-- Échéancier de facturation (FIN-06, MIS-10) : acomptes, jalons, pourcentage
-- d'avancement, régie sur temps validés, abonnement, part variable.
-- Statut : prevue → a_facturer → facturee (à l'émission de la facture) ;
-- facturee → a_facturer seulement quand un avoir annule la facture.
-- Montants en unités mineures de la devise de la mission, calculés par
-- @missionpilot/engines (jamais en SQL).

CREATE TABLE echeances_facturation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  mission_id uuid NOT NULL,
  ordre int NOT NULL DEFAULT 0 CHECK (ordre BETWEEN 0 AND 100000),
  type text NOT NULL
    CHECK (type IN ('acompte', 'jalon', 'avancement', 'regie', 'abonnement', 'part_variable')),
  libelle text NOT NULL CHECK (length(libelle) BETWEEN 1 AND 200),
  montant bigint NOT NULL CHECK (montant >= 0),
  -- Pourcentage du budget signé saisi (le montant en est déduit par le moteur).
  pourcentage numeric(9, 4) CHECK (pourcentage IS NULL OR (pourcentage > 0 AND pourcentage <= 100)),
  devise text NOT NULL CHECK (devise IN ('XOF', 'XAF', 'EUR', 'USD')),
  date_prevue date NOT NULL CHECK (date_prevue BETWEEN '2000-01-01' AND '2100-12-31'),
  jalon_id uuid,
  statut text NOT NULL DEFAULT 'prevue' CHECK (statut IN ('prevue', 'a_facturer', 'facturee')),
  -- Régie : période des temps validés rattachés.
  periode_debut date,
  periode_fin date,
  cree_par uuid,
  cree_le timestamptz NOT NULL DEFAULT now(),
  modifie_le timestamptz NOT NULL DEFAULT now(),
  CHECK ((type = 'regie') = (periode_debut IS NOT NULL AND periode_fin IS NOT NULL)),
  CHECK (periode_fin IS NULL OR periode_fin >= periode_debut),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, mission_id, id),
  FOREIGN KEY (cabinet_id, mission_id) REFERENCES missions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, mission_id, jalon_id)
    REFERENCES mission_jalons (cabinet_id, mission_id, id) ON DELETE SET NULL (jalon_id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX echeances_facturation_mission_idx
  ON echeances_facturation (cabinet_id, mission_id, date_prevue, ordre);
ALTER TABLE echeances_facturation ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON echeances_facturation
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());

-- Une échéance facturée ne change plus, sauf son retour « à facturer » quand
-- la facture est annulée par un avoir ; elle ne se supprime pas.
CREATE FUNCTION controler_echeance_facturation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v echeances_facturation%ROWTYPE;
  BEGIN
    IF TG_OP = 'DELETE' THEN
      IF OLD.statut = 'facturee' THEN
        RAISE EXCEPTION 'Échéance facturée : suppression refusée.' USING ERRCODE = 'MPB03';
      END IF;
      RETURN OLD;
    END IF;
    IF (NEW.cabinet_id, NEW.mission_id, NEW.type, NEW.devise, NEW.cree_le)
       IS DISTINCT FROM (OLD.cabinet_id, OLD.mission_id, OLD.type, OLD.devise, OLD.cree_le) THEN
      RAISE EXCEPTION 'Identité d''une échéance figée.' USING ERRCODE = 'MPB03';
    END IF;
    IF OLD.statut = 'facturee' THEN
      v := NEW;
      v.statut := OLD.statut;
      v.modifie_le := OLD.modifie_le;
      IF NEW.statut NOT IN ('facturee', 'a_facturer') OR ROW(v.*) IS DISTINCT FROM ROW(OLD.*) THEN
        RAISE EXCEPTION 'Échéance facturée : immuable.' USING ERRCODE = 'MPB03';
      END IF;
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER echeances_facturation_controle BEFORE UPDATE OR DELETE ON echeances_facturation
  FOR EACH ROW EXECUTE FUNCTION controler_echeance_facturation();

-- Marquage « facturé » des temps validés (régie) sans toucher aux lignes de
-- temps, immuables après validation : table de liaison. Une ligne validée (ou
-- une correction validée) appartient à une seule échéance de régie.
ALTER TABLE lignes_temps ADD CONSTRAINT lignes_temps_cabinet_id_uniq UNIQUE (cabinet_id, id);

CREATE TABLE echeance_temps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  mission_id uuid NOT NULL,
  echeance_id uuid NOT NULL,
  ligne_temps_id uuid,
  correction_id uuid,
  -- Valeur rattachée (centièmes de jour, négative pour une correction à la
  -- baisse) et taux journalier appliqué : trace du calcul de l'échéance.
  centiemes int NOT NULL CHECK (centiemes BETWEEN -10000 AND 10000 AND centiemes <> 0),
  taux_journalier bigint NOT NULL CHECK (taux_journalier >= 0),
  CHECK ((ligne_temps_id IS NULL) <> (correction_id IS NULL)),
  UNIQUE (ligne_temps_id),
  UNIQUE (correction_id),
  FOREIGN KEY (cabinet_id, mission_id, echeance_id)
    REFERENCES echeances_facturation (cabinet_id, mission_id, id) ON DELETE CASCADE,
  FOREIGN KEY (cabinet_id, ligne_temps_id) REFERENCES lignes_temps (cabinet_id, id),
  FOREIGN KEY (cabinet_id, correction_id) REFERENCES corrections_temps (cabinet_id, id)
);
CREATE INDEX echeance_temps_echeance_idx ON echeance_temps (echeance_id);
ALTER TABLE echeance_temps ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON echeance_temps
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE UPDATE ON echeance_temps FROM missionpilot_app;
