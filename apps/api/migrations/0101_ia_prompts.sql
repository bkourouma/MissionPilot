-- Prompts versionnés en base (PRD, « Architecture » ; ADR-003).
--
-- - ia_prompts : EN AJOUT SEUL. Une version (nom, version) n'est jamais
--   modifiée ni supprimée ; une correction crée la version suivante. Le
--   gabarit ne connaît que des variables nommées « {{nom}} » (remplacement
--   simple côté serveur, aucune autre interprétation). `schema_sortie` décrit
--   la sortie attendue (texte, ou objet aux champs typés), validée par Zod.
--   `exemple` : prompt générique de démonstration (semé par l'API, auteur
--   NULL = système), seul utilisable par la génération manuelle de test.
-- - ia_prompt_activations : EN AJOUT SEUL ; la version active d'un nom est
--   celle de la dernière activation (sans activation : la plus haute version).

CREATE TABLE ia_prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  nom text NOT NULL CHECK (nom ~ '^[a-z][a-z0-9_]{0,59}$'),
  version int NOT NULL CHECK (version BETWEEN 1 AND 100000),
  tache text NOT NULL
    CHECK (tache IN ('redaction', 'analyse', 'extraction', 'classification', 'embedding')),
  gabarit_systeme text NOT NULL CHECK (length(gabarit_systeme) <= 20000),
  gabarit_utilisateur text NOT NULL
    CHECK (length(btrim(gabarit_utilisateur)) >= 1 AND length(gabarit_utilisateur) <= 20000),
  variables text[] NOT NULL CHECK (cardinality(variables) <= 30),
  schema_sortie jsonb NOT NULL CHECK (jsonb_typeof(schema_sortie) = 'object'),
  exemple boolean NOT NULL DEFAULT false,
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 500),
  auteur_id uuid,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, nom, version),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, auteur_id) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX ia_prompts_nom_idx ON ia_prompts (cabinet_id, nom, version DESC);
ALTER TABLE ia_prompts ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON ia_prompts
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE UPDATE, DELETE ON ia_prompts FROM missionpilot_app;

CREATE TABLE ia_prompt_activations (
  id bigserial PRIMARY KEY,
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  nom text NOT NULL,
  prompt_id uuid NOT NULL,
  active_par uuid,
  cree_le timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (cabinet_id, prompt_id) REFERENCES ia_prompts (cabinet_id, id),
  FOREIGN KEY (cabinet_id, active_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX ia_prompt_activations_idx ON ia_prompt_activations (cabinet_id, nom, id DESC);
ALTER TABLE ia_prompt_activations ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON ia_prompt_activations
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE UPDATE, DELETE ON ia_prompt_activations FROM missionpilot_app;

CREATE FUNCTION ia_ajout_seul() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    RAISE EXCEPTION 'Historique IA en ajout seul : créer une nouvelle version.'
      USING ERRCODE = 'MPI01';
  END $$;

CREATE TRIGGER ia_prompts_ajout_seul BEFORE UPDATE OR DELETE ON ia_prompts
  FOR EACH ROW EXECUTE FUNCTION ia_ajout_seul();
CREATE TRIGGER ia_prompt_activations_ajout_seul BEFORE UPDATE OR DELETE ON ia_prompt_activations
  FOR EACH ROW EXECUTE FUNCTION ia_ajout_seul();

-- Une version d'un nom garde la tâche de ses devancières et suit la plus
-- haute version (1 pour un nouveau nom) ; une activation désigne bien une
-- version de ce nom.
CREATE FUNCTION controler_ia_prompt() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_max int; v_tache text;
  BEGIN
    SELECT max(version), (array_agg(tache ORDER BY version DESC))[1] INTO v_max, v_tache
      FROM ia_prompts WHERE cabinet_id = NEW.cabinet_id AND nom = NEW.nom;
    IF NEW.version <> coalesce(v_max, 0) + 1 THEN
      RAISE EXCEPTION 'Version de prompt non consécutive.' USING ERRCODE = 'MPI02';
    END IF;
    IF v_tache IS NOT NULL AND v_tache <> NEW.tache THEN
      RAISE EXCEPTION 'Un prompt garde sa tâche d''une version à l''autre.' USING ERRCODE = 'MPI02';
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER ia_prompts_controle BEFORE INSERT ON ia_prompts
  FOR EACH ROW EXECUTE FUNCTION controler_ia_prompt();

CREATE FUNCTION controler_ia_activation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM ia_prompts p
                   WHERE p.cabinet_id = NEW.cabinet_id AND p.id = NEW.prompt_id AND p.nom = NEW.nom) THEN
      RAISE EXCEPTION 'Activation : version d''un autre prompt.' USING ERRCODE = 'MPI02';
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER ia_prompt_activations_controle BEFORE INSERT ON ia_prompt_activations
  FOR EACH ROW EXECUTE FUNCTION controler_ia_activation();
