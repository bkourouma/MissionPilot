-- Missions (MIS-07, MIS-09, MIS-10, MIS-12) et équipe de mission.
-- Cycle de vie : opportunite → proposition → signee → en_cours → a_cloturer → cloturee.

CREATE TABLE missions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  intitule text NOT NULL CHECK (length(intitule) BETWEEN 1 AND 200),
  client_id uuid NOT NULL,
  type_mission_id uuid,
  opportunite_id uuid,
  proposition_id uuid,
  mission_source_id uuid,
  directeur_id uuid,
  chef_id uuid,
  date_debut date,
  date_fin date,
  devise text NOT NULL DEFAULT 'XOF' CHECK (devise IN ('XOF', 'XAF', 'EUR', 'USD')),
  mode_facturation text NOT NULL
    CHECK (mode_facturation IN ('forfait', 'regie', 'forfait_variable', 'abonnement')),
  statut text NOT NULL DEFAULT 'proposition'
    CHECK (statut IN ('opportunite', 'proposition', 'signee', 'en_cours', 'a_cloturer', 'cloturee')),
  -- Axes analytiques (MIS-12).
  activite text CHECK (activite IS NULL OR length(activite) <= 120),
  secteur text CHECK (secteur IS NULL OR length(secteur) <= 120),
  bureau text CHECK (bureau IS NULL OR length(bureau) <= 120),
  -- Signature de la lettre de mission (MIS-07) et taux de change figé (FIN-04) :
  -- 1 unité de `devise` = `taux_change` unités de `devise_reference` (devise du cabinet).
  date_signature date,
  signee_par uuid,
  taux_change numeric(20, 10) CHECK (taux_change > 0),
  devise_reference text CHECK (devise_reference IN ('XOF', 'XAF', 'EUR', 'USD')),
  cloturee_le timestamptz,
  cloturee_par uuid,
  cree_par uuid,
  cree_le timestamptz NOT NULL DEFAULT now(),
  modifie_le timestamptz NOT NULL DEFAULT now(),
  CHECK (date_fin IS NULL OR date_debut IS NULL OR date_fin >= date_debut),
  CHECK ((statut IN ('opportunite', 'proposition')) = (date_signature IS NULL)),
  CHECK (date_signature IS NULL
         OR (taux_change IS NOT NULL AND devise_reference IS NOT NULL AND signee_par IS NOT NULL)),
  CHECK ((statut = 'cloturee') = (cloturee_le IS NOT NULL)),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, client_id) REFERENCES clients (cabinet_id, id),
  FOREIGN KEY (cabinet_id, type_mission_id) REFERENCES types_mission (cabinet_id, id),
  FOREIGN KEY (cabinet_id, opportunite_id) REFERENCES opportunites (cabinet_id, id),
  FOREIGN KEY (cabinet_id, proposition_id) REFERENCES propositions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, mission_source_id) REFERENCES missions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, directeur_id) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, chef_id) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, signee_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cloturee_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
-- Une proposition acceptée donne au plus une mission.
CREATE UNIQUE INDEX missions_proposition_uniq ON missions (cabinet_id, proposition_id)
  WHERE proposition_id IS NOT NULL;
CREATE INDEX missions_tri_idx ON missions (cabinet_id, statut, lower(intitule), id);
CREATE INDEX missions_chef_idx ON missions (cabinet_id, chef_id);
CREATE INDEX missions_directeur_idx ON missions (cabinet_id, directeur_id);
ALTER TABLE missions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON missions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
-- Une mission ne se supprime pas : elle porte budget, temps et factures.
REVOKE DELETE ON missions FROM missionpilot_app;

-- Signature figée (MIS-07, FIN-04) : date, signataire, devise et taux de change
-- ne changent plus une fois la lettre de mission signée.
CREATE FUNCTION refuser_modification_signature() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF OLD.date_signature IS NOT NULL AND
       (NEW.date_signature, NEW.signee_par, NEW.devise, NEW.taux_change, NEW.devise_reference)
         IS DISTINCT FROM
       (OLD.date_signature, OLD.signee_par, OLD.devise, OLD.taux_change, OLD.devise_reference) THEN
      RAISE EXCEPTION 'Mission signée : signature, devise et taux de change sont figés.'
        USING ERRCODE = 'MPF01';
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER missions_signature_figee BEFORE UPDATE ON missions
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_signature();

-- Membres de l'équipe de mission (en attendant les affectations PLN-04) :
-- un membre voit la mission même s'il n'a pas le droit de voir tout le cabinet.
CREATE TABLE mission_equipe (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  mission_id uuid NOT NULL,
  utilisateur_id uuid NOT NULL,
  ajoute_par uuid,
  ajoute_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mission_id, utilisateur_id),
  FOREIGN KEY (cabinet_id, mission_id) REFERENCES missions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, utilisateur_id) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, ajoute_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX mission_equipe_utilisateur_idx ON mission_equipe (cabinet_id, utilisateur_id);
ALTER TABLE mission_equipe ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON mission_equipe
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
