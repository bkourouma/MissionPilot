-- Rapport d'avancement hebdomadaire au client (AUT-10, PRD complémentaire §8, lot 4c) : rapports.
--
-- Une ligne par (mission, semaine) : UNIQUE (mission_id, semaine) rend la tâche hebdomadaire
-- idempotente (`INSERT … ON CONFLICT DO NOTHING` : rejouée ou doublée, aucune duplication, et un
-- brouillon déjà modifié par le chef, comme un rapport validé, n'est jamais régénéré par la tâche).
-- Table NEUVE : `rapports_mission` et `controler_source_rapport()` ne sont ni lues ni modifiées ici.
--
-- Contenu :
-- - `contenu` : jsonb produit par le moteur `composerAvancementHebdo` (packages/engines/src/avancement),
--   seule source des chiffres ; aucune donnée financière interne (FIN-02). Modifiable seulement par
--   régénération, tant que le rapport est un brouillon ;
-- - `introduction` et `commentaire` : textes du chef de mission ; `commentaire_ia` : suggestion IA
--   éventuelle, SÉPARÉE du chiffré et jamais servie au client ; `statut_commentaire` : vide,
--   brouillon_ia (suggestion non relue : la validation est refusée) ou redige (écrit ou relu).
-- - `version` : verrou optimiste, incrémentée par le déclencheur à chaque modification.
--
-- Cycle : brouillon → valide. Un rapport VALIDÉ est FIGÉ (MQU01, aucune modification ni suppression,
-- même pour le propriétaire de la table) et seul visible du client sur le portail. La validation est
-- réservée à l'associé et au directeur ou chef DE LA MISSION (MQU02), comme le contrôle de l'API.
--
-- RLS `isolation`, FK composites, auteurs jamais un compte du portail. Politique RESTRICTIVE du portail
-- `portail` en LECTURE (rapports VALIDÉS dont la mission est partagée avec CE client), doublée de
-- `portail_sans_insert`, `portail_sans_update`, `portail_sans_delete`. Aucune fonction SECURITY DEFINER.
--
-- SQLSTATE (second préfixe « MQ », MQU01 à MQU10 réservés à ce chantier) :
-- MQU01 rapport validé figé (modification) ; MQU02 validateur non autorisé ;
-- MQU03 création hors brouillon ou identité modifiée ; MQU04 client différent de celui de la mission ;
-- MQU05 mission non active à la création du brouillon ; MQU07 suppression interdite.

CREATE TABLE avancement_rapports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  mission_id uuid NOT NULL,
  client_id uuid NOT NULL,
  semaine date NOT NULL CHECK (extract(isodow FROM semaine) = 1),
  statut text NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon', 'valide')),
  contenu jsonb NOT NULL
    CHECK (jsonb_typeof(contenu) = 'object' AND length(contenu::text) <= 300000),
  introduction text CHECK (introduction IS NULL OR length(introduction) BETWEEN 1 AND 2000),
  commentaire text CHECK (commentaire IS NULL OR length(commentaire) BETWEEN 1 AND 4000),
  commentaire_ia text CHECK (commentaire_ia IS NULL OR length(commentaire_ia) BETWEEN 1 AND 4000),
  statut_commentaire text NOT NULL DEFAULT 'vide'
    CHECK (statut_commentaire IN ('vide', 'brouillon_ia', 'redige')),
  version int NOT NULL DEFAULT 1 CHECK (version >= 1),
  job_id uuid,
  genere_le timestamptz NOT NULL DEFAULT now(),
  cree_le timestamptz NOT NULL DEFAULT now(),
  modifie_le timestamptz NOT NULL DEFAULT now(),
  modifie_par uuid,
  valide_par uuid,
  valide_le timestamptz,
  UNIQUE (mission_id, semaine),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, mission_id) REFERENCES missions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, client_id) REFERENCES clients (cabinet_id, id),
  FOREIGN KEY (cabinet_id, modifie_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, valide_par) REFERENCES utilisateurs (cabinet_id, id),
  CHECK ((statut = 'valide') = (valide_par IS NOT NULL AND valide_le IS NOT NULL)),
  CHECK ((statut_commentaire = 'redige') = (commentaire IS NOT NULL)),
  CHECK (statut_commentaire <> 'brouillon_ia' OR commentaire_ia IS NOT NULL),
  -- Une suggestion de l'IA non relue ne se valide pas : « l'IA propose, l'expert dispose ».
  CHECK (statut <> 'valide' OR statut_commentaire <> 'brouillon_ia')
);
CREATE INDEX avancement_rapports_mission_idx ON avancement_rapports (mission_id, semaine DESC);
CREATE INDEX avancement_rapports_portail_idx ON avancement_rapports (client_id, semaine DESC, id)
  WHERE statut = 'valide';
ALTER TABLE avancement_rapports ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON avancement_rapports
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE DELETE ON avancement_rapports FROM missionpilot_app;

-- Portail : lecture SEULE des rapports validés de CE client, dont la mission lui est partagée (la
-- sous-requête sur `missions` est elle-même filtrée par la politique du portail : client ET partage).
CREATE POLICY portail ON avancement_rapports AS RESTRICTIVE FOR SELECT
  USING (app_portail_client_id() IS NULL OR (
    statut = 'valide' AND client_id = app_portail_client_id()
    AND EXISTS (SELECT 1 FROM missions m WHERE m.id = avancement_rapports.mission_id)));
CREATE POLICY portail_sans_insert ON avancement_rapports AS RESTRICTIVE FOR INSERT
  WITH CHECK (app_portail_client_id() IS NULL);
CREATE POLICY portail_sans_update ON avancement_rapports AS RESTRICTIVE FOR UPDATE
  USING (app_portail_client_id() IS NULL);
CREATE POLICY portail_sans_delete ON avancement_rapports AS RESTRICTIVE FOR DELETE
  USING (app_portail_client_id() IS NULL);

CREATE TRIGGER avancement_rapports_modifie_par_sans_portail
  BEFORE INSERT OR UPDATE ON avancement_rapports
  FOR EACH ROW EXECUTE FUNCTION refuser_utilisateur_portail('modifie_par');
CREATE TRIGGER avancement_rapports_valide_par_sans_portail
  BEFORE INSERT OR UPDATE ON avancement_rapports
  FOR EACH ROW EXECUTE FUNCTION refuser_utilisateur_portail('valide_par');

-- Règles du cycle de vie, dites une seconde fois ici comme dans l'API (avancement-service.ts).
CREATE FUNCTION controler_avancement_rapport() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_mission record;
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Un rapport d''avancement ne se supprime pas.' USING ERRCODE = 'MQU07';
    END IF;

    SELECT m.client_id, m.statut, m.chef_id, m.directeur_id INTO v_mission
      FROM missions m WHERE m.id = NEW.mission_id;

    IF TG_OP = 'INSERT' THEN
      IF NEW.statut <> 'brouillon' OR NEW.valide_par IS NOT NULL OR NEW.valide_le IS NOT NULL THEN
        RAISE EXCEPTION 'Un rapport d''avancement naît en brouillon.' USING ERRCODE = 'MQU03';
      END IF;
      IF v_mission.client_id IS DISTINCT FROM NEW.client_id THEN
        RAISE EXCEPTION 'Le client du rapport n''est pas celui de la mission.' USING ERRCODE = 'MQU04';
      END IF;
      IF v_mission.statut NOT IN ('signee', 'en_cours') THEN
        RAISE EXCEPTION 'Seule une mission signée ou en cours reçoit un brouillon d''avancement.'
          USING ERRCODE = 'MQU05';
      END IF;
      RETURN NEW;
    END IF;

    -- UPDATE : un rapport validé est figé.
    IF OLD.statut = 'valide' THEN
      RAISE EXCEPTION 'Rapport d''avancement validé : il est figé.' USING ERRCODE = 'MQU01';
    END IF;
    IF (NEW.id, NEW.cabinet_id, NEW.mission_id, NEW.client_id, NEW.semaine, NEW.cree_le)
         IS DISTINCT FROM (OLD.id, OLD.cabinet_id, OLD.mission_id, OLD.client_id, OLD.semaine, OLD.cree_le) THEN
      RAISE EXCEPTION 'Mission, client et semaine d''un rapport ne changent pas.' USING ERRCODE = 'MQU03';
    END IF;
    IF NEW.statut = 'valide' AND NOT (
         NEW.valide_par IN (v_mission.chef_id, v_mission.directeur_id)
         OR EXISTS (SELECT 1 FROM utilisateurs u
                    WHERE u.id = NEW.valide_par AND u.actif AND 'associe' = ANY (u.roles))) THEN
      RAISE EXCEPTION 'Seul un associé, le directeur ou le chef de la mission valide ce rapport.'
        USING ERRCODE = 'MQU02';
    END IF;
    NEW.version := OLD.version + 1;
    NEW.modifie_le := now();
    RETURN NEW;
  END $$;
CREATE TRIGGER avancement_rapports_controle
  BEFORE INSERT OR UPDATE OR DELETE ON avancement_rapports
  FOR EACH ROW EXECUTE FUNCTION controler_avancement_rapport();
