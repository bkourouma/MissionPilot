-- Temps (TPS-01 à TPS-10) : paramètres de saisie, activités internes, feuilles
-- de temps hebdomadaires et leur circuit de validation, reste à faire
-- historisé, clôture mensuelle, corrections tracées, alertes de suivi,
-- rappels de saisie et file de tâches récurrentes (ADR-002).
-- Toute table porte cabinet_id, RLS (politique `isolation`) et des clés
-- étrangères composites (cabinet_id, id). Les jours sont stockés en centièmes
-- de jour entiers (unité de calcul de @missionpilot/engines).
-- Codes SQLSTATE : MPT01 feuille figée ou transition refusée, MPT02 date hors
-- de la semaine, MPT03 période clôturée, MPT04 correction figée.

-- Paramètres de saisie des temps par cabinet (absence de ligne : défauts).
CREATE TABLE parametres_temps (
  cabinet_id uuid PRIMARY KEY REFERENCES cabinets (id) ON DELETE CASCADE,
  controle_capacite text NOT NULL DEFAULT 'signaler'
    CHECK (controle_capacite IN ('signaler', 'refuser')),
  seuil_consommation_pct smallint NOT NULL DEFAULT 80
    CHECK (seuil_consommation_pct BETWEEN 1 AND 100),
  modifie_le timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE parametres_temps ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON parametres_temps
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE DELETE ON parametres_temps FROM missionpilot_app;

-- Activités internes non facturables (TPS-02). Désactivées, jamais supprimées.
CREATE TABLE activites_internes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  code text NOT NULL CHECK (code ~ '^[a-z0-9_]{1,40}$'),
  libelle text NOT NULL CHECK (length(libelle) BETWEEN 1 AND 120),
  -- Absence (congés) : exclue du contrôle de capacité journalière.
  est_absence boolean NOT NULL DEFAULT false,
  actif boolean NOT NULL DEFAULT true,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, code),
  UNIQUE (cabinet_id, id)
);
ALTER TABLE activites_internes ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON activites_internes
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE DELETE ON activites_internes FROM missionpilot_app;

-- Activités par défaut, posées pour chaque cabinet existant et à la création
-- d'un cabinet. SECURITY DEFINER : exécutée hors contexte de cabinet.
CREATE FUNCTION semer_activites_internes(p_cabinet uuid) RETURNS void
  LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    INSERT INTO activites_internes (cabinet_id, code, libelle, est_absence) VALUES
      (p_cabinet, 'formation', 'Formation', false),
      (p_cabinet, 'prospection', 'Prospection commerciale', false),
      (p_cabinet, 'administration', 'Administration interne', false),
      (p_cabinet, 'conges', 'Congés et absences', true)
    ON CONFLICT (cabinet_id, code) DO NOTHING $$;
REVOKE ALL ON FUNCTION semer_activites_internes(uuid) FROM PUBLIC;

CREATE FUNCTION semer_activites_nouveau_cabinet() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    PERFORM semer_activites_internes(NEW.id);
    RETURN NEW;
  END $$;

CREATE TRIGGER cabinets_activites_internes AFTER INSERT ON cabinets
  FOR EACH ROW EXECUTE FUNCTION semer_activites_nouveau_cabinet();

SELECT semer_activites_internes(id) FROM cabinets;

-- Périodes mensuelles des temps (TPS-09). Absence de ligne : période ouverte.
-- La réouverture (associé, motif) est journalisée dans journal_audit.
CREATE TABLE periodes_temps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  mois text NOT NULL CHECK (mois ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  statut text NOT NULL CHECK (statut IN ('ouverte', 'cloturee')),
  cloturee_par uuid,
  cloturee_le timestamptz,
  rouverte_par uuid,
  rouverte_le timestamptz,
  motif_reouverture text CHECK (motif_reouverture IS NULL OR length(motif_reouverture) <= 500),
  CHECK (statut <> 'cloturee' OR (cloturee_par IS NOT NULL AND cloturee_le IS NOT NULL)),
  CHECK (rouverte_le IS NULL OR (rouverte_par IS NOT NULL AND motif_reouverture IS NOT NULL
                                 AND length(btrim(motif_reouverture)) > 0)),
  UNIQUE (cabinet_id, mois),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cloturee_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, rouverte_par) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE periodes_temps ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON periodes_temps
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE DELETE ON periodes_temps FROM missionpilot_app;

CREATE FUNCTION date_temps_cloturee(p_cabinet uuid, p_date date) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT EXISTS (SELECT 1 FROM periodes_temps
                       WHERE cabinet_id = p_cabinet AND mois = to_char(p_date, 'YYYY-MM')
                         AND statut = 'cloturee') $$;
REVOKE ALL ON FUNCTION date_temps_cloturee(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION date_temps_cloturee(uuid, date) TO missionpilot_app;

-- Feuilles de temps hebdomadaires (TPS-01, TPS-03). Circuit :
-- brouillon → soumise → validee | rejetee (motif) ; rejetee → soumise ;
-- validee → verrouillee (clôture). Une feuille validée est immuable.
-- `cycle` compte les soumissions : les décisions portent sur un cycle.
CREATE TABLE feuilles_temps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  collaborateur_id uuid NOT NULL,
  -- Utilisateur auteur de la saisie (celui du collaborateur) ; NULL pour un import.
  auteur_id uuid,
  semaine date NOT NULL CHECK (extract(isodow FROM semaine) = 1),
  statut text NOT NULL DEFAULT 'brouillon'
    CHECK (statut IN ('brouillon', 'soumise', 'validee', 'rejetee', 'verrouillee')),
  origine text NOT NULL DEFAULT 'saisie' CHECK (origine IN ('saisie', 'import')),
  cycle int NOT NULL DEFAULT 0 CHECK (cycle >= 0),
  premiere_soumission_le timestamptz,
  soumise_le timestamptz,
  validee_le timestamptz,
  rejetee_le timestamptz,
  rejetee_par uuid,
  motif_rejet text CHECK (motif_rejet IS NULL OR length(motif_rejet) <= 500),
  verrouillee_le timestamptz,
  importee_par uuid,
  cree_le timestamptz NOT NULL DEFAULT now(),
  modifie_le timestamptz NOT NULL DEFAULT now(),
  CHECK (origine = 'import' OR auteur_id IS NOT NULL),
  CHECK (origine = 'saisie' OR importee_par IS NOT NULL),
  CHECK (statut <> 'rejetee' OR (motif_rejet IS NOT NULL AND length(btrim(motif_rejet)) > 0
                                 AND rejetee_par IS NOT NULL)),
  CHECK (statut NOT IN ('validee', 'verrouillee') OR validee_le IS NOT NULL),
  CHECK (statut <> 'verrouillee' OR verrouillee_le IS NOT NULL),
  UNIQUE (cabinet_id, collaborateur_id, semaine),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, collaborateur_id) REFERENCES collaborateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, auteur_id) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, rejetee_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, importee_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX feuilles_temps_auteur_idx ON feuilles_temps (cabinet_id, auteur_id, semaine DESC);
CREATE INDEX feuilles_temps_semaine_idx ON feuilles_temps (cabinet_id, semaine, statut);
ALTER TABLE feuilles_temps ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON feuilles_temps
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE DELETE ON feuilles_temps FROM missionpilot_app;

-- Lignes : une tâche (et sa mission) OU une activité interne, un jour.
-- Pas de suppression en cascade depuis une tâche : une tâche qui porte des
-- temps ne se supprime plus.
CREATE TABLE lignes_temps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  feuille_id uuid NOT NULL,
  date date NOT NULL,
  mission_id uuid,
  tache_id uuid,
  activite_id uuid,
  centiemes int NOT NULL CHECK (centiemes > 0 AND centiemes <= 10000),
  -- Saisie en heures : minutes saisies (traçabilité de la conversion).
  minutes int CHECK (minutes IS NULL OR minutes BETWEEN 1 AND 1440),
  commentaire text CHECK (commentaire IS NULL OR length(commentaire) <= 500),
  cree_le timestamptz NOT NULL DEFAULT now(),
  CHECK ((tache_id IS NULL) = (mission_id IS NULL)),
  CHECK ((tache_id IS NULL) <> (activite_id IS NULL)),
  FOREIGN KEY (cabinet_id, feuille_id) REFERENCES feuilles_temps (cabinet_id, id),
  FOREIGN KEY (cabinet_id, mission_id, tache_id) REFERENCES mission_taches (cabinet_id, mission_id, id),
  FOREIGN KEY (cabinet_id, activite_id) REFERENCES activites_internes (cabinet_id, id)
);
CREATE UNIQUE INDEX lignes_temps_tache_uniq ON lignes_temps (feuille_id, date, tache_id)
  WHERE tache_id IS NOT NULL;
CREATE UNIQUE INDEX lignes_temps_activite_uniq ON lignes_temps (feuille_id, date, activite_id)
  WHERE activite_id IS NOT NULL;
CREATE INDEX lignes_temps_feuille_idx ON lignes_temps (feuille_id, date);
CREATE INDEX lignes_temps_mission_idx ON lignes_temps (cabinet_id, mission_id, tache_id)
  WHERE mission_id IS NOT NULL;
ALTER TABLE lignes_temps ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON lignes_temps
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());

-- Décisions sur les parties d'une feuille (une par mission, NULL = activités
-- internes) pour un cycle de soumission. Historique en ajout seul.
CREATE TABLE feuille_validations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  feuille_id uuid NOT NULL,
  cycle int NOT NULL CHECK (cycle >= 1),
  mission_id uuid,
  decision text NOT NULL CHECK (decision IN ('validee', 'rejetee')),
  motif text CHECK (motif IS NULL OR length(motif) <= 500),
  decide_par uuid NOT NULL,
  decide_le timestamptz NOT NULL DEFAULT now(),
  CHECK (decision <> 'rejetee' OR (motif IS NOT NULL AND length(btrim(motif)) > 0)),
  FOREIGN KEY (cabinet_id, feuille_id) REFERENCES feuilles_temps (cabinet_id, id),
  FOREIGN KEY (cabinet_id, mission_id) REFERENCES missions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, decide_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE UNIQUE INDEX feuille_validations_partie_uniq ON feuille_validations
  (feuille_id, cycle, coalesce(mission_id, '00000000-0000-0000-0000-000000000000'::uuid));
ALTER TABLE feuille_validations ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON feuille_validations
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE UPDATE, DELETE ON feuille_validations FROM missionpilot_app;

-- Une ligne ne change que dans une feuille en brouillon ou rejetée, dans la
-- semaine de la feuille et hors période clôturée.
CREATE FUNCTION verifier_ligne_temps_modifiable(p_feuille uuid, p_date date) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE v_statut text; v_semaine date; v_cabinet uuid;
  BEGIN
    SELECT statut, semaine, cabinet_id INTO v_statut, v_semaine, v_cabinet
      FROM feuilles_temps WHERE id = p_feuille;
    IF v_statut IS NULL OR v_statut NOT IN ('brouillon', 'rejetee') THEN
      RAISE EXCEPTION 'Feuille de temps soumise ou validée : lignes figées.' USING ERRCODE = 'MPT01';
    END IF;
    IF p_date < v_semaine OR p_date > v_semaine + 6 THEN
      RAISE EXCEPTION 'Date hors de la semaine de la feuille.' USING ERRCODE = 'MPT02';
    END IF;
    IF date_temps_cloturee(v_cabinet, p_date) THEN
      RAISE EXCEPTION 'Période de temps clôturée.' USING ERRCODE = 'MPT03';
    END IF;
  END $$;
REVOKE ALL ON FUNCTION verifier_ligne_temps_modifiable(uuid, date) FROM PUBLIC;

CREATE FUNCTION controler_ligne_temps() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
      PERFORM verifier_ligne_temps_modifiable(OLD.feuille_id, OLD.date);
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
      PERFORM verifier_ligne_temps_modifiable(NEW.feuille_id, NEW.date);
      RETURN NEW;
    END IF;
    RETURN OLD;
  END $$;

CREATE TRIGGER lignes_temps_controle BEFORE INSERT OR UPDATE OR DELETE ON lignes_temps
  FOR EACH ROW EXECUTE FUNCTION controler_ligne_temps();

-- Identité figée, transitions de statut contrôlées, feuille validée immuable
-- (seul passage permis : validee → verrouillee à la clôture), aucune
-- validation de dates d'une période clôturée.
CREATE FUNCTION controler_feuille_temps() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF (NEW.cabinet_id, NEW.collaborateur_id, NEW.auteur_id, NEW.semaine, NEW.origine,
        NEW.importee_par, NEW.cree_le)
       IS DISTINCT FROM
       (OLD.cabinet_id, OLD.collaborateur_id, OLD.auteur_id, OLD.semaine, OLD.origine,
        OLD.importee_par, OLD.cree_le) THEN
      RAISE EXCEPTION 'Identité d''une feuille de temps figée.' USING ERRCODE = 'MPT01';
    END IF;
    IF OLD.statut IN ('validee', 'verrouillee') THEN
      IF OLD.statut = 'validee' AND NEW.statut = 'verrouillee'
         AND (NEW.cycle, NEW.premiere_soumission_le, NEW.soumise_le, NEW.validee_le,
              NEW.rejetee_le, NEW.rejetee_par, NEW.motif_rejet)
             IS NOT DISTINCT FROM
             (OLD.cycle, OLD.premiere_soumission_le, OLD.soumise_le, OLD.validee_le,
              OLD.rejetee_le, OLD.rejetee_par, OLD.motif_rejet) THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'Feuille de temps validée : immuable.' USING ERRCODE = 'MPT01';
    END IF;
    IF NEW.statut IS DISTINCT FROM OLD.statut AND NOT (
         (OLD.statut IN ('brouillon', 'rejetee') AND NEW.statut = 'soumise')
      OR (OLD.statut = 'soumise' AND NEW.statut IN ('validee', 'rejetee'))
      OR (OLD.statut = 'brouillon' AND NEW.statut = 'validee' AND OLD.origine = 'import')) THEN
      RAISE EXCEPTION 'Transition de statut de feuille de temps refusée.' USING ERRCODE = 'MPT01';
    END IF;
    IF NEW.statut = 'validee' AND EXISTS (
         SELECT 1 FROM lignes_temps l
         WHERE l.feuille_id = NEW.id AND date_temps_cloturee(NEW.cabinet_id, l.date)) THEN
      RAISE EXCEPTION 'Période de temps clôturée.' USING ERRCODE = 'MPT03';
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER feuilles_temps_controle BEFORE UPDATE ON feuilles_temps
  FOR EACH ROW EXECUTE FUNCTION controler_feuille_temps();

-- Reste à faire (TPS-05) : une déclaration par tâche, collaborateur et
-- semaine ; la plus récente fait foi. Historique en ajout seul.
CREATE TABLE reste_a_faire (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ordre bigint GENERATED ALWAYS AS IDENTITY,
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  mission_id uuid NOT NULL,
  tache_id uuid NOT NULL,
  collaborateur_id uuid NOT NULL,
  semaine date NOT NULL CHECK (extract(isodow FROM semaine) = 1),
  centiemes int NOT NULL CHECK (centiemes BETWEEN 0 AND 10000000),
  declare_par uuid NOT NULL,
  declare_le timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (cabinet_id, mission_id, tache_id) REFERENCES mission_taches (cabinet_id, mission_id, id),
  FOREIGN KEY (cabinet_id, collaborateur_id) REFERENCES collaborateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, declare_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX reste_a_faire_tache_idx ON reste_a_faire (mission_id, tache_id, collaborateur_id, ordre DESC);
ALTER TABLE reste_a_faire ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON reste_a_faire
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE UPDATE, DELETE ON reste_a_faire FROM missionpilot_app;

-- Corrections après validation ou clôture (TPS-09) : ancienne et nouvelle
-- valeur d'une case (collaborateur, jour, tâche ou activité), motif, demandeur
-- et valideur distincts. Les lignes validées ne changent jamais : une
-- correction validée s'ajoute au réalisé (nouvelle − ancienne).
CREATE TABLE corrections_temps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  collaborateur_id uuid NOT NULL,
  date date NOT NULL,
  mission_id uuid,
  tache_id uuid,
  activite_id uuid,
  ancienne_centiemes int NOT NULL CHECK (ancienne_centiemes BETWEEN 0 AND 10000),
  nouvelle_centiemes int NOT NULL CHECK (nouvelle_centiemes BETWEEN 0 AND 10000),
  motif text NOT NULL CHECK (length(btrim(motif)) > 0 AND length(motif) <= 500),
  statut text NOT NULL DEFAULT 'demandee' CHECK (statut IN ('demandee', 'validee', 'rejetee')),
  demandee_par uuid NOT NULL,
  demandee_le timestamptz NOT NULL DEFAULT now(),
  decidee_par uuid,
  decidee_le timestamptz,
  motif_rejet text CHECK (motif_rejet IS NULL OR length(motif_rejet) <= 500),
  CHECK (ancienne_centiemes <> nouvelle_centiemes),
  CHECK ((tache_id IS NULL) = (mission_id IS NULL)),
  CHECK ((tache_id IS NULL) <> (activite_id IS NULL)),
  CHECK (statut = 'demandee' OR (decidee_par IS NOT NULL AND decidee_le IS NOT NULL)),
  CHECK (decidee_par IS NULL OR decidee_par <> demandee_par),
  CHECK (statut <> 'rejetee' OR (motif_rejet IS NOT NULL AND length(btrim(motif_rejet)) > 0)),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, collaborateur_id) REFERENCES collaborateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, mission_id, tache_id) REFERENCES mission_taches (cabinet_id, mission_id, id),
  FOREIGN KEY (cabinet_id, activite_id) REFERENCES activites_internes (cabinet_id, id),
  FOREIGN KEY (cabinet_id, demandee_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, decidee_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX corrections_temps_case_idx ON corrections_temps (cabinet_id, collaborateur_id, date);
CREATE INDEX corrections_temps_mission_idx ON corrections_temps (mission_id) WHERE mission_id IS NOT NULL;
-- Une seule demande en attente par case.
CREATE UNIQUE INDEX corrections_temps_en_attente_uniq ON corrections_temps
  (collaborateur_id, date, coalesce(tache_id, activite_id)) WHERE statut = 'demandee';
ALTER TABLE corrections_temps ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON corrections_temps
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE DELETE ON corrections_temps FROM missionpilot_app;

CREATE FUNCTION controler_correction_temps() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF OLD.statut <> 'demandee' THEN
      RAISE EXCEPTION 'Correction déjà décidée : immuable.' USING ERRCODE = 'MPT04';
    END IF;
    IF (NEW.cabinet_id, NEW.collaborateur_id, NEW.date, NEW.mission_id, NEW.tache_id,
        NEW.activite_id, NEW.ancienne_centiemes, NEW.nouvelle_centiemes, NEW.motif,
        NEW.demandee_par, NEW.demandee_le)
       IS DISTINCT FROM
       (OLD.cabinet_id, OLD.collaborateur_id, OLD.date, OLD.mission_id, OLD.tache_id,
        OLD.activite_id, OLD.ancienne_centiemes, OLD.nouvelle_centiemes, OLD.motif,
        OLD.demandee_par, OLD.demandee_le) THEN
      RAISE EXCEPTION 'Une correction ne change que par sa décision.' USING ERRCODE = 'MPT04';
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER corrections_temps_figees BEFORE UPDATE ON corrections_temps
  FOR EACH ROW EXECUTE FUNCTION controler_correction_temps();

-- État des alertes de suivi (TPS-07) : une alerte n'est notifiée qu'à son
-- déclenchement ; elle se lève quand la condition disparaît.
CREATE TABLE alertes_suivi (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  mission_id uuid NOT NULL,
  niveau text NOT NULL CHECK (niveau IN ('mission', 'phase')),
  noeud_id uuid NOT NULL,
  type text NOT NULL CHECK (type IN ('consommation_seuil', 'atterrissage_superieur_budget')),
  active boolean NOT NULL DEFAULT true,
  message text NOT NULL CHECK (length(message) <= 500),
  declenchee_le timestamptz NOT NULL DEFAULT now(),
  levee_le timestamptz,
  UNIQUE (mission_id, noeud_id, type),
  FOREIGN KEY (cabinet_id, mission_id) REFERENCES missions (cabinet_id, id)
);
ALTER TABLE alertes_suivi ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON alertes_suivi
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE DELETE ON alertes_suivi FROM missionpilot_app;

-- Rappels envoyés (TPS-04) : jamais deux fois le même rappel pour la même
-- semaine et le même utilisateur.
CREATE TABLE rappels_temps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  utilisateur_id uuid NOT NULL,
  semaine date NOT NULL CHECK (extract(isodow FROM semaine) = 1),
  type text NOT NULL CHECK (type IN ('rappel_saisie', 'relance_chef')),
  envoye_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, utilisateur_id, semaine, type),
  FOREIGN KEY (cabinet_id, utilisateur_id) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE rappels_temps ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON rappels_temps
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE UPDATE, DELETE ON rappels_temps FROM missionpilot_app;

-- File de tâches (ADR-002) : clé d'unicité des tâches récurrentes, réservation
-- à une heure fournie (horloge injectable), planification pour tous les
-- cabinets et libération des tâches bloquées. Fonctions étroites, SECURITY
-- DEFINER car exécutées hors contexte de cabinet.
ALTER TABLE jobs ADD COLUMN cle text CHECK (cle IS NULL OR length(cle) BETWEEN 1 AND 200);
CREATE UNIQUE INDEX jobs_cle_uniq ON jobs (cabinet_id, cle) WHERE cle IS NOT NULL;

CREATE FUNCTION reserver_job_a(p_maintenant timestamptz)
  RETURNS SETOF jobs
  LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    UPDATE jobs SET statut = 'en_cours', verrouille_le = p_maintenant, tentatives = tentatives + 1
    WHERE id = (SELECT id FROM jobs WHERE statut = 'en_attente' AND execute_a <= p_maintenant
                ORDER BY execute_a, id FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING * $$;

CREATE FUNCTION planifier_job_cabinets(p_type text, p_cle text, p_execute_a timestamptz,
                                       p_charge jsonb)
  RETURNS int
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE v_n int;
  BEGIN
    IF p_type NOT IN ('rappel_feuilles', 'relance_feuilles') THEN
      RAISE EXCEPTION 'Type de tâche récurrente inconnu.';
    END IF;
    INSERT INTO jobs (cabinet_id, type, charge, execute_a, cle)
      SELECT id, p_type, p_charge, p_execute_a, p_cle FROM cabinets
      ON CONFLICT (cabinet_id, cle) WHERE cle IS NOT NULL DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
  END $$;

CREATE FUNCTION liberer_jobs_bloques(p_maintenant timestamptz, p_delai interval)
  RETURNS int
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE v_n int;
  BEGIN
    UPDATE jobs SET
      statut = CASE WHEN tentatives >= tentatives_max THEN 'echec' ELSE 'en_attente' END,
      verrouille_le = NULL,
      erreur = 'Exécution interrompue : délai dépassé.'
    WHERE statut = 'en_cours' AND verrouille_le < p_maintenant - p_delai;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
  END $$;

REVOKE ALL ON FUNCTION reserver_job_a(timestamptz), planifier_job_cabinets(text, text, timestamptz, jsonb),
  liberer_jobs_bloques(timestamptz, interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reserver_job_a(timestamptz), planifier_job_cabinets(text, text, timestamptz, jsonb),
  liberer_jobs_bloques(timestamptz, interval) TO missionpilot_app;
