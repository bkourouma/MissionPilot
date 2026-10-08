-- Référentiel de méthodes (lot STD) — mission figée sur une version de
-- méthode (STD-08), journal d'application des règles (STD-05) et
-- dérogations motivées approuvées selon la classe de risque (STD-07).
--
-- `mission_methodes` est un HISTORIQUE EN AJOUT SEUL (MPM03) : chaque ligne
-- (rang 1, 2…) fige la version de méthode, le contexte lu et le résultat de
-- l'application des règles (effets retenus et écartés, conflits, feuilles
-- vérifiées avec les valeurs lues). La ligne de rang le plus élevé est la
-- méthode courante de la mission. Événements : `liaison` (rang 1),
-- `contexte` (même version, autre contexte), `migration` (version plus
-- récente de la même méthode, motif obligatoire, analyse d'impact jointe).
-- Une version liée est publiée et du standard ou du même cabinet (MPM06).
--
-- Dérogations : motif obligatoire ; statut demandée → approuvée ou refusée,
-- définitif ensuite (MPM04) ; validations par étape de garde en ajout seul
-- (MPM03), jamais par le demandeur au-delà de sa propre étape (MPM04).

CREATE TABLE mission_methodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  mission_id uuid NOT NULL,
  rang integer NOT NULL CHECK (rang BETWEEN 1 AND 500),
  evenement text NOT NULL CHECK (evenement IN ('liaison', 'contexte', 'migration')),
  methode_version_id uuid NOT NULL REFERENCES methode_versions (id),
  contexte jsonb NOT NULL CHECK (jsonb_typeof(contexte) = 'object' AND octet_length(contexte::text) <= 100000),
  -- Résultat de `appliquerModulation` (effets, état, conflits, journal), tel quel.
  resultat jsonb NOT NULL CHECK (jsonb_typeof(resultat) = 'object' AND octet_length(resultat::text) <= 2000000),
  analyse_impact jsonb CHECK (analyse_impact IS NULL OR octet_length(analyse_impact::text) <= 2000000),
  motif text CHECK (motif IS NULL OR length(btrim(motif)) BETWEEN 1 AND 2000),
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (mission_id, rang),
  FOREIGN KEY (cabinet_id, mission_id) REFERENCES missions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id),
  CHECK ((evenement = 'liaison') = (rang = 1)),
  CHECK (evenement <> 'migration' OR (motif IS NOT NULL AND analyse_impact IS NOT NULL))
);
CREATE INDEX mission_methodes_version_idx ON mission_methodes (cabinet_id, methode_version_id);
ALTER TABLE mission_methodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON mission_methodes
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON mission_methodes AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON mission_methodes FROM missionpilot_app;

CREATE FUNCTION refuser_modification_referentiel() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    RAISE EXCEPTION 'Historique du référentiel en ajout seul.' USING ERRCODE = 'MPM03';
  END $$;

CREATE TRIGGER mission_methodes_ajout_seul BEFORE UPDATE OR DELETE ON mission_methodes
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_referentiel();

/*
 * Rang suivant ; version publiée et visible (standard ou même cabinet) ;
 * changement de contexte sur la même version ; migration vers une version
 * PLUS RÉCENTE de la même méthode.
 */
CREATE FUNCTION controler_mission_methode() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_max integer;
    v_cabinet uuid;
    v_statut text;
    v_methode uuid;
    v_numero integer;
    p mission_methodes%ROWTYPE;
    v_methode_prec uuid;
    v_numero_prec integer;
  BEGIN
    SELECT max(rang) INTO v_max FROM mission_methodes WHERE mission_id = NEW.mission_id;
    IF NEW.rang <> coalesce(v_max, 0) + 1 THEN
      RAISE EXCEPTION 'Rang inattendu.' USING ERRCODE = 'MPM02';
    END IF;
    SELECT cabinet_id, statut, methode_id, version INTO v_cabinet, v_statut, v_methode, v_numero
      FROM methode_versions WHERE id = NEW.methode_version_id;
    IF NOT FOUND OR v_statut <> 'publiee'
       OR (v_cabinet IS NOT NULL AND v_cabinet IS DISTINCT FROM NEW.cabinet_id) THEN
      RAISE EXCEPTION 'Seule une version publiée du standard ou du cabinet se lie à une mission.'
        USING ERRCODE = 'MPM06';
    END IF;
    IF NEW.rang = 1 THEN RETURN NEW; END IF;
    SELECT * INTO p FROM mission_methodes WHERE mission_id = NEW.mission_id AND rang = v_max;
    IF NEW.evenement = 'contexte' AND NEW.methode_version_id <> p.methode_version_id THEN
      RAISE EXCEPTION 'Un changement de contexte garde la version.' USING ERRCODE = 'MPM02';
    END IF;
    IF NEW.evenement = 'migration' THEN
      SELECT methode_id, version INTO v_methode_prec, v_numero_prec
        FROM methode_versions WHERE id = p.methode_version_id;
      IF v_methode IS DISTINCT FROM v_methode_prec OR v_numero <= v_numero_prec THEN
        RAISE EXCEPTION 'Migration vers une version plus récente de la même méthode seulement.'
          USING ERRCODE = 'MPM06';
      END IF;
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER mission_methodes_controle BEFORE INSERT ON mission_methodes
  FOR EACH ROW EXECUTE FUNCTION controler_mission_methode();

-- ---------------------------------------------------------------------------
-- Dérogations (STD-07)
-- ---------------------------------------------------------------------------

CREATE TABLE derogations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  mission_id uuid NOT NULL,
  -- Ligne de méthode de la mission en vigueur à la demande.
  mission_methode_id uuid NOT NULL,
  brique_code text NOT NULL CHECK (std_code_valide(brique_code)),
  nature text NOT NULL CHECK (nature IN ('retirer_brique', 'activer_brique', 'adapter_brique')),
  description text CHECK (description IS NULL OR length(btrim(description)) BETWEEN 1 AND 2000),
  motif text NOT NULL CHECK (length(btrim(motif)) BETWEEN 10 AND 2000),
  -- Classe de risque effective de la brique à la demande (relevée par les règles, jamais abaissée).
  classe_risque text NOT NULL CHECK (classe_risque IN ('R0', 'R1', 'R2', 'R3')),
  statut text NOT NULL DEFAULT 'demandee' CHECK (statut IN ('demandee', 'approuvee', 'refusee')),
  demandeur_id uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  decide_le timestamptz,
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, mission_id) REFERENCES missions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, mission_methode_id) REFERENCES mission_methodes (cabinet_id, id),
  FOREIGN KEY (cabinet_id, demandeur_id) REFERENCES utilisateurs (cabinet_id, id),
  CHECK (nature <> 'adapter_brique' OR description IS NOT NULL),
  CHECK ((statut = 'demandee') = (decide_le IS NULL))
);
CREATE INDEX derogations_mission_idx ON derogations (cabinet_id, mission_id, cree_le, id);
CREATE INDEX derogations_tri_idx ON derogations (cabinet_id, cree_le DESC, id DESC);
ALTER TABLE derogations ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON derogations
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON derogations AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON derogations FROM missionpilot_app;
GRANT UPDATE (statut, decide_le) ON derogations TO missionpilot_app;

CREATE FUNCTION controler_derogation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_mission uuid;
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Une dérogation ne se supprime pas.' USING ERRCODE = 'MPM03';
    END IF;
    IF TG_OP = 'INSERT' THEN
      SELECT mission_id INTO v_mission FROM mission_methodes WHERE id = NEW.mission_methode_id;
      IF v_mission IS DISTINCT FROM NEW.mission_id OR NEW.statut <> 'demandee' THEN
        RAISE EXCEPTION 'Dérogation incohérente avec la méthode de la mission.' USING ERRCODE = 'MPM02';
      END IF;
      RETURN NEW;
    END IF;
    IF OLD.statut <> 'demandee' OR NEW.statut = 'demandee'
       OR (NEW.cabinet_id, NEW.mission_id, NEW.mission_methode_id, NEW.brique_code, NEW.nature,
           NEW.description, NEW.motif, NEW.classe_risque, NEW.demandeur_id, NEW.cree_le)
          IS DISTINCT FROM
          (OLD.cabinet_id, OLD.mission_id, OLD.mission_methode_id, OLD.brique_code, OLD.nature,
           OLD.description, OLD.motif, OLD.classe_risque, OLD.demandeur_id, OLD.cree_le) THEN
      RAISE EXCEPTION 'Décision de dérogation définitive.' USING ERRCODE = 'MPM04';
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER derogations_controle BEFORE INSERT OR UPDATE OR DELETE ON derogations
  FOR EACH ROW EXECUTE FUNCTION controler_derogation();

CREATE TABLE derogation_validations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  derogation_id uuid NOT NULL,
  etape text NOT NULL CHECK (etape IN ('validation_auteur', 'validation_consultant',
    'relecture_chef_mission', 'revue_second_expert', 'signature_directeur_mission')),
  decision text NOT NULL CHECK (decision IN ('approuve', 'refuse')),
  acteur_id uuid NOT NULL,
  commentaire text CHECK (commentaire IS NULL OR length(btrim(commentaire)) BETWEEN 1 AND 2000),
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (derogation_id, etape),
  FOREIGN KEY (cabinet_id, derogation_id) REFERENCES derogations (cabinet_id, id),
  FOREIGN KEY (cabinet_id, acteur_id) REFERENCES utilisateurs (cabinet_id, id),
  CHECK (decision = 'approuve' OR commentaire IS NOT NULL)
);
CREATE INDEX derogation_validations_idx ON derogation_validations (cabinet_id, derogation_id, cree_le);
ALTER TABLE derogation_validations ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON derogation_validations
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON derogation_validations AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON derogation_validations FROM missionpilot_app;

CREATE TRIGGER derogation_validations_ajout_seul BEFORE UPDATE OR DELETE ON derogation_validations
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_referentiel();

/*
 * Séparation des tâches doublée en base (la garde complète est évaluée par le
 * moteur `qualite` dans l'API) : seule une dérogation en attente reçoit une
 * validation ; le demandeur ne franchit que sa propre étape (validation de
 * l'auteur ou du consultant) ; le second expert n'est ni le demandeur ni le
 * valideur consultant (quatre yeux).
 */
CREATE FUNCTION controler_derogation_validation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE d derogations%ROWTYPE;
  BEGIN
    SELECT * INTO d FROM derogations WHERE id = NEW.derogation_id;
    IF NOT FOUND OR d.statut <> 'demandee' THEN
      RAISE EXCEPTION 'Dérogation déjà décidée.' USING ERRCODE = 'MPM04';
    END IF;
    IF NEW.acteur_id = d.demandeur_id
       AND NEW.etape NOT IN ('validation_auteur', 'validation_consultant') THEN
      RAISE EXCEPTION 'Le demandeur n''approuve pas sa propre dérogation.' USING ERRCODE = 'MPM04';
    END IF;
    IF NEW.etape = 'revue_second_expert' AND EXISTS (
         SELECT 1 FROM derogation_validations v WHERE v.derogation_id = NEW.derogation_id
           AND v.etape = 'validation_consultant' AND v.acteur_id = NEW.acteur_id) THEN
      RAISE EXCEPTION 'Quatre yeux : le second expert est une autre personne.' USING ERRCODE = 'MPM04';
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER derogation_validations_controle BEFORE INSERT ON derogation_validations
  FOR EACH ROW EXECUTE FUNCTION controler_derogation_validation();
