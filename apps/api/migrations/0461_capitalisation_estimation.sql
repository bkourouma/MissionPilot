-- Capitalisation (lot CAP) — base d'estimation (CAP-02) : temps réels par brique et par contexte.
--
-- `cap_taches_briques` : rattachement d'une tâche de mission (découpage, PLN-01) à une brique de
-- la méthode effective de la mission (contrôlé par l'API). Modifiable tant que la mission n'est
-- pas clôturée (MPJ03) ; chaque changement est journalisé par l'API.
--
-- `cap_temps_briques` : observation figée à la VALIDATION du retour d'expérience (une ligne par
-- mission et par brique) : temps réel et budget des tâches rattachées, temps type de la brique,
-- contexte de modulation de la mission. Les sommes sont faites par le moteur
-- (packages/engines/src/capitalisation), jamais en SQL ; centièmes de jour entiers. Ajout seul
-- (MPJ01) ; l'observation exige un retour validé de la même mission (MPJ05).

CREATE TABLE cap_taches_briques (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  mission_id uuid NOT NULL,
  tache_id uuid NOT NULL,
  brique_code text NOT NULL CHECK (std_code_valide(brique_code)),
  modifie_par uuid NOT NULL,
  modifie_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (tache_id),
  FOREIGN KEY (cabinet_id, mission_id, tache_id)
    REFERENCES mission_taches (cabinet_id, mission_id, id) ON DELETE CASCADE,
  FOREIGN KEY (cabinet_id, modifie_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX cap_taches_briques_mission_idx ON cap_taches_briques (cabinet_id, mission_id);
ALTER TABLE cap_taches_briques ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON cap_taches_briques
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON cap_taches_briques AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);

CREATE FUNCTION controler_tache_brique() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_mission uuid;
  BEGIN
    v_mission := CASE WHEN TG_OP = 'DELETE' THEN OLD.mission_id ELSE NEW.mission_id END;
    IF TG_OP = 'UPDATE' AND (NEW.mission_id, NEW.tache_id, NEW.cabinet_id)
         IS DISTINCT FROM (OLD.mission_id, OLD.tache_id, OLD.cabinet_id) THEN
      RAISE EXCEPTION 'Rattachement : seule la brique change.' USING ERRCODE = 'MPJ05';
    END IF;
    IF EXISTS (SELECT 1 FROM missions m WHERE m.id = v_mission AND m.statut = 'cloturee') THEN
      RAISE EXCEPTION 'Mission clôturée : rattachements figés.' USING ERRCODE = 'MPJ03';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END $$;
CREATE TRIGGER cap_taches_briques_controle BEFORE INSERT OR UPDATE OR DELETE ON cap_taches_briques
  FOR EACH ROW EXECUTE FUNCTION controler_tache_brique();

CREATE TABLE cap_temps_briques (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  mission_id uuid NOT NULL,
  retour_id uuid NOT NULL,
  brique_code text NOT NULL CHECK (std_code_valide(brique_code)),
  methode_code text CHECK (methode_code IS NULL OR std_code_valide(methode_code)),
  realise_centiemes bigint NOT NULL CHECK (realise_centiemes >= 0),
  budget_centiemes bigint NOT NULL CHECK (budget_centiemes >= 0),
  temps_type_centiemes bigint CHECK (temps_type_centiemes IS NULL OR temps_type_centiemes >= 0),
  contexte jsonb NOT NULL DEFAULT '{}'
    CHECK (jsonb_typeof(contexte) = 'object' AND octet_length(contexte::text) <= 100000),
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (mission_id, brique_code),
  FOREIGN KEY (cabinet_id, mission_id) REFERENCES missions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, retour_id) REFERENCES retours_experience (cabinet_id, id)
);
CREATE INDEX cap_temps_briques_brique_idx ON cap_temps_briques (cabinet_id, brique_code);
ALTER TABLE cap_temps_briques ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON cap_temps_briques
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON cap_temps_briques AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON cap_temps_briques FROM missionpilot_app;
CREATE TRIGGER cap_temps_briques_ajout_seul BEFORE UPDATE OR DELETE ON cap_temps_briques
  FOR EACH ROW EXECUTE FUNCTION cap_ajout_seul();

CREATE FUNCTION controler_temps_brique() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM retours_experience r WHERE r.id = NEW.retour_id
                     AND r.mission_id = NEW.mission_id AND r.statut = 'valide') THEN
      RAISE EXCEPTION 'Observation de temps : retour d''expérience validé de la mission exigé.'
        USING ERRCODE = 'MPJ05';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER cap_temps_briques_controle BEFORE INSERT ON cap_temps_briques
  FOR EACH ROW EXECUTE FUNCTION controler_temps_brique();
