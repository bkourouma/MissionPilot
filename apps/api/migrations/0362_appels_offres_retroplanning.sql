-- Rétro-planning de réponse à un appel d'offres (AO-08), lot AO-A.
--
-- Étapes datées à rebours de la date limite par le moteur (packages/engines/src/appels-offres,
-- `retroPlanning`) ; une étape peut être confiée à un collègue par une TÂCHE ASSIGNÉE existante
-- (`taches_collaboration`, SOC-08, sans entité liée) dont l'identifiant est gardé ici. Les
-- alertes avant la date limite sont CALCULÉES à la lecture (`alertesAppelsOffres`), jamais
-- stockées : la route d'alertes et le brief quotidien les lisent.
--
-- SQLSTATE (lettre A, 0360) : MPA01 identité d'étape figée, tâche liée une seule fois ;
-- MPA06 rétro-planning figé hors préparation de la réponse.

CREATE TABLE ao_retroplanning_etapes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  ao_id uuid NOT NULL,
  ordre int NOT NULL CHECK (ordre BETWEEN 1 AND 50),
  code text NOT NULL CHECK (code ~ '^[a-z0-9_]{1,40}$'),
  libelle text NOT NULL CHECK (length(libelle) BETWEEN 1 AND 200),
  date_prevue date NOT NULL CHECK (date_prevue BETWEEN '2000-01-01' AND '2100-12-31'),
  responsable_id uuid,
  faite boolean NOT NULL DEFAULT false,
  faite_le timestamptz,
  tache_id uuid,
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  modifie_par uuid NOT NULL,
  modifie_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, ao_id, code),
  CHECK (faite = (faite_le IS NOT NULL)),
  FOREIGN KEY (cabinet_id, ao_id) REFERENCES appels_offres (cabinet_id, id),
  FOREIGN KEY (cabinet_id, responsable_id) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, tache_id) REFERENCES taches_collaboration (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, modifie_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX ao_retroplanning_ao_idx ON ao_retroplanning_etapes (cabinet_id, ao_id, ordre);
ALTER TABLE ao_retroplanning_etapes ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON ao_retroplanning_etapes
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON ao_retroplanning_etapes AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE DELETE ON ao_retroplanning_etapes FROM missionpilot_app;
CREATE TRIGGER ao_retroplanning_responsable_sans_portail
  BEFORE INSERT OR UPDATE OF responsable_id ON ao_retroplanning_etapes
  FOR EACH ROW EXECUTE FUNCTION refuser_utilisateur_portail('responsable_id');

CREATE FUNCTION controler_etape_ao() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Une étape de rétro-planning ne se supprime pas.' USING ERRCODE = 'MPA01';
    END IF;
    IF TG_OP = 'UPDATE' AND (
         (NEW.cabinet_id, NEW.ao_id, NEW.ordre, NEW.code, NEW.libelle, NEW.cree_par, NEW.cree_le)
         IS DISTINCT FROM
         (OLD.cabinet_id, OLD.ao_id, OLD.ordre, OLD.code, OLD.libelle, OLD.cree_par, OLD.cree_le)
         OR (OLD.tache_id IS NOT NULL AND NEW.tache_id IS DISTINCT FROM OLD.tache_id)) THEN
      RAISE EXCEPTION 'Identité d''une étape figée ; sa tâche se lie une seule fois.'
        USING ERRCODE = 'MPA01';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM appels_offres a WHERE a.id = NEW.ao_id
                   AND a.statut IN ('detecte', 'go_no_go', 'en_reponse')) THEN
      RAISE EXCEPTION 'Le rétro-planning est figé hors préparation de la réponse.'
        USING ERRCODE = 'MPA06';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER ao_retroplanning_controle BEFORE INSERT OR UPDATE OR DELETE
  ON ao_retroplanning_etapes FOR EACH ROW EXECUTE FUNCTION controler_etape_ao();
