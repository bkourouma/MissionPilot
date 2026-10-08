-- Agents IA : jeux d'essai de référence et évaluations de non-régression (AGT-04,
-- ADR-005 : « aucune activation sans évaluation réussie »).
--
-- - agents_jeux_essai : jeu d'essai d'un PROMPT (nom), versionné, EN AJOUT
--   SEUL ; chaque cas porte ses variables, les chiffres qu'un moteur fournirait
--   et des critères déterministes (contient, ne contient pas, valeur d'un champ,
--   garde-chiffres verte). Le dernier jeu d'un nom fait référence.
-- - agents_evaluations : rejeu d'un jeu sur une version de prompt et un modèle
--   candidats, EN AJOUT SEUL : cas réussis, régressions par rapport à la version
--   active, résultat par cas (codes de raison, jamais le texte produit).
--   « réussie » = tous les cas réussis.
-- - Gardes d'activation (MPG04), sur les tables de l'IA (0100, 0101) :
--   * activer une version d'un prompt qui a un jeu d'essai exige une évaluation
--     réussie de CETTE version sur le dernier jeu de ce nom ;
--   * choisir un modèle pour une tâche exige, pour chaque prompt actif de cette
--     tâche doté d'un jeu, une évaluation réussie de ce prompt avec CE modèle.
--   Le premier jeu d'un nom ÉPINGLE la version active (activation explicite),
--   faute de quoi la plus haute version deviendrait active sans activation.
--   Limite : revenir au modèle recommandé (suppression de la ligne de
--   ia_modeles_taches) n'est pas gardé.

CREATE TABLE agents_jeux_essai (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  prompt_nom text NOT NULL CHECK (prompt_nom ~ '^[a-z][a-z0-9_]{0,59}$'),
  version int NOT NULL CHECK (version BETWEEN 1 AND 10000),
  brique_id uuid,
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 1000),
  cas jsonb NOT NULL CHECK (jsonb_typeof(cas) = 'array' AND jsonb_array_length(cas) BETWEEN 1 AND 50),
  auteur_id uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, prompt_nom, version),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, brique_id) REFERENCES agents_briques (cabinet_id, id),
  FOREIGN KEY (cabinet_id, auteur_id) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX agents_jeux_essai_liste_idx ON agents_jeux_essai (cabinet_id, cree_le DESC, id DESC);
ALTER TABLE agents_jeux_essai ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON agents_jeux_essai
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON agents_jeux_essai AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON agents_jeux_essai FROM missionpilot_app;

CREATE TRIGGER agents_jeux_essai_ajout_seul BEFORE UPDATE OR DELETE ON agents_jeux_essai
  FOR EACH ROW EXECUTE FUNCTION agents_ajout_seul();

CREATE FUNCTION controler_jeu_essai() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('jeu_essai:' || NEW.cabinet_id::text || ':' || NEW.prompt_nom, 0));
    IF NEW.version <> coalesce((SELECT max(version) FROM agents_jeux_essai
                                WHERE cabinet_id = NEW.cabinet_id AND prompt_nom = NEW.prompt_nom), 0) + 1 THEN
      RAISE EXCEPTION 'Version de jeu d''essai non consécutive.' USING ERRCODE = 'MPG05';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM ia_prompts p WHERE p.cabinet_id = NEW.cabinet_id AND p.nom = NEW.prompt_nom) THEN
      RAISE EXCEPTION 'Jeu d''essai d''un prompt inconnu.' USING ERRCODE = 'MPG05';
    END IF;
    -- Sans activation, la version la plus haute d'un nom est active (0101) : une
    -- nouvelle version, même créée « sans activer », le deviendrait sans évaluation.
    -- Le premier jeu ÉPINGLE donc la version active par une activation explicite
    -- (avant l'insertion du jeu : la garde d'activation ne s'applique pas encore).
    IF NOT EXISTS (SELECT 1 FROM ia_prompt_activations a
                   WHERE a.cabinet_id = NEW.cabinet_id AND a.nom = NEW.prompt_nom) THEN
      INSERT INTO ia_prompt_activations (cabinet_id, nom, prompt_id, active_par)
        SELECT NEW.cabinet_id, NEW.prompt_nom, p.id, NEW.auteur_id FROM ia_prompts p
        WHERE p.cabinet_id = NEW.cabinet_id AND p.nom = NEW.prompt_nom
        ORDER BY p.version DESC LIMIT 1;
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER agents_jeux_essai_controle BEFORE INSERT ON agents_jeux_essai
  FOR EACH ROW EXECUTE FUNCTION controler_jeu_essai();

CREATE TABLE agents_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  jeu_id uuid NOT NULL,
  prompt_id uuid NOT NULL,
  -- Version active au moment de l'évaluation (comparaison) ; NULL si c'est la même.
  prompt_reference_id uuid,
  modele text NOT NULL
    CHECK (modele ~ '^[a-z0-9][a-z0-9._-]{0,63}/[a-z0-9][a-z0-9._-]{0,99}(:[a-z0-9._-]{1,30})?$'),
  fournisseur text NOT NULL CHECK (fournisseur IN ('local', 'openrouter')),
  cas_total int NOT NULL CHECK (cas_total BETWEEN 1 AND 50),
  cas_reussis int NOT NULL CHECK (cas_reussis BETWEEN 0 AND cas_total),
  regressions int NOT NULL CHECK (regressions BETWEEN 0 AND cas_total),
  reussie boolean NOT NULL,
  resultats jsonb NOT NULL CHECK (jsonb_typeof(resultats) = 'array'),
  cout_micro_usd bigint NOT NULL DEFAULT 0 CHECK (cout_micro_usd >= 0),
  lance_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  CHECK (reussie = (cas_reussis = cas_total)),
  FOREIGN KEY (cabinet_id, jeu_id) REFERENCES agents_jeux_essai (cabinet_id, id),
  FOREIGN KEY (cabinet_id, prompt_id) REFERENCES ia_prompts (cabinet_id, id),
  FOREIGN KEY (cabinet_id, prompt_reference_id) REFERENCES ia_prompts (cabinet_id, id),
  FOREIGN KEY (cabinet_id, lance_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX agents_evaluations_liste_idx ON agents_evaluations (cabinet_id, cree_le DESC, id DESC);
CREATE INDEX agents_evaluations_prompt_idx ON agents_evaluations (cabinet_id, prompt_id, jeu_id)
  WHERE reussie;
ALTER TABLE agents_evaluations ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON agents_evaluations
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON agents_evaluations AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON agents_evaluations FROM missionpilot_app;

CREATE TRIGGER agents_evaluations_ajout_seul BEFORE UPDATE OR DELETE ON agents_evaluations
  FOR EACH ROW EXECUTE FUNCTION agents_ajout_seul();

-- L'évaluation porte sur une version du prompt du jeu.
CREATE FUNCTION controler_agent_evaluation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM agents_jeux_essai j JOIN ia_prompts p ON p.nom = j.prompt_nom
                   WHERE j.id = NEW.jeu_id AND p.id = NEW.prompt_id) THEN
      RAISE EXCEPTION 'Évaluation : prompt étranger au jeu d''essai.' USING ERRCODE = 'MPG05';
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER agents_evaluations_controle BEFORE INSERT ON agents_evaluations
  FOR EACH ROW EXECUTE FUNCTION controler_agent_evaluation();

-- Dernier jeu d'essai d'un nom de prompt d'un cabinet (NULL s'il n'y en a pas).
CREATE FUNCTION dernier_jeu_essai(p_cabinet uuid, p_nom text) RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT id FROM agents_jeux_essai WHERE cabinet_id = p_cabinet AND prompt_nom = p_nom
        ORDER BY version DESC LIMIT 1 $$;

-- Garde d'activation d'une version de prompt (AGT-04).
CREATE FUNCTION garder_activation_prompt() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_jeu uuid;
  BEGIN
    v_jeu := dernier_jeu_essai(NEW.cabinet_id, NEW.nom);
    IF v_jeu IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM agents_evaluations e
         WHERE e.jeu_id = v_jeu AND e.prompt_id = NEW.prompt_id AND e.reussie) THEN
      RAISE EXCEPTION 'Activation refusée : aucune évaluation de non-régression réussie de cette version.'
        USING ERRCODE = 'MPG04';
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER ia_prompt_activations_non_regression BEFORE INSERT ON ia_prompt_activations
  FOR EACH ROW EXECUTE FUNCTION garder_activation_prompt();

-- Garde du choix d'un modèle pour une tâche (AGT-04) : chaque prompt ACTIF de la
-- tâche doté d'un jeu d'essai doit avoir réussi ce jeu avec ce modèle.
CREATE FUNCTION garder_modele_tache() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v record;
  BEGIN
    IF TG_OP = 'UPDATE' AND OLD.modele = NEW.modele THEN
      RETURN NEW;
    END IF;
    IF TG_OP = 'INSERT' AND EXISTS (SELECT 1 FROM ia_modeles_taches m
                                    WHERE m.cabinet_id = NEW.cabinet_id AND m.tache = NEW.tache
                                      AND m.modele = NEW.modele) THEN
      RETURN NEW;
    END IF;
    FOR v IN
      SELECT DISTINCT ON (p.nom) p.id, p.nom
      FROM ia_prompts p
      WHERE p.cabinet_id = NEW.cabinet_id AND p.tache = NEW.tache
        AND dernier_jeu_essai(NEW.cabinet_id, p.nom) IS NOT NULL
      ORDER BY p.nom,
        (p.id = (SELECT a.prompt_id FROM ia_prompt_activations a
                 WHERE a.cabinet_id = NEW.cabinet_id AND a.nom = p.nom
                 ORDER BY a.id DESC LIMIT 1)) DESC NULLS LAST,
        p.version DESC
    LOOP
      IF NOT EXISTS (SELECT 1 FROM agents_evaluations e
                     WHERE e.jeu_id = dernier_jeu_essai(NEW.cabinet_id, v.nom) AND e.prompt_id = v.id
                       AND e.modele = NEW.modele AND e.reussie) THEN
        RAISE EXCEPTION 'Modèle refusé : aucune évaluation de non-régression réussie avec ce modèle.'
          USING ERRCODE = 'MPG04';
      END IF;
    END LOOP;
    RETURN NEW;
  END $$;

CREATE TRIGGER ia_modeles_taches_non_regression BEFORE INSERT OR UPDATE ON ia_modeles_taches
  FOR EACH ROW EXECUTE FUNCTION garder_modele_tache();
